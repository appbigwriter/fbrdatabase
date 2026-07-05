import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AuditEntry,
  AuthInstanceRecord,
  BucketRecord,
  DatabaseRecord,
  MetadataSnapshot,
  ProjectRecord,
  RouteRecord,
  TokenRecord
} from "./types.js";

export interface SqlQueryable {
  query<T = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: T[] }>;
}

export interface MetadataDriver {
  snapshot(): Promise<MetadataSnapshot>;
  upsertProject(project: ProjectRecord): Promise<void>;
  removeProject(projectId: string): Promise<void>;
  upsertDatabase(database: DatabaseRecord): Promise<void>;
  upsertAuthInstance(authInstance: AuthInstanceRecord): Promise<void>;
  upsertRoute(route: RouteRecord): Promise<void>;
  upsertBucket(bucket: BucketRecord): Promise<void>;
  appendTokens(tokens: TokenRecord[]): Promise<void>;
  revokeToken(tokenId: string, revokedAt: string): Promise<void>;
  appendAudit(entry: AuditEntry): Promise<void>;
}

const emptySnapshot = (): MetadataSnapshot => ({
  projects: [],
  databases: [],
  authInstances: [],
  tokens: [],
  buckets: [],
  routes: [],
  auditLogs: []
});

export class MetadataRepository {
  constructor(private readonly driver: MetadataDriver) {}

  async snapshot(): Promise<MetadataSnapshot> {
    return this.driver.snapshot();
  }

  async upsertProject(project: ProjectRecord): Promise<void> {
    await this.driver.upsertProject(project);
  }

  async removeProject(projectId: string): Promise<void> {
    await this.driver.removeProject(projectId);
  }

  async upsertDatabase(database: DatabaseRecord): Promise<void> {
    await this.driver.upsertDatabase(database);
  }

  async upsertAuthInstance(authInstance: AuthInstanceRecord): Promise<void> {
    await this.driver.upsertAuthInstance(authInstance);
  }

  async upsertRoute(route: RouteRecord): Promise<void> {
    await this.driver.upsertRoute(route);
  }

  async upsertBucket(bucket: BucketRecord): Promise<void> {
    await this.driver.upsertBucket(bucket);
  }

  async appendTokens(tokens: TokenRecord[]): Promise<void> {
    await this.driver.appendTokens(tokens);
  }

  async revokeToken(tokenId: string, revokedAt: string): Promise<void> {
    await this.driver.revokeToken(tokenId, revokedAt);
  }

  async appendAudit(entry: AuditEntry): Promise<void> {
    await this.driver.appendAudit(entry);
  }
}

export class InMemoryMetadataDriver implements MetadataDriver {
  private snapshotValue: MetadataSnapshot = emptySnapshot();

  async snapshot(): Promise<MetadataSnapshot> {
    return structuredClone(this.snapshotValue);
  }

  async upsertProject(project: ProjectRecord): Promise<void> {
    this.snapshotValue.projects = upsertBy(this.snapshotValue.projects, project, (item) => item.id);
  }

  async removeProject(projectId: string): Promise<void> {
    this.snapshotValue.projects = this.snapshotValue.projects.filter((item) => item.id !== projectId);
    this.snapshotValue.databases = this.snapshotValue.databases.filter((item) => item.projectId !== projectId);
    this.snapshotValue.authInstances = this.snapshotValue.authInstances.filter((item) => item.projectId !== projectId);
    this.snapshotValue.tokens = this.snapshotValue.tokens.filter((item) => item.projectId !== projectId);
    this.snapshotValue.buckets = this.snapshotValue.buckets.filter((item) => item.projectId !== projectId);
    this.snapshotValue.routes = this.snapshotValue.routes.filter((item) => item.projectId !== projectId);
  }

  async upsertDatabase(database: DatabaseRecord): Promise<void> {
    this.snapshotValue.databases = upsertBy(this.snapshotValue.databases, database, (item) => item.projectId);
  }

  async upsertAuthInstance(authInstance: AuthInstanceRecord): Promise<void> {
    this.snapshotValue.authInstances = upsertBy(
      this.snapshotValue.authInstances,
      authInstance,
      (item) => item.projectId
    );
  }

  async upsertRoute(route: RouteRecord): Promise<void> {
    this.snapshotValue.routes = upsertBy(this.snapshotValue.routes, route, (item) => item.projectId);
  }

  async upsertBucket(bucket: BucketRecord): Promise<void> {
    this.snapshotValue.buckets = upsertBy(this.snapshotValue.buckets, bucket, (item) => item.id);
  }

  async appendTokens(tokens: TokenRecord[]): Promise<void> {
    this.snapshotValue.tokens.push(...tokens);
  }

  async revokeToken(tokenId: string, revokedAt: string): Promise<void> {
    this.snapshotValue.tokens = this.snapshotValue.tokens.map((token) =>
      token.id === tokenId ? { ...token, revokedAt } : token
    );
  }

  async appendAudit(entry: AuditEntry): Promise<void> {
    this.snapshotValue.auditLogs.push(entry);
  }
}

export class JsonFileMetadataDriver implements MetadataDriver {
  constructor(private readonly filePath: string) {}

  async snapshot(): Promise<MetadataSnapshot> {
    return this.load();
  }

  async upsertProject(project: ProjectRecord): Promise<void> {
    const snapshot = await this.load();
    snapshot.projects = upsertBy(snapshot.projects, project, (item) => item.id);
    await this.save(snapshot);
  }

  async removeProject(projectId: string): Promise<void> {
    const snapshot = await this.load();
    snapshot.projects = snapshot.projects.filter((item) => item.id !== projectId);
    snapshot.databases = snapshot.databases.filter((item) => item.projectId !== projectId);
    snapshot.authInstances = snapshot.authInstances.filter((item) => item.projectId !== projectId);
    snapshot.tokens = snapshot.tokens.filter((item) => item.projectId !== projectId);
    snapshot.buckets = snapshot.buckets.filter((item) => item.projectId !== projectId);
    snapshot.routes = snapshot.routes.filter((item) => item.projectId !== projectId);
    await this.save(snapshot);
  }

  async upsertDatabase(database: DatabaseRecord): Promise<void> {
    const snapshot = await this.load();
    snapshot.databases = upsertBy(snapshot.databases, database, (item) => item.projectId);
    await this.save(snapshot);
  }

  async upsertAuthInstance(authInstance: AuthInstanceRecord): Promise<void> {
    const snapshot = await this.load();
    snapshot.authInstances = upsertBy(snapshot.authInstances, authInstance, (item) => item.projectId);
    await this.save(snapshot);
  }

  async upsertRoute(route: RouteRecord): Promise<void> {
    const snapshot = await this.load();
    snapshot.routes = upsertBy(snapshot.routes, route, (item) => item.projectId);
    await this.save(snapshot);
  }

  async upsertBucket(bucket: BucketRecord): Promise<void> {
    const snapshot = await this.load();
    snapshot.buckets = upsertBy(snapshot.buckets, bucket, (item) => item.id);
    await this.save(snapshot);
  }

  async appendTokens(tokens: TokenRecord[]): Promise<void> {
    const snapshot = await this.load();
    snapshot.tokens.push(...tokens);
    await this.save(snapshot);
  }

  async revokeToken(tokenId: string, revokedAt: string): Promise<void> {
    const snapshot = await this.load();
    snapshot.tokens = snapshot.tokens.map((token) => (token.id === tokenId ? { ...token, revokedAt } : token));
    await this.save(snapshot);
  }

  async appendAudit(entry: AuditEntry): Promise<void> {
    const snapshot = await this.load();
    snapshot.auditLogs.push(entry);
    await this.save(snapshot);
  }

  private async load(): Promise<MetadataSnapshot> {
    try {
      const content = await readFile(this.filePath, "utf8");
      return JSON.parse(content) as MetadataSnapshot;
    } catch (error) {
      const typedError = error as NodeJS.ErrnoException;
      if (typedError.code === "ENOENT") {
        return emptySnapshot();
      }
      throw error;
    }
  }

  private async save(snapshot: MetadataSnapshot): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  }
}

export class PostgresMetadataDriver implements MetadataDriver {
  constructor(private readonly db: SqlQueryable) {}

  async snapshot(): Promise<MetadataSnapshot> {
    const [projects, databases, authInstances, tokens, buckets, routes, auditLogs] = await Promise.all([
      this.db.query<ProjectRow>("SELECT * FROM projects ORDER BY created_at ASC"),
      this.db.query<DatabaseRow>("SELECT * FROM databases ORDER BY created_at ASC"),
      this.db.query<AuthInstanceRow>("SELECT * FROM auth_instances ORDER BY created_at ASC"),
      this.db.query<TokenRow>("SELECT * FROM tokens ORDER BY created_at ASC"),
      this.db.query<BucketRow>("SELECT * FROM buckets ORDER BY created_at ASC"),
      this.db.query<RouteRow>("SELECT * FROM routes ORDER BY created_at ASC"),
      this.db.query<AuditRow>("SELECT * FROM audit_logs ORDER BY created_at ASC")
    ]);

    return {
      projects: projects.rows.map(mapProjectRow),
      databases: databases.rows.map(mapDatabaseRow),
      authInstances: authInstances.rows.map(mapAuthInstanceRow),
      tokens: tokens.rows.map(mapTokenRow),
      buckets: buckets.rows.map(mapBucketRow),
      routes: routes.rows.map(mapRouteRow),
      auditLogs: auditLogs.rows.map(mapAuditRow)
    };
  }

  async upsertProject(project: ProjectRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO projects (id, name, slug, subdomain, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         slug = EXCLUDED.slug,
         subdomain = EXCLUDED.subdomain,
         status = EXCLUDED.status,
         created_at = EXCLUDED.created_at,
         updated_at = EXCLUDED.updated_at`,
      [project.id, project.name, project.slug, project.subdomain, project.status, project.createdAt, project.updatedAt]
    );
  }

  async removeProject(projectId: string): Promise<void> {
    await this.db.query("DELETE FROM projects WHERE id = $1", [projectId]);
  }

  async upsertDatabase(database: DatabaseRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO databases (project_id, database_name, host, writer_role, reader_role, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (project_id) DO UPDATE SET
         database_name = EXCLUDED.database_name,
         host = EXCLUDED.host,
         writer_role = EXCLUDED.writer_role,
         reader_role = EXCLUDED.reader_role,
         created_at = EXCLUDED.created_at`,
      [database.projectId, database.databaseName, database.host, database.writerRole, database.readerRole, database.createdAt]
    );
  }

  async upsertAuthInstance(authInstance: AuthInstanceRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO auth_instances (project_id, container_id, auth_url, upstream_url, public_key_id, private_key_ref, status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (project_id) DO UPDATE SET
         container_id = EXCLUDED.container_id,
         auth_url = EXCLUDED.auth_url,
         upstream_url = EXCLUDED.upstream_url,
         public_key_id = EXCLUDED.public_key_id,
         private_key_ref = EXCLUDED.private_key_ref,
         status = EXCLUDED.status,
         created_at = EXCLUDED.created_at`,
      [
        authInstance.projectId,
        authInstance.containerId,
        authInstance.authUrl,
        authInstance.upstreamUrl,
        authInstance.publicKeyId,
        authInstance.privateKeyRef,
        authInstance.status,
        authInstance.createdAt
      ]
    );
  }

  async upsertRoute(route: RouteRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO routes (project_id, subdomain, auth_target, database_target, tls_mode, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (project_id) DO UPDATE SET
         subdomain = EXCLUDED.subdomain,
         auth_target = EXCLUDED.auth_target,
         database_target = EXCLUDED.database_target,
         tls_mode = EXCLUDED.tls_mode,
         created_at = EXCLUDED.created_at`,
      [route.projectId, route.subdomain, route.authTarget, route.databaseTarget, route.tlsMode, route.createdAt]
    );
  }

  async upsertBucket(bucket: BucketRecord): Promise<void> {
    await this.db.query(
      `INSERT INTO buckets (id, project_id, name, backend, visibility, cache_mode, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO UPDATE SET
         project_id = EXCLUDED.project_id,
         name = EXCLUDED.name,
         backend = EXCLUDED.backend,
         visibility = EXCLUDED.visibility,
         cache_mode = EXCLUDED.cache_mode,
         created_at = EXCLUDED.created_at`,
      [bucket.id, bucket.projectId, bucket.name, bucket.backend, bucket.visibility, bucket.cacheMode, bucket.createdAt]
    );
  }

  async appendTokens(tokens: TokenRecord[]): Promise<void> {
    for (const token of tokens) {
      await this.db.query(
        `INSERT INTO tokens (id, project_id, scope, hash, expires_at, revoked_at, access_mode, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          token.id,
          token.projectId,
          token.scope,
          token.hash,
          token.expiresAt,
          token.revokedAt,
          token.accessMode,
          token.createdAt
        ]
      );
    }
  }

  async revokeToken(tokenId: string, revokedAt: string): Promise<void> {
    await this.db.query("UPDATE tokens SET revoked_at = $2 WHERE id = $1", [tokenId, revokedAt]);
  }

  async appendAudit(entry: AuditEntry): Promise<void> {
    await this.db.query(
      `INSERT INTO audit_logs (id, project_id, action, phase, details, created_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [entry.id, entry.projectId, entry.action, entry.phase, JSON.stringify(entry.details), entry.createdAt]
    );
  }
}

interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  subdomain: string;
  status: ProjectRecord["status"];
  created_at: string | Date;
  updated_at: string | Date;
}

interface DatabaseRow {
  project_id: string;
  database_name: string;
  host: string;
  writer_role: string;
  reader_role: string;
  created_at: string | Date;
}

interface AuthInstanceRow {
  project_id: string;
  container_id: string;
  auth_url: string;
  upstream_url: string;
  public_key_id: string;
  private_key_ref: string;
  status: AuthInstanceRecord["status"];
  created_at: string | Date;
}

interface TokenRow {
  id: string;
  project_id: string;
  scope: TokenRecord["scope"];
  hash: string;
  expires_at: string | Date;
  revoked_at: string | Date | null;
  access_mode: TokenRecord["accessMode"];
  created_at: string | Date;
}

interface BucketRow {
  id: string;
  project_id: string;
  name: string;
  backend: BucketRecord["backend"];
  visibility: BucketRecord["visibility"];
  cache_mode: BucketRecord["cacheMode"];
  created_at: string | Date;
}

interface RouteRow {
  project_id: string;
  subdomain: string;
  auth_target: string;
  database_target: string;
  tls_mode: RouteRecord["tlsMode"];
  created_at: string | Date;
}

interface AuditRow {
  id: string;
  project_id: string | null;
  action: string;
  phase: AuditEntry["phase"];
  details: Record<string, unknown>;
  created_at: string | Date;
}

function mapProjectRow(row: ProjectRow): ProjectRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    subdomain: row.subdomain,
    status: row.status,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at)
  };
}

function mapDatabaseRow(row: DatabaseRow): DatabaseRecord {
  return {
    projectId: row.project_id,
    databaseName: row.database_name,
    host: row.host,
    writerRole: row.writer_role,
    readerRole: row.reader_role,
    createdAt: toIso(row.created_at)
  };
}

function mapAuthInstanceRow(row: AuthInstanceRow): AuthInstanceRecord {
  return {
    projectId: row.project_id,
    containerId: row.container_id,
    authUrl: row.auth_url,
    upstreamUrl: row.upstream_url,
    publicKeyId: row.public_key_id,
    privateKeyRef: row.private_key_ref,
    status: row.status,
    createdAt: toIso(row.created_at)
  };
}

function mapTokenRow(row: TokenRow): TokenRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    scope: row.scope,
    hash: row.hash,
    expiresAt: toIso(row.expires_at),
    revokedAt: row.revoked_at ? toIso(row.revoked_at) : null,
    accessMode: row.access_mode,
    createdAt: toIso(row.created_at)
  };
}

function mapBucketRow(row: BucketRow): BucketRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    backend: row.backend,
    visibility: row.visibility,
    cacheMode: row.cache_mode,
    createdAt: toIso(row.created_at)
  };
}

function mapRouteRow(row: RouteRow): RouteRecord {
  return {
    projectId: row.project_id,
    subdomain: row.subdomain,
    authTarget: row.auth_target,
    databaseTarget: row.database_target,
    tlsMode: row.tls_mode,
    createdAt: toIso(row.created_at)
  };
}

function mapAuditRow(row: AuditRow): AuditEntry {
  return {
    id: row.id,
    projectId: row.project_id,
    action: row.action,
    phase: row.phase,
    details: row.details ?? {},
    createdAt: toIso(row.created_at)
  };
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function upsertBy<T>(items: T[], item: T, selector: (value: T) => string): T[] {
  const key = selector(item);
  const index = items.findIndex((value) => selector(value) === key);
  if (index === -1) {
    return [...items, item];
  }

  const copy = [...items];
  copy[index] = item;
  return copy;
}
