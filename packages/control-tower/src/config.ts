import path from "node:path";
import {
  DockerCliAuthRuntime,
  DockerCliPostgrestRuntime,
  DockerEngineClient,
  RealAuthRuntime,
  RealPostgrestRuntime,
  type DockerRuntimeConfig,
  type GoTrueEnvConfig
} from "./docker.js";
import { CaddyAdminRoutePublisher } from "./caddy.js";
import { PostgresClient, RealDatabaseRuntime } from "./postgres.js";
import {
  JsonFileMetadataDriver,
  MetadataRepository,
  PostgresMetadataDriver
} from "./store.js";
import {
  FakeAuthRuntime,
  FakeDatabaseRuntime,
  ProvisioningService
} from "./services.js";

export interface ControlTowerApp {
  repository: MetadataRepository;
  provisioningService: ProvisioningService;
  close(): Promise<void>;
}

export type ControlTowerMode = "dev" | "real";

export interface ControlTowerConfig {
  mode: ControlTowerMode;
  dataFile: string;
  metadataDatabaseUrl?: string;
  superPostgresUrl?: string;
  projectDatabaseUrlTemplate: string;
  projectHost: string;
  dockerBaseUrl?: string;
  dockerSocketPath?: string;
  gotrueImage: string;
  authPort: number;
  postgrestImage: string;
  postgrestPort: number;
  postgrestDbUriTemplate: string;
  storageUpstream: string;
  secretDirectory: string;
  dockerNetworkName?: string;
  dockerHostGatewayName: string;
  dockerPublishedPortBase: number;
  gotrueDbUrlTemplate: string;
  gotrueSiteUrlTemplate: string;
  gotrueExternalUrlTemplate: string;
  gotrueDisableSignup: boolean;
  gotrueJwtExpirySeconds: number;
  gotrueJwtAudience: string;
  gotrueRedirectAllowList: string;
  metadataSchemaFile: string;
  caddyAdminOrigin: string;
  caddyListenAddress: string;
  caddyHttpsListenAddress: string;
  caddyTlsEnabled: boolean;
  caddyAcmeEmail?: string;
  caddyPanelDomain?: string;
  caddyPanelUpstream?: string;
  storageRoot: string;
  importWorkspaceRoot: string;
  backupRoot: string;
  cacheRoot: string;
  hotStorageRoot: string;
  coldStorageRoot: string;
  backupRetentionCount: number;
}

export function loadControlTowerConfig(env: NodeJS.ProcessEnv = process.env): ControlTowerConfig {
  const root = process.cwd();
  return {
    mode: env.CONTROL_TOWER_MODE === "real" ? "real" : "dev",
    dataFile: env.CONTROL_TOWER_DATA_FILE ?? path.join(root, ".data", "control-tower.json"),
    metadataDatabaseUrl: env.CONTROL_TOWER_METADATA_DATABASE_URL,
    superPostgresUrl: env.CONTROL_TOWER_SUPER_POSTGRES_URL,
    projectDatabaseUrlTemplate:
      env.CONTROL_TOWER_PROJECT_DATABASE_URL_TEMPLATE ??
      "postgres://{roleName}:{rolePassword}@127.0.0.1:5433/{databaseName}",
    projectHost: env.CONTROL_TOWER_PROJECT_DB_HOST ?? "postgres://super-postgres.internal:5432",
    dockerBaseUrl: env.CONTROL_TOWER_DOCKER_BASE_URL,
    dockerSocketPath: env.CONTROL_TOWER_DOCKER_SOCKET_PATH,
    gotrueImage: env.CONTROL_TOWER_GOTRUE_IMAGE ?? "supabase/auth:v2.192.0",
    authPort: Number(env.CONTROL_TOWER_GOTRUE_PORT ?? "9999"),
    postgrestImage: env.CONTROL_TOWER_POSTGREST_IMAGE ?? "postgrest/postgrest:v12.2.3",
    postgrestPort: Number(env.CONTROL_TOWER_POSTGREST_PORT ?? "3000"),
    postgrestDbUriTemplate:
      env.CONTROL_TOWER_POSTGREST_DB_URI_TEMPLATE ??
      "postgres://authenticator:{authenticatorPassword}@postgres:5432/{databaseName}",
    storageUpstream: env.CONTROL_TOWER_STORAGE_UPSTREAM ?? "",
    secretDirectory: env.CONTROL_TOWER_SECRET_DIR ?? path.join(root, ".data", "secrets"),
    dockerNetworkName: env.CONTROL_TOWER_DOCKER_NETWORK_NAME,
    dockerHostGatewayName: env.CONTROL_TOWER_DOCKER_HOST_GATEWAY_NAME ?? "host.docker.internal",
    dockerPublishedPortBase: Number(env.CONTROL_TOWER_DOCKER_PUBLISHED_PORT_BASE ?? "11000"),
    gotrueDbUrlTemplate:
      env.CONTROL_TOWER_GOTRUE_DB_URL_TEMPLATE ??
      "postgres://supabase_auth_admin:password@postgres:5432/{databaseName}?sslmode=disable",
    gotrueSiteUrlTemplate: env.CONTROL_TOWER_GOTRUE_SITE_URL_TEMPLATE ?? "https://{subdomain}",
    gotrueExternalUrlTemplate: env.CONTROL_TOWER_GOTRUE_EXTERNAL_URL_TEMPLATE ?? "https://{subdomain}/auth",
    gotrueDisableSignup: env.CONTROL_TOWER_GOTRUE_DISABLE_SIGNUP === "true",
    gotrueJwtExpirySeconds: Number(env.CONTROL_TOWER_GOTRUE_JWT_EXPIRY ?? "3600"),
    gotrueJwtAudience: env.CONTROL_TOWER_GOTRUE_JWT_AUDIENCE ?? "authenticated",
    gotrueRedirectAllowList: env.CONTROL_TOWER_GOTRUE_URI_ALLOW_LIST ?? "https://*.fbr.news,https://*.lab.fbr.news",
    metadataSchemaFile:
      env.CONTROL_TOWER_METADATA_SCHEMA_FILE ??
      path.join(root, "packages", "control-tower", "sql", "001_control_plane.sql"),
    caddyAdminOrigin: env.CONTROL_TOWER_CADDY_ADMIN_ORIGIN ?? "http://127.0.0.1:2019",
    caddyListenAddress: env.CONTROL_TOWER_CADDY_LISTEN_ADDRESS ?? ":80",
    caddyHttpsListenAddress: env.CONTROL_TOWER_CADDY_HTTPS_LISTEN_ADDRESS ?? ":443",
    caddyTlsEnabled: env.CONTROL_TOWER_CADDY_TLS_ENABLED === "true",
    caddyAcmeEmail: env.CONTROL_TOWER_CADDY_ACME_EMAIL,
    caddyPanelDomain: env.CONTROL_TOWER_CADDY_PANEL_DOMAIN,
    caddyPanelUpstream: env.CONTROL_TOWER_CADDY_PANEL_UPSTREAM,
    storageRoot: env.CONTROL_TOWER_STORAGE_ROOT ?? path.join(root, ".data", "storage"),
    importWorkspaceRoot: env.CONTROL_TOWER_IMPORT_ROOT ?? path.join(root, ".data", "imports"),
    backupRoot: env.CONTROL_TOWER_BACKUP_ROOT ?? path.join(root, ".data", "backups"),
    cacheRoot: env.CONTROL_TOWER_CACHE_ROOT ?? path.join(root, ".data", "cache"),
    hotStorageRoot: env.CONTROL_TOWER_HOT_STORAGE_ROOT ?? path.join(root, ".data", "storage-hot"),
    coldStorageRoot: env.CONTROL_TOWER_COLD_STORAGE_ROOT ?? path.join(root, ".data", "storage-cold"),
    backupRetentionCount: Number(env.CONTROL_TOWER_BACKUP_RETENTION_COUNT ?? "12")
  };
}

export async function createControlTowerApp(config: ControlTowerConfig): Promise<ControlTowerApp> {
  if (config.mode === "dev") {
    const repository = new MetadataRepository(new JsonFileMetadataDriver(config.dataFile));
    const provisioningService = new ProvisioningService(repository, {
      databaseRuntime: new FakeDatabaseRuntime(),
      authRuntime: new FakeAuthRuntime()
    });
    return {
      repository,
      provisioningService,
      async close() {}
    };
  }

  if (!config.metadataDatabaseUrl) {
    throw new Error("CONTROL_TOWER_METADATA_DATABASE_URL is required in real mode");
  }
  if (!config.superPostgresUrl) {
    throw new Error("CONTROL_TOWER_SUPER_POSTGRES_URL is required in real mode");
  }

  const metadataClient = new PostgresClient(config.metadataDatabaseUrl);
  const adminClient = new PostgresClient(config.superPostgresUrl);
  const dockerConfig: DockerRuntimeConfig = {
    baseUrl: config.dockerBaseUrl,
    socketPath: config.dockerSocketPath,
    gotrueImage: config.gotrueImage,
    authPort: config.authPort,
    postgrestImage: config.postgrestImage,
    postgrestPort: config.postgrestPort,
    secretDirectory: config.secretDirectory,
    networkName: config.dockerNetworkName,
    hostGatewayName: config.dockerHostGatewayName,
    publishedPortBase: config.dockerPublishedPortBase
  };
  const gotrueConfig: GoTrueEnvConfig = {
    dbDatabaseUrlTemplate: config.gotrueDbUrlTemplate,
    siteUrlTemplate: config.gotrueSiteUrlTemplate,
    externalUrlTemplate: config.gotrueExternalUrlTemplate,
    disableSignup: config.gotrueDisableSignup,
    jwtExpirySeconds: config.gotrueJwtExpirySeconds,
    jwtAudience: config.gotrueJwtAudience,
    redirectAllowList: config.gotrueRedirectAllowList
  };

  const repository = new MetadataRepository(new PostgresMetadataDriver(metadataClient));
  const dockerEngine = new DockerEngineClient(dockerConfig);
  const authRuntime =
    config.dockerBaseUrl || config.dockerSocketPath
      ? new RealAuthRuntime(dockerEngine, dockerConfig, gotrueConfig)
      : new DockerCliAuthRuntime(dockerConfig, gotrueConfig);
  const postgrestRuntime =
    config.dockerBaseUrl || config.dockerSocketPath
      ? new RealPostgrestRuntime(dockerEngine, dockerConfig)
      : new DockerCliPostgrestRuntime(dockerConfig);
  const routePublisher = new CaddyAdminRoutePublisher({
    adminOrigin: config.caddyAdminOrigin,
    listenAddress: config.caddyListenAddress,
    httpsListenAddress: config.caddyHttpsListenAddress,
    tlsEnabled: config.caddyTlsEnabled,
    acmeEmail: config.caddyAcmeEmail,
    panelDomain: config.caddyPanelDomain,
    panelUpstream: config.caddyPanelUpstream
  });
  const provisioningService = new ProvisioningService(repository, {
    databaseRuntime: new RealDatabaseRuntime(adminClient, {
      adminDatabaseUrl: config.superPostgresUrl,
      projectHost: config.projectHost,
      secretDirectory: config.secretDirectory
    }),
    authRuntime,
    postgrestRuntime,
    postgrestDbUriTemplate: config.postgrestDbUriTemplate,
    storageUpstream: config.storageUpstream || undefined,
    routePublisher
  });

  return {
    repository,
    provisioningService,
    async close() {
      await metadataClient.close();
      await adminClient.close();
    }
  };
}
