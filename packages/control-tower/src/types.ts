export type ProjectStatus =
  | "draft"
  | "provisioning"
  | "active"
  | "error"
  | "deprovisioning"
  | "deleted";

export type TokenScope = "service" | "anon" | "mcp";
export type AccessMode = "read-only" | "read-write";
export type BucketBackend = "ssd" | "nas";
export type BucketVisibility = "public" | "private";
export type TlsMode = "wildcard" | "per-subdomain";

export interface ProjectManifest {
  name: string;
  slug: string;
  subdomain: string;
  databaseName: string;
  ownerEmail: string;
  tokens: Record<TokenScope, string>;
}

export interface ProjectRecord {
  id: string;
  name: string;
  slug: string;
  subdomain: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DatabaseRecord {
  projectId: string;
  databaseName: string;
  host: string;
  writerRole: string;
  readerRole: string;
  createdAt: string;
}

export interface AuthInstanceRecord {
  projectId: string;
  containerId: string;
  authUrl: string;
  upstreamUrl: string;
  publicKeyId: string;
  privateKeyRef: string;
  status: "ready" | "failed";
  createdAt: string;
}

export interface TokenRecord {
  id: string;
  projectId: string;
  scope: TokenScope;
  hash: string;
  expiresAt: string;
  revokedAt: string | null;
  accessMode: AccessMode;
  createdAt: string;
}

export interface BucketRecord {
  id: string;
  projectId: string;
  name: string;
  backend: BucketBackend;
  visibility: BucketVisibility;
  cacheMode: "aggressive" | "standard";
  createdAt: string;
}

export interface RouteRecord {
  projectId: string;
  subdomain: string;
  authTarget: string;
  databaseTarget: string;
  tlsMode: TlsMode;
  createdAt: string;
}

export interface CaddyRouteConfig {
  adminOrigin: string;
  config: Record<string, unknown>;
  routeCount: number;
}

export interface SmokeTestReport {
  mode: "dev" | "real";
  provisionedProjectId: string;
  routeCount: number;
  dashboardProjects: number;
  caddyConfigPath: string;
  warnings: string[];
}

export interface AuditEntry {
  id: string;
  projectId: string | null;
  action: string;
  phase: "started" | "completed" | "failed";
  details: Record<string, unknown>;
  createdAt: string;
}

export interface BackupPlan {
  cadence: string;
  retention: string;
  restoreExercise: string;
  outputArtifact: string;
}

export interface TlsStrategy {
  mode: TlsMode;
  rationale: string;
  fallback: string;
}

export interface DashboardProjectView {
  projectId: string;
  name: string;
  slug: string;
  subdomain: string;
  status: ProjectStatus;
  databaseName: string | null;
  userCount: number;
  diskUsageGb: number;
  authStatus: "ready" | "failed" | "missing";
  routeStatus: "published" | "missing";
  tokenCount: number;
  bucketCount: number;
  lastBackupStatus: "unknown" | "healthy" | "stale";
  createdAt: string;
}

export interface ImportReport {
  projectId: string;
  importedSchemas: string[];
  recreatedRoles: string[];
  preservedPasswordLogin: boolean;
  outOfScope: string[];
  manualFollowUps: string[];
}

export interface SqlHistoryEntry {
  id: string;
  projectId: string;
  sql: string;
  rowCount: number;
  executedAt: string;
  status: "completed" | "failed";
  message: string | null;
}

export interface IssuedTokenSecret {
  token: TokenRecord;
  secret: string;
}

export interface TablePreview {
  tableName: string;
  estimatedRows: number;
  columns: string[];
}

export interface TableQueryResult {
  tableName: string;
  columns: string[];
  rows: Record<string, unknown>[];
  totalRows: number;
  page: number;
  pageSize: number;
  totalPages: number;
  sort: {
    column: string | null;
    direction: "asc" | "desc";
  };
  filter: string;
}

export interface ProjectBackupRecord {
  id: string;
  projectId: string;
  fileName: string;
  filePath: string;
  sizeBytes: number;
  createdAt: string;
  status: "completed" | "failed";
}

export interface SystemHealthSnapshot {
  host: {
    platform: string;
    uptimeSeconds: number;
    cpuCores: number;
    totalMemoryMb: number;
    freeMemoryMb: number;
    loadAverage: number[];
    diskTotalGb: number;
    diskFreeGb: number;
  };
  containers: Array<{
    name: string;
    status: string;
    health: string;
  }>;
  warnings: string[];
}

export interface McpProjectProfile {
  projectId: string;
  tokenScope: TokenScope;
  tools: string[];
  writeRequiresConfirmation: boolean;
}

export interface MetadataSnapshot {
  projects: ProjectRecord[];
  databases: DatabaseRecord[];
  authInstances: AuthInstanceRecord[];
  tokens: TokenRecord[];
  buckets: BucketRecord[];
  routes: RouteRecord[];
  auditLogs: AuditEntry[];
}

/**
 * Publishes the full set of project routes to the routing layer (Caddy).
 * Implementations rebuild the complete config from the snapshot and push it,
 * so the operation is idempotent and safe to call after every provision/deprovision.
 */
export interface RoutePublisher {
  publishRoutes(snapshot: MetadataSnapshot): Promise<void>;
}
