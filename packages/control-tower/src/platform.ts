import { mkdir, readdir, readFile, stat, statfs, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import {
  buildDashboard,
  buildHealthSummary,
  buildImportReport,
  buildMcpProfile,
  buildPanelContracts,
  buildSecurityChecklist,
  createBucket
} from "./services.js";
import { createControlTowerApp, loadControlTowerConfig } from "./config.js";
import { PostgresClient } from "./postgres.js";
import type {
  BucketRecord,
  ImportReport,
  IssuedTokenSecret,
  MetadataSnapshot,
  ProjectBackupRecord,
  ProjectManifest,
  ProjectRecord,
  RouteRecord,
  SqlHistoryEntry,
  SystemHealthSnapshot,
  TablePreview,
  TableQueryResult,
  TokenRecord
} from "./types.js";

const execFileAsync = promisify(execFile);

export async function withControlTowerApp<T>(fn: (ctx: Awaited<ReturnType<typeof createControlTowerApp>>) => Promise<T>) {
  const app = await createControlTowerApp(loadControlTowerConfig());
  try {
    return await fn(app);
  } finally {
    await app.close();
  }
}

export async function getAdminWorkspace() {
  return withControlTowerApp(async (app) => {
    const snapshot = await app.repository.snapshot();
    const dashboard = await hydrateDashboard(snapshot);
    return {
      dashboard,
      health: buildHealthSummary(snapshot),
      panelContracts: buildPanelContracts(snapshot),
      securityChecklist: buildSecurityChecklist(),
      stories: snapshot.projects.length
    };
  });
}

export async function listProjects(): Promise<ProjectRecord[]> {
  return withControlTowerApp(async (app) => (await app.repository.snapshot()).projects);
}

export async function getProjectDetail(projectId: string) {
  return withControlTowerApp(async (app) => {
    const snapshot = await app.repository.snapshot();
    const project = snapshot.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    return {
      project,
      database: snapshot.databases.find((item) => item.projectId === projectId) ?? null,
      auth: snapshot.authInstances.find((item) => item.projectId === projectId) ?? null,
      route: snapshot.routes.find((item) => item.projectId === projectId) ?? null,
      tokens: snapshot.tokens.filter((item) => item.projectId === projectId),
      buckets: snapshot.buckets.filter((item) => item.projectId === projectId),
      sqlHistory: buildSqlHistory(snapshot, projectId),
      backups: await listProjectBackups(projectId),
      mcp: buildMcpProfile(projectId),
      importReport: buildImportReport(projectId)
    };
  });
}

export async function provisionProjectFromManifest(manifest: ProjectManifest) {
  return withControlTowerApp(async (app) => app.provisioningService.provisionProject(manifest));
}

export async function deleteProject(projectId: string, confirmation: string) {
  return withControlTowerApp(async (app) => {
    await app.provisioningService.deprovisionProject(projectId, confirmation);
    return { deleted: true };
  });
}

export async function revokeProjectToken(projectId: string, tokenId: string) {
  return withControlTowerApp(async (app) => {
    const snapshot = await app.repository.snapshot();
    const token = snapshot.tokens.find((item) => item.projectId === projectId && item.id === tokenId);
    if (!token) {
      throw new Error(`Token ${tokenId} not found`);
    }
    const revokedAt = new Date().toISOString();
    await app.repository.revokeToken(tokenId, revokedAt);
    await app.repository.appendAudit({
      id: crypto.randomUUID(),
      projectId,
      action: "token.revoke",
      phase: "completed",
      details: {
        tokenId,
        scope: token.scope
      },
      createdAt: revokedAt
    });
    return { revoked: tokenId };
  });
}

export async function issueProjectToken(
  projectId: string,
  scope: "service" | "anon" | "mcp",
  expiresAt: string,
  accessMode?: "read-only" | "read-write"
): Promise<IssuedTokenSecret> {
  return withControlTowerApp(async (app) => {
    const snapshot = await app.repository.snapshot();
    const project = snapshot.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }

    const secret = `${projectId}:${scope}:${crypto.randomUUID()}`;
    const createdAt = new Date().toISOString();
    const token: TokenRecord = {
      id: crypto.randomUUID(),
      projectId,
      scope,
      hash: crypto.createHash("sha256").update(secret).digest("hex"),
      expiresAt,
      revokedAt: null,
      accessMode: accessMode ?? (scope === "mcp" ? "read-only" : "read-write"),
      createdAt
    };

    await app.repository.appendTokens([token]);
    await app.repository.appendAudit({
      id: crypto.randomUUID(),
      projectId,
      action: "token.issue",
      phase: "completed",
      details: {
        tokenId: token.id,
        scope: token.scope,
        accessMode: token.accessMode
      },
      createdAt
    });

    return { token, secret };
  });
}

export async function runProjectSql(projectId: string, sql: string) {
  return withControlTowerApp(async (app) => {
    const projectConnection = await getProjectConnectionWithinApp(app, projectId);
    const client = new PostgresClient(projectConnection.connectionString);
    const executedAt = new Date().toISOString();
    try {
      const result = await client.query(sql);
      await app.repository.appendAudit({
        id: crypto.randomUUID(),
        projectId,
        action: "sql.run",
        phase: "completed",
        details: {
          sql: normalizeSql(sql),
          rowCount: result.rows.length
        },
        createdAt: executedAt
      });
      return {
        rows: result.rows,
        rowCount: result.rows.length,
        executedAt
      };
    } catch (error) {
      await app.repository.appendAudit({
        id: crypto.randomUUID(),
        projectId,
        action: "sql.run",
        phase: "failed",
        details: {
          sql: normalizeSql(sql),
          message: error instanceof Error ? error.message : "Unknown SQL failure"
        },
        createdAt: executedAt
      });
      throw error;
    } finally {
      await client.close();
    }
  });
}

export async function listProjectTables(projectId: string, filter = ""): Promise<TablePreview[]> {
  return withProjectCache(projectId, `tables:${filter.trim().toLowerCase()}`, 30_000, async () => {
    const projectConnection = await getProjectConnection(projectId);
    const client = new PostgresClient(projectConnection.connectionString);
    try {
      const result = await client.query<{
        table_name: string;
        estimated_rows: number | null;
        columns: string[];
      }>(
        `SELECT
           c.relname AS table_name,
           c.reltuples::bigint AS estimated_rows,
           COALESCE(
             ARRAY(
               SELECT a.attname
               FROM pg_attribute a
               WHERE a.attrelid = c.oid
                 AND a.attnum > 0
                 AND NOT a.attisdropped
               ORDER BY a.attnum
             ),
             ARRAY[]::text[]
           ) AS columns
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = 'public'
           AND c.relkind = 'r'
           AND ($1 = '' OR c.relname ILIKE $2)
         ORDER BY c.relname ASC`,
        [filter.trim(), `%${filter.trim()}%`]
      );
      return result.rows.map((row) => ({
        tableName: row.table_name,
        estimatedRows: Number(row.estimated_rows ?? 0),
        columns: row.columns ?? []
      }));
    } finally {
      await client.close();
    }
  });
}

export async function readProjectTable(
  projectId: string,
  tableName: string,
  options: {
    page?: number;
    pageSize?: number;
    sortColumn?: string;
    sortDirection?: "asc" | "desc";
    filter?: string;
  } = {}
): Promise<TableQueryResult> {
  const cacheKey = [
    "table",
    tableName,
    options.page ?? 1,
    options.pageSize ?? 50,
    options.sortColumn ?? "",
    options.sortDirection ?? "asc",
    options.filter ?? ""
  ].join(":");
  return withProjectCache(projectId, cacheKey, 20_000, async () => {
    const projectConnection = await getProjectConnection(projectId);
    const client = new PostgresClient(projectConnection.connectionString);
    try {
      const safeTableName = tableName.replace(/"/g, "\"\"");
      const pageSize = Math.max(1, Math.min(Number(options.pageSize ?? 50), 200));
      const page = Math.max(1, Number(options.page ?? 1));
      const columnsResult = await client.query<{ column_name: string }>(
        `SELECT column_name
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
         ORDER BY ordinal_position ASC`,
        [tableName]
      );
      const columns = columnsResult.rows.map((row) => row.column_name);
      if (columns.length === 0) {
        throw new Error(`Table ${tableName} not found`);
      }

      const filter = String(options.filter ?? "").trim();
      const safeSortColumn = columns.includes(options.sortColumn ?? "") ? options.sortColumn ?? null : null;
      const sortDirection = options.sortDirection === "desc" ? "desc" : "asc";
      const whereClause = filter
        ? `WHERE ${columns
            .map((column) => `CAST("${column.replace(/"/g, "\"\"")}" AS text) ILIKE $1`)
            .join(" OR ")}`
        : "";
      const orderClause = safeSortColumn
        ? `ORDER BY "${safeSortColumn.replace(/"/g, "\"\"")}" ${sortDirection.toUpperCase()}`
        : "";
      const offset = (page - 1) * pageSize;
      const values = filter ? [`%${filter}%`] : [];
      const countSql = `SELECT COUNT(*)::int AS count FROM "public"."${safeTableName}" ${whereClause}`;
      const rowsSql = `SELECT * FROM "public"."${safeTableName}" ${whereClause} ${orderClause} LIMIT ${pageSize} OFFSET ${offset}`;
      const [countResult, rowsResult] = await Promise.all([
        client.query<{ count: number }>(countSql, values),
        client.query(rowsSql, values)
      ]);
      const totalRows = Number(countResult.rows[0]?.count ?? 0);
      return {
        tableName,
        columns,
        rows: rowsResult.rows,
        totalRows,
        page,
        pageSize,
        totalPages: Math.max(1, Math.ceil(totalRows / pageSize)),
        sort: {
          column: safeSortColumn,
          direction: sortDirection
        },
        filter
      };
    } finally {
      await client.close();
    }
  });
}

export async function createProjectBucket(
  projectId: string,
  name: string,
  visibility: "public" | "private",
  backend: "ssd" | "nas" = "ssd"
) {
  const config = loadControlTowerConfig();
  return withControlTowerApp(async (app) => {
    const bucket = createBucket(projectId, name, visibility, backend);
    await app.repository.upsertBucket(bucket);
    const bucketPath = resolveBucketPath(config, projectId, bucket.name, bucket.backend);
    await mkdir(bucketPath, { recursive: true });
    await writeBucketMeta(bucketPath, bucket);
    return bucket;
  });
}

export async function listBucketFiles(projectId: string, bucketName: string) {
  const config = loadControlTowerConfig();
  const bucketPath = await resolveBucketPathForProject(config, projectId, bucketName);
  await mkdir(bucketPath, { recursive: true });
  const bucketMeta = await readBucketMeta(bucketPath);
  const entries = await readdir(bucketPath, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name !== ".bucket.json")
      .map(async (entry) => {
        const info = await stat(path.join(bucketPath, entry.name));
        return {
          name: entry.name,
          size: info.size,
          modifiedAt: info.mtime.toISOString(),
          publicUrl:
            bucketMeta?.visibility === "public"
              ? `/api/projects/${projectId}/buckets/${bucketName}/public/${encodeURIComponent(entry.name)}`
              : null
        };
      })
  );
  return files;
}

export async function saveBucketFile(
  projectId: string,
  bucketName: string,
  fileName: string,
  content: ArrayBuffer
) {
  const config = loadControlTowerConfig();
  const bucketPath = await resolveBucketPathForProject(config, projectId, bucketName);
  await mkdir(bucketPath, { recursive: true });
  const targetPath = path.join(bucketPath, sanitizeFileName(fileName));
  await writeFile(targetPath, Buffer.from(content));
  return { stored: path.basename(targetPath) };
}

export async function readBucketFile(projectId: string, bucketName: string, fileName: string) {
  const config = loadControlTowerConfig();
  const bucketPath = await resolveBucketPathForProject(config, projectId, bucketName);
  const targetPath = path.join(bucketPath, sanitizeFileName(fileName));
  const content = await readFile(targetPath);
  const info = await stat(targetPath);
  return {
    name: path.basename(targetPath),
    content,
    modifiedAt: info.mtime.toISOString()
  };
}

export async function listProjectBackups(projectId: string): Promise<ProjectBackupRecord[]> {
  const config = loadControlTowerConfig();
  const backupPath = path.join(config.backupRoot, projectId);
  await mkdir(backupPath, { recursive: true });
  const entries = await readdir(backupPath, { withFileTypes: true });
  const files = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
      .map(async (entry) => {
        const info = await stat(path.join(backupPath, entry.name));
        return {
          id: entry.name,
          projectId,
          fileName: entry.name,
          filePath: path.join(backupPath, entry.name),
          sizeBytes: info.size,
          createdAt: info.mtime.toISOString(),
          status: "completed" as const
        };
      })
  );
  return files.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function createProjectBackup(projectId: string) {
  return withControlTowerApp(async (app) => {
    const projectConnection = await getProjectConnectionWithinApp(app, projectId);
    const config = loadControlTowerConfig();
    const backupPath = path.join(config.backupRoot, projectId);
    await mkdir(backupPath, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `${projectConnection.database.databaseName}-${stamp}.sql`;
    const filePath = path.join(backupPath, fileName);
    const createdAt = new Date().toISOString();

    try {
      if (config.mode === "real") {
        const sourceUrl = normalizeConnectionStringForDocker(projectConnection.connectionString);
        await runDockerPostgresClient(
          [
            "run",
            "--rm",
            "--network",
            config.dockerNetworkName ?? "control-tower-net",
            "-e",
            `SOURCE_URL=${sourceUrl}`,
            "-v",
            `${path.resolve(backupPath)}:/backup`,
            "postgres:16",
            "sh",
            "-lc",
            `pg_dump "$SOURCE_URL" --schema=public --schema=auth --clean --if-exists --no-owner --no-privileges > /backup/${fileName}`
          ],
          backupPath
        );
      } else {
        await writeFile(
          filePath,
          `-- dev backup placeholder for ${projectConnection.database.databaseName}\n-- created at ${createdAt}\n`,
          "utf8"
        );
      }

      const info = await stat(filePath);
      await app.repository.appendAudit({
        id: crypto.randomUUID(),
        projectId,
        action: "backup.run",
        phase: "completed",
        details: {
          fileName,
          sizeBytes: info.size
        },
        createdAt
      });
      await enforceBackupRetention(projectId, config.backupRetentionCount);
      return {
        id: fileName,
        projectId,
        fileName,
        filePath,
        sizeBytes: info.size,
        createdAt,
        status: "completed" as const
      };
    } catch (error) {
      await app.repository.appendAudit({
        id: crypto.randomUUID(),
        projectId,
        action: "backup.run",
        phase: "failed",
        details: {
          fileName,
          message: error instanceof Error ? error.message : "Unknown backup failure"
        },
        createdAt
      });
      throw error;
    }
  });
}

export async function restoreProjectBackup(projectId: string, fileName: string) {
  return withControlTowerApp(async (app) => {
    const projectConnection = await getProjectConnectionWithinApp(app, projectId);
    const config = loadControlTowerConfig();
    const safeFileName = path.basename(fileName);
    const backupPath = path.join(config.backupRoot, projectId, safeFileName);
    const createdAt = new Date().toISOString();
    await stat(backupPath);

    try {
      if (config.mode === "real") {
        const targetUrl = normalizeConnectionStringForDocker(projectConnection.connectionString);
        await runDockerPostgresClient(
          [
            "run",
            "--rm",
            "--network",
            config.dockerNetworkName ?? "control-tower-net",
            "-e",
            `TARGET_URL=${targetUrl}`,
            "-v",
            `${path.resolve(path.dirname(backupPath))}:/backup`,
            "postgres:16",
            "sh",
            "-lc",
            `psql "$TARGET_URL" < /backup/${safeFileName}`
          ],
          path.dirname(backupPath)
        );
      }

      await app.repository.appendAudit({
        id: crypto.randomUUID(),
        projectId,
        action: "backup.restore",
        phase: "completed",
        details: { fileName: safeFileName },
        createdAt
      });
      return { restored: safeFileName, projectId };
    } catch (error) {
      await app.repository.appendAudit({
        id: crypto.randomUUID(),
        projectId,
        action: "backup.restore",
        phase: "failed",
        details: {
          fileName: safeFileName,
          message: error instanceof Error ? error.message : "Unknown restore failure"
        },
        createdAt
      });
      throw error;
    }
  });
}

export async function verifyAuthIsolation(projectId: string, targetProjectId: string, email: string, password: string) {
  return withControlTowerApp(async (app) => {
    const [source, target] = await Promise.all([
      getProjectDetail(projectId),
      getProjectDetail(targetProjectId)
    ]);
    if (!source.auth?.authUrl || !target.auth?.authUrl) {
      throw new Error("Both projects need auth instances for isolation checks.");
    }

    const createdAt = new Date().toISOString();
    await ensureSourceUser(source.auth.authUrl, email, password);
    const sourceLogin = await loginAgainstAuth(source.auth.authUrl, email, password);
    const targetLogin = await loginAgainstAuth(target.auth.authUrl, email, password);
    const isolated = sourceLogin && !targetLogin;

    await app.repository.appendAudit({
      id: crypto.randomUUID(),
      projectId,
      action: "auth.isolation_check",
      phase: isolated ? "completed" : "failed",
      details: {
        sourceProjectId: projectId,
        targetProjectId,
        email,
        isolated
      },
      createdAt
    });

    return {
      sourceProjectId: projectId,
      targetProjectId,
      email,
      isolated,
      sourceLogin,
      targetLogin
    };
  });
}

export async function runProjectMcpTool(input: {
  projectId: string;
  token: string;
  tool: string;
  args?: Record<string, unknown>;
}) {
  const tokenRecord = await authenticateProjectMcpToken(input.projectId, input.token);
  const args = input.args ?? {};

  switch (input.tool) {
    case "list_tables":
      return { tool: input.tool, result: await listProjectTables(input.projectId, String(args.filter ?? "")) };
    case "describe_schema": {
      const tableName = String(args.tableName ?? "");
      if (!tableName) {
        throw new Error("tableName is required");
      }
      const result = await readProjectTable(input.projectId, tableName, { page: 1, pageSize: 1 });
      return { tool: input.tool, result: { tableName, columns: result.columns } };
    }
    case "run_read_only_query": {
      const sql = String(args.sql ?? "");
      ensureReadOnlySql(sql);
      return {
        tool: input.tool,
        accessMode: tokenRecord.accessMode,
        result: await runCachedReadOnlyQuery(input.projectId, sql, Number(args.ttlMs ?? 30_000))
      };
    }
    case "run_write_query_with_confirmation": {
      if (tokenRecord.accessMode !== "read-write") {
        throw new Error("This MCP token is read-only.");
      }
      if (args.confirmation !== "CONFIRMED") {
        throw new Error("Explicit confirmation is required for write queries.");
      }
      return { tool: input.tool, result: await runProjectSql(input.projectId, String(args.sql ?? "")) };
    }
    default:
      throw new Error(`Unknown MCP tool: ${input.tool}`);
  }
}

export async function importSupabaseProject(input: {
  name: string;
  slug: string;
  subdomain: string;
  databaseName: string;
  ownerEmail: string;
  sourceConnectionString: string;
  verifyEmail?: string;
  verifyPassword?: string;
}) {
  const manifest: ProjectManifest = {
    name: input.name,
    slug: input.slug,
    subdomain: input.subdomain,
    databaseName: input.databaseName,
    ownerEmail: input.ownerEmail,
    tokens: {
      service: "2030-01-01T00:00:00.000Z",
      anon: "2030-01-01T00:00:00.000Z",
      mcp: "2030-01-01T00:00:00.000Z"
    }
  };

  const project = await provisionProjectFromManifest(manifest);
  const target = await getProjectConnection(project.id);
  const config = loadControlTowerConfig();
  await mkdir(config.importWorkspaceRoot, { recursive: true });

  const sourceUrl = normalizeConnectionStringForDocker(input.sourceConnectionString);
  const targetUrl = normalizeConnectionStringForDocker(target.connectionString);
  const dumpCommand =
    'pg_dump "$SOURCE_URL" --schema=public --schema=auth --clean --if-exists --no-owner --no-privileges | psql "$TARGET_URL"';

  await runDockerPostgresClient(
    [
      "run",
      "--rm",
      "--network",
      config.dockerNetworkName ?? "control-tower-net",
      "-e",
      `SOURCE_URL=${sourceUrl}`,
      "-e",
      `TARGET_URL=${targetUrl}`,
      "postgres:17",
      "sh",
      "-lc",
      dumpCommand
    ],
    config.importWorkspaceRoot
  );

  await createSupabaseCompatRoles(target.adminConnectionString);

  let loginCheck = false;
  if (input.verifyEmail && input.verifyPassword) {
    const detail = await getProjectDetail(project.id);
    if (detail.auth?.authUrl) {
      loginCheck = await verifyImportedLogin(detail.auth.authUrl, input.verifyEmail, input.verifyPassword);
    }
  }

  return {
    project,
    report: {
      ...buildImportReport(project.id),
      preservedPasswordLogin: input.verifyEmail && input.verifyPassword ? loginCheck : false
    } satisfies ImportReport
  };
}

export async function exportRoutes() {
  return withControlTowerApp(async (app) => {
    const snapshot = await app.repository.snapshot();
    return snapshot.routes;
  });
}

export async function getOperationsSnapshot() {
  return withControlTowerApp(async (app) => {
    const snapshot = await app.repository.snapshot();
    return {
      projects: snapshot.projects,
      routes: snapshot.routes,
      tokens: snapshot.tokens,
      auditLogs: snapshot.auditLogs.slice(-25),
      systemHealth: await getSystemHealthSnapshot(snapshot)
    };
  });
}

async function hydrateDashboard(snapshot: MetadataSnapshot) {
  const baseDashboard = buildDashboard(snapshot);
  if (snapshot.projects.length === 0) {
    return baseDashboard;
  }

  const config = loadControlTowerConfig();
  if (config.mode !== "real") {
    return baseDashboard;
  }
  const adminConnectionString =
    config.superPostgresUrl ?? config.projectDatabaseUrlTemplate.replace("{databaseName}", "postgres");
  const adminClient = new PostgresClient(adminConnectionString);

  try {
    return await Promise.all(
      baseDashboard.map(async (item) => {
        const database = snapshot.databases.find((entry) => entry.projectId === item.projectId);
        if (!database) {
          return item;
        }

        const [userCount, diskUsageGb] = await Promise.all([
          readUserCount(database.databaseName, config.projectDatabaseUrlTemplate),
          readDatabaseSizeGb(adminClient, database.databaseName)
        ]);

        return {
          ...item,
          userCount,
          diskUsageGb
        };
      })
    );
  } catch {
    return baseDashboard;
  } finally {
    await adminClient.close();
  }
}

async function getProjectConnection(projectId: string) {
  return withControlTowerApp(async (app) => {
    return getProjectConnectionWithinApp(app, projectId);
  });
}

async function getProjectConnectionWithinApp(app: Awaited<ReturnType<typeof createControlTowerApp>>, projectId: string) {
  const snapshot = await app.repository.snapshot();
  const project = snapshot.projects.find((item) => item.id === projectId);
  const database = snapshot.databases.find((item) => item.projectId === projectId);
  if (!project || !database) {
    throw new Error(`Project connection not found for ${projectId}`);
  }
  const config = loadControlTowerConfig();
  const writerCredentials = await readRoleCredentials(config.secretDirectory, project.slug, "writer");
  return {
    project,
    database,
    connectionString: buildProjectConnectionString(
      config.projectDatabaseUrlTemplate,
      database.databaseName,
      writerCredentials?.roleName ?? database.writerRole,
      writerCredentials?.password ?? ""
    ),
    adminConnectionString: config.superPostgresUrl ?? buildProjectConnectionString(config.projectDatabaseUrlTemplate, "postgres")
  };
}

async function createSupabaseCompatRoles(adminConnectionString: string) {
  const client = new PostgresClient(adminConnectionString);
  try {
    await client.query('CREATE ROLE authenticated');
  } catch {}
  try {
    await client.query('CREATE ROLE anon');
  } catch {}
  try {
    await client.query('CREATE ROLE service_role');
  } catch {}
  await client.close();
}

async function verifyImportedLogin(authUrl: string, email: string, password: string) {
  const response = await fetch(new URL("/token?grant_type=password", authUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password })
  });
  return response.ok;
}

async function readUserCount(databaseName: string, connectionTemplate: string) {
  const client = new PostgresClient(buildProjectConnectionString(connectionTemplate, databaseName));
  try {
    const result = await client.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM auth.users");
    return Number(result.rows[0]?.count ?? "0");
  } catch {
    return 0;
  } finally {
    await client.close();
  }
}

async function readDatabaseSizeGb(client: PostgresClient, databaseName: string) {
  try {
    const result = await client.query<{ bytes: string }>("SELECT pg_database_size($1)::text AS bytes", [databaseName]);
    const bytes = Number(result.rows[0]?.bytes ?? "0");
    return Math.round((bytes / 1024 / 1024 / 1024) * 100) / 100;
  } catch {
    return 0;
  }
}

async function readRoleCredentials(
  secretDirectory: string,
  slug: string,
  accessMode: "writer" | "reader"
): Promise<{ roleName: string; password: string } | null> {
  try {
    return JSON.parse(
      await readFile(path.join(secretDirectory, `${slug}.${accessMode}.db.json`), "utf8")
    ) as { roleName: string; password: string };
  } catch {
    return null;
  }
}

function buildProjectConnectionString(
  template: string,
  databaseName: string,
  roleName = "postgres",
  rolePassword = "postgres"
) {
  return template
    .replaceAll("{databaseName}", databaseName)
    .replaceAll("{roleName}", roleName)
    .replaceAll("{rolePassword}", rolePassword);
}

function buildSqlHistory(snapshot: MetadataSnapshot, projectId: string): SqlHistoryEntry[] {
  return snapshot.auditLogs
    .filter((entry) => entry.projectId === projectId && entry.action === "sql.run")
    .slice(-20)
    .reverse()
    .map((entry) => ({
      id: entry.id,
      projectId,
      sql: String(entry.details.sql ?? ""),
      rowCount: Number(entry.details.rowCount ?? 0),
      executedAt: entry.createdAt,
      status: entry.phase === "failed" ? "failed" : "completed",
      message: entry.details.message ? String(entry.details.message) : null
    }));
}

function normalizeSql(sql: string) {
  return String(sql).replace(/\s+/g, " ").trim().slice(0, 600);
}

async function runDockerPostgresClient(args: string[], cwd: string) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("docker", args, {
      cwd,
      stdio: "inherit",
      windowsHide: true
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Docker postgres client failed with code ${code}`));
    });
  });
}

function normalizeConnectionStringForDocker(connectionString: string) {
  const url = new URL(connectionString);
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
    url.hostname = "host.docker.internal";
  }
  return url.toString();
}

async function getSystemHealthSnapshot(snapshot: MetadataSnapshot): Promise<SystemHealthSnapshot> {
  const containers = [
    "control-tower-postgres",
    "control-tower-caddy",
    "control-tower-minio-hot",
    "control-tower-minio-cold",
    ...snapshot.authInstances.map((item) => item.containerId)
  ];
  const uniqueContainers = [...new Set(containers)];
  const warnings: string[] = [];
  const disk = await readDiskHealth();

  let containerStates: SystemHealthSnapshot["containers"] = [];
  try {
    containerStates = await inspectContainers(uniqueContainers);
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "Container inspection failed");
  }

  if (containerStates.some((item) => item.health !== "healthy" && item.health !== "n/a")) {
    warnings.push("One or more containers are unhealthy.");
  }
  if (os.freemem() / os.totalmem() < 0.1) {
    warnings.push("Host free memory is below 10%.");
  }
  if (disk.diskTotalGb > 0 && disk.diskFreeGb / disk.diskTotalGb < 0.1) {
    warnings.push("Disk free space is below 10%.");
  }

  return {
    host: {
      platform: `${os.platform()} ${os.release()}`,
      uptimeSeconds: Math.round(os.uptime()),
      cpuCores: os.cpus().length,
      totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
      freeMemoryMb: Math.round(os.freemem() / 1024 / 1024),
      loadAverage: os.loadavg().map((value) => Math.round(value * 100) / 100),
      diskTotalGb: disk.diskTotalGb,
      diskFreeGb: disk.diskFreeGb
    },
    containers: containerStates,
    warnings
  };
}

async function inspectContainers(names: string[]): Promise<SystemHealthSnapshot["containers"]> {
  if (names.length === 0) {
    return [];
  }
  const { stdout } = await execFileAsync("docker", ["inspect", ...names], {
    windowsHide: true,
    maxBuffer: 1024 * 1024 * 8
  });
  const parsed = JSON.parse(stdout) as Array<{
    Name?: string;
    State?: {
      Status?: string;
      Health?: {
        Status?: string;
      };
    };
  }>;
  return parsed.map((item) => ({
    name: String(item.Name ?? "").replace(/^\//, ""),
    status: item.State?.Status ?? "unknown",
    health: item.State?.Health?.Status ?? "n/a"
  }));
}

function sanitizeFileName(value: string) {
  return value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_");
}

async function writeBucketMeta(bucketPath: string, bucket: BucketRecord) {
  await writeFile(path.join(bucketPath, ".bucket.json"), JSON.stringify(bucket, null, 2) + "\n", "utf8");
}

async function readBucketMeta(bucketPath: string): Promise<BucketRecord | null> {
  try {
    return JSON.parse(await readFile(path.join(bucketPath, ".bucket.json"), "utf8")) as BucketRecord;
  } catch {
    return null;
  }
}

async function readDiskHealth() {
  try {
    const root = path.parse(process.cwd()).root;
    const info = await statfs(root);
    const blockSize = Number(info.bsize ?? 0);
    const total = Number(info.blocks ?? 0) * blockSize;
    const free = Number(info.bavail ?? info.bfree ?? 0) * blockSize;
    return {
      diskTotalGb: Math.round((total / 1024 / 1024 / 1024) * 100) / 100,
      diskFreeGb: Math.round((free / 1024 / 1024 / 1024) * 100) / 100
    };
  } catch {
    return { diskTotalGb: 0, diskFreeGb: 0 };
  }
}

async function withProjectCache<T>(projectId: string, key: string, ttlMs: number, producer: () => Promise<T>): Promise<T> {
  const config = loadControlTowerConfig();
  const cacheDir = path.join(config.cacheRoot, projectId);
  const cacheFile = path.join(cacheDir, `${cacheKey(key)}.json`);
  try {
    const existing = JSON.parse(await readFile(cacheFile, "utf8")) as { expiresAt: number; value: T };
    if (existing.expiresAt > Date.now()) {
      return existing.value;
    }
  } catch {}

  const value = await producer();
  await mkdir(cacheDir, { recursive: true });
  await writeFile(cacheFile, JSON.stringify({ expiresAt: Date.now() + ttlMs, value }, null, 2) + "\n", "utf8");
  return value;
}

function cacheKey(input: string) {
  return crypto.createHash("sha1").update(input).digest("hex");
}

async function resolveBucketPathForProject(
  config: ReturnType<typeof loadControlTowerConfig>,
  projectId: string,
  bucketName: string
) {
  const metaPaths = [
    path.join(config.hotStorageRoot, projectId, bucketName, ".bucket.json"),
    path.join(config.coldStorageRoot, projectId, bucketName, ".bucket.json"),
    path.join(config.storageRoot, projectId, bucketName, ".bucket.json")
  ];
  for (const metaPath of metaPaths) {
    try {
      const bucket = JSON.parse(await readFile(metaPath, "utf8")) as BucketRecord;
      return resolveBucketPath(config, projectId, bucketName, bucket.backend);
    } catch {}
  }
  return resolveBucketPath(config, projectId, bucketName, "ssd");
}

function resolveBucketPath(
  config: ReturnType<typeof loadControlTowerConfig>,
  projectId: string,
  bucketName: string,
  backend: "ssd" | "nas"
) {
  const baseRoot = backend === "nas" ? config.coldStorageRoot : config.hotStorageRoot;
  return path.join(baseRoot, projectId, bucketName);
}

async function authenticateProjectMcpToken(projectId: string, token: string) {
  return withControlTowerApp(async (app) => {
    const snapshot = await app.repository.snapshot();
    const tokenHash = crypto.createHash("sha256").update(String(token)).digest("hex");
    const match = snapshot.tokens.find(
      (entry) =>
        entry.projectId === projectId &&
        entry.scope === "mcp" &&
        !entry.revokedAt &&
        new Date(entry.expiresAt).getTime() > Date.now() &&
        entry.hash === tokenHash
    );
    if (!match) {
      throw new Error("Invalid MCP token.");
    }
    return match;
  });
}

function ensureReadOnlySql(sql: string) {
  const normalized = String(sql).trim().toLowerCase();
  if (!normalized.startsWith("select") && !normalized.startsWith("with")) {
    throw new Error("Only read-only SQL is allowed.");
  }
  if (/\b(insert|update|delete|drop|alter|truncate|create|grant|revoke)\b/i.test(normalized)) {
    throw new Error("Read-only SQL cannot contain write operations.");
  }
}

async function runCachedReadOnlyQuery(projectId: string, sql: string, ttlMs: number) {
  ensureReadOnlySql(sql);
  return withProjectCache(projectId, `read-query:${sql}`, ttlMs, async () => runProjectSql(projectId, sql));
}

async function ensureSourceUser(authUrl: string, email: string, password: string) {
  await fetch(new URL("/signup", authUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password })
  }).catch(() => null);
}

async function loginAgainstAuth(authUrl: string, email: string, password: string) {
  const response = await fetch(new URL("/token?grant_type=password", authUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ email, password })
  });
  return response.ok;
}

async function enforceBackupRetention(projectId: string, retentionCount: number) {
  if (retentionCount <= 0) {
    return;
  }
  const backups = await listProjectBackups(projectId);
  const staleBackups = backups.slice(retentionCount);
  await Promise.all(staleBackups.map((backup) => unlink(backup.filePath).catch(() => undefined)));
}
