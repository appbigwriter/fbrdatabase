import crypto from "node:crypto";
import type {
  AccessMode,
  AuditEntry,
  AuthInstanceRecord,
  BackupPlan,
  BucketBackend,
  BucketRecord,
  BucketVisibility,
  DashboardProjectView,
  DatabaseRecord,
  ImportReport,
  McpProjectProfile,
  MetadataSnapshot,
  ProjectManifest,
  ProjectRecord,
  RouteRecord,
  RoutePublisher,
  TlsMode,
  TlsStrategy,
  TokenRecord,
  TokenScope
} from "./types.js";
import { MetadataRepository } from "./store.js";

export interface ProvisioningDependencies {
  databaseRuntime: DatabaseRuntime;
  authRuntime: AuthRuntime;
  routePublisher?: RoutePublisher;
  clock?: () => string;
  randomId?: () => string;
}

export interface DatabaseRuntime {
  createDatabase(projectId: string, manifest: ProjectManifest): Promise<{ host: string }>;
  createRoles(projectId: string, manifest: ProjectManifest): Promise<{ writerRole: string; readerRole: string }>;
  deleteDatabase(projectId: string, manifest: ProjectManifest): Promise<void>;
}

export interface AuthRuntime {
  createInstance(
    projectId: string,
    manifest: ProjectManifest
  ): Promise<{ containerId: string; authUrl: string; upstreamUrl: string; publicKeyId: string; privateKeyRef: string }>;
  deleteInstance(projectId: string, manifest: ProjectManifest): Promise<void>;
}

export class ProvisioningService {
  private readonly now: () => string;
  private readonly makeId: () => string;

  constructor(
    private readonly repository: MetadataRepository,
    private readonly dependencies: ProvisioningDependencies
  ) {
    this.now = dependencies.clock ?? (() => new Date().toISOString());
    this.makeId = dependencies.randomId ?? (() => crypto.randomUUID());
  }

  async provisionProject(manifest: ProjectManifest, tlsMode: TlsMode = "per-subdomain"): Promise<ProjectRecord> {
    const projectId = this.makeId();
    const startedAt = this.now();
    const project: ProjectRecord = {
      id: projectId,
      name: manifest.name,
      slug: manifest.slug,
      subdomain: manifest.subdomain,
      status: "provisioning",
      createdAt: startedAt,
      updatedAt: startedAt
    };

    await this.audit(project.id, "project.provision", "started", { slug: manifest.slug });
    await this.repository.upsertProject(project);

    const completedSteps: Array<() => Promise<void>> = [];

    try {
      const databaseRuntime = await this.dependencies.databaseRuntime.createDatabase(project.id, manifest);
      completedSteps.push(() => this.dependencies.databaseRuntime.deleteDatabase(project.id, manifest));
      const roles = await this.dependencies.databaseRuntime.createRoles(project.id, manifest);

      const databaseRecord: DatabaseRecord = {
        projectId: project.id,
        databaseName: manifest.databaseName,
        host: databaseRuntime.host,
        writerRole: roles.writerRole,
        readerRole: roles.readerRole,
        createdAt: this.now()
      };
      await this.repository.upsertDatabase(databaseRecord);

      const auth = await this.dependencies.authRuntime.createInstance(project.id, manifest);
      completedSteps.push(() => this.dependencies.authRuntime.deleteInstance(project.id, manifest));
      const authRecord: AuthInstanceRecord = {
        projectId: project.id,
        containerId: auth.containerId,
        authUrl: auth.authUrl,
        upstreamUrl: auth.upstreamUrl,
        publicKeyId: auth.publicKeyId,
        privateKeyRef: auth.privateKeyRef,
        status: "ready",
        createdAt: this.now()
      };
      await this.repository.upsertAuthInstance(authRecord);

      const routeRecord: RouteRecord = {
        projectId: project.id,
        subdomain: manifest.subdomain,
        authTarget: auth.upstreamUrl,
        databaseTarget: databaseRecord.host,
        tlsMode,
        createdAt: this.now()
      };
      await this.repository.upsertRoute(routeRecord);

      const tokens = issueInitialTokens(project.id, manifest.tokens, this.now, this.makeId);
      await this.repository.appendTokens(tokens);

      const activeProject: ProjectRecord = { ...project, status: "active", updatedAt: this.now() };
      await this.repository.upsertProject(activeProject);
      await this.audit(project.id, "project.provision", "completed", { tokens: tokens.length });
      await this.publishRoutes(project.id, manifest.subdomain);
      return activeProject;
    } catch (error) {
      for (const step of completedSteps.reverse()) {
        await step();
      }
      await this.repository.removeProject(project.id);
      await this.audit(project.id, "project.provision", "failed", {
        message: error instanceof Error ? error.message : "Unknown failure"
      });
      throw error;
    }
  }

  async deprovisionProject(projectId: string, confirmation: string): Promise<void> {
    const snapshot = await this.repository.snapshot();
    const project = snapshot.projects.find((item) => item.id === projectId);
    if (!project) {
      throw new Error(`Project ${projectId} not found`);
    }
    if (confirmation !== project.slug) {
      throw new Error("Confirmation slug mismatch");
    }
    const database = snapshot.databases.find((item) => item.projectId === projectId);
    if (!database) {
      throw new Error(`Database metadata missing for project ${projectId}`);
    }
    const manifest = snapshotToManifest(project, database);

    await this.audit(projectId, "project.deprovision", "started", { slug: project.slug });
    await this.dependencies.authRuntime.deleteInstance(projectId, manifest);
    await this.dependencies.databaseRuntime.deleteDatabase(projectId, manifest);
    await this.repository.removeProject(projectId);
    await this.publishRoutes(projectId, project.subdomain);
    await this.audit(projectId, "project.deprovision", "completed", { slug: project.slug });
  }

  private async audit(
    projectId: string | null,
    action: string,
    phase: AuditEntry["phase"],
    details: Record<string, unknown>
  ): Promise<void> {
    await this.repository.appendAudit({
      id: this.makeId(),
      projectId,
      action,
      phase,
      details,
      createdAt: this.now()
    });
  }

  private async publishRoutes(projectId: string | null, subdomain: string): Promise<void> {
    if (!this.dependencies.routePublisher) {
      return;
    }
    try {
      const snapshot = await this.repository.snapshot();
      await this.dependencies.routePublisher.publishRoutes(snapshot);
      await this.audit(projectId, "route.publish", "completed", { subdomain });
    } catch (error) {
      await this.audit(projectId, "route.publish", "failed", {
        subdomain,
        message: error instanceof Error ? error.message : "Unknown route publish failure"
      });
    }
  }
}

export function issueInitialTokens(
  projectId: string,
  tokenExpirations: Record<TokenScope, string>,
  now: () => string,
  makeId: () => string
): TokenRecord[] {
  return (["service", "anon", "mcp"] as const).map((scope) => {
    const rawValue = `${projectId}:${scope}:${makeId()}`;
    const hash = crypto.createHash("sha256").update(rawValue).digest("hex");
    return {
      id: makeId(),
      projectId,
      scope,
      hash,
      expiresAt: tokenExpirations[scope],
      revokedAt: null,
      accessMode: scope === "mcp" ? "read-only" : "read-write",
      createdAt: now()
    };
  });
}

export function buildBackupPlan(): BackupPlan {
  return {
    cadence: "Nightly pg_dump for the super Postgres plus weekly restore rehearsal",
    retention: "Keep 7 daily, 4 weekly, and 3 monthly snapshots",
    restoreExercise: "Restore the latest dump into an isolated validation database and run smoke checks",
    outputArtifact: "Write the latest backup result into the control plane metadata and operator runbook"
  };
}

export function defineTlsStrategy(): TlsStrategy {
  return {
    mode: "per-subdomain",
    rationale:
      "Use per-subdomain certificate issuance until wildcard DNS challenge support is validated for the Cloudflare token format in production.",
    fallback:
      "Switch to wildcard only after the Caddy and Cloudflare integration has been proven on the target infrastructure."
  };
}

export function buildImportReport(projectId: string): ImportReport {
  return {
    projectId,
    importedSchemas: ["public", "auth"],
    recreatedRoles: ["authenticated", "anon", "service_role"],
    preservedPasswordLogin: true,
    outOfScope: ["edge functions", "social login", "automatic secret migration"],
    manualFollowUps: ["Review RLS policies that depend on custom extensions or environment-specific secrets."]
  };
}

export function buildDashboard(snapshot: MetadataSnapshot): DashboardProjectView[] {
  return snapshot.projects.map((project) => {
    const database = snapshot.databases.find((item) => item.projectId === project.id);
    const authInstance = snapshot.authInstances.find((item) => item.projectId === project.id);
    const route = snapshot.routes.find((item) => item.projectId === project.id);
    const backupCompleted = snapshot.auditLogs.find(
      (entry) => entry.projectId === project.id && entry.action === "backup.run" && entry.phase === "completed"
    );
    return {
      projectId: project.id,
      name: project.name,
      slug: project.slug,
      subdomain: project.subdomain,
      status: project.status,
      databaseName: database?.databaseName ?? null,
      userCount: 0,
      diskUsageGb: 0,
      authStatus: authInstance?.status ?? "missing",
      routeStatus: route ? "published" : "missing",
      tokenCount: snapshot.tokens.filter((item) => item.projectId === project.id && !item.revokedAt).length,
      bucketCount: snapshot.buckets.filter((item) => item.projectId === project.id).length,
      lastBackupStatus: backupCompleted ? "healthy" : "unknown",
      createdAt: project.createdAt
    };
  });
}

export function createBucket(
  projectId: string,
  name: string,
  visibility: BucketVisibility,
  backend: BucketBackend = "ssd",
  now: () => string = () => new Date().toISOString(),
  makeId: () => string = () => crypto.randomUUID()
): BucketRecord {
  return {
    id: makeId(),
    projectId,
    name,
    backend,
    visibility,
    cacheMode: visibility === "public" ? "aggressive" : "standard",
    createdAt: now()
  };
}

export function buildMcpProfile(projectId: string, tokenScope: TokenScope = "mcp"): McpProjectProfile {
  const writeRequiresConfirmation = true;
  const tools = [
    "list_tables",
    "describe_schema",
    "run_read_only_query",
    ...(writeRequiresConfirmation ? ["run_write_query_with_confirmation"] : [])
  ];
  return {
    projectId,
    tokenScope,
    tools,
    writeRequiresConfirmation
  };
}

export function buildHealthSummary(snapshot: MetadataSnapshot): Record<string, unknown> {
  return {
    projects: snapshot.projects.length,
    authInstancesReady: snapshot.authInstances.filter((item) => item.status === "ready").length,
    routesConfigured: snapshot.routes.length,
    warnings: snapshot.projects.some((item) => item.status !== "active") ? ["Some projects are not active"] : []
  };
}

export function buildPanelContracts(snapshot: MetadataSnapshot): Record<string, unknown> {
  return {
    dashboard: buildDashboard(snapshot),
    projectDetailTabs: ["overview", "sql", "tables", "tokens", "buckets", "auth-emails", "backups"]
  };
}

export function buildSecurityChecklist(): string[] {
  return [
    "Store secrets in a managed secret backend before production deployment.",
    "Keep Postgres bound to private networking only.",
    "Require strong admin authentication before exposing the panel.",
    "Default MCP access to read-only and log every privileged action."
  ];
}

export class FakeDatabaseRuntime implements DatabaseRuntime {
  public readonly events: string[] = [];

  constructor(private readonly failOn: "createDatabase" | "createRoles" | null = null) {}

  async createDatabase(_projectId: string, _manifest: ProjectManifest): Promise<{ host: string }> {
    this.events.push("createDatabase");
    if (this.failOn === "createDatabase") {
      throw new Error("Database creation failed");
    }
    return { host: "postgres://super-postgres.internal:5432" };
  }

  async createRoles(_projectId: string, manifest: ProjectManifest): Promise<{ writerRole: string; readerRole: string }> {
    this.events.push("createRoles");
    if (this.failOn === "createRoles") {
      throw new Error("Role creation failed");
    }
    return {
      writerRole: `${manifest.slug}_writer`,
      readerRole: `${manifest.slug}_reader`
    };
  }

  async deleteDatabase(projectId: string, _manifest: ProjectManifest): Promise<void> {
    this.events.push(`deleteDatabase:${projectId}`);
  }
}

export class FakeAuthRuntime implements AuthRuntime {
  public readonly events: string[] = [];

  constructor(private readonly fail = false) {}

  async createInstance(
    projectId: string,
    manifest: ProjectManifest
  ): Promise<{ containerId: string; authUrl: string; upstreamUrl: string; publicKeyId: string; privateKeyRef: string }> {
    this.events.push("createInstance");
    if (this.fail) {
      throw new Error("Auth provisioning failed");
    }
    return {
      containerId: `gotrue-${projectId}`,
      authUrl: `https://${manifest.subdomain}/auth`,
      upstreamUrl: `http://gotrue-${manifest.slug}:9999`,
      publicKeyId: `${manifest.slug}-pub`,
      privateKeyRef: `secret://${manifest.slug}/jwt-private-key`
    };
  }

  async deleteInstance(projectId: string, _manifest: ProjectManifest): Promise<void> {
    this.events.push(`deleteInstance:${projectId}`);
  }
}

function snapshotToManifest(project: ProjectRecord, database: DatabaseRecord): ProjectManifest {
  return {
    name: project.name,
    slug: project.slug,
    subdomain: project.subdomain,
    databaseName: database.databaseName,
    ownerEmail: "unknown@local",
    tokens: {
      service: new Date(0).toISOString(),
      anon: new Date(0).toISOString(),
      mcp: new Date(0).toISOString()
    }
  };
}
