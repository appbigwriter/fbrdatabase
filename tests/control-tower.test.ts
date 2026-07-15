import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  FakeAuthRuntime,
  FakeDatabaseRuntime,
  FakePostgrestRuntime,
  InMemoryMetadataDriver,
  MetadataRepository,
  ProvisioningService,
  RealAuthRuntime,
  StorageGateway,
  assertIdentifier,
  buildCaddyRouteConfig,
  buildDashboard,
  buildImportReport,
  buildMcpProfile,
  buildSecurityChecklist,
  createControlTowerApp,
  createSupabaseKeySet,
  generateJwtSecret,
  publishCaddyConfig,
  defineTlsStrategy,
  loadControlTowerConfig,
  runSmokeTest,
  signJwt,
  verifyJwt,
  createBucket
} from "../packages/control-tower/src/index.js";
import type { MetadataSnapshot, ProjectManifest } from "../packages/control-tower/src/index.js";

const manifest: ProjectManifest = {
  name: "Control Tower Project",
  slug: "control-tower-project",
  subdomain: "control-tower.lab.fbr.news",
  databaseName: "control_tower_project",
  ownerEmail: "owner@fbr.news",
  tokens: {
    service: "2030-01-01T00:00:00.000Z",
    anon: "2030-01-01T00:00:00.000Z",
    mcp: "2030-01-01T00:00:00.000Z"
  }
};

test("provisionProject stores metadata and issues three hashed tokens", async () => {
  const repository = new MetadataRepository(new InMemoryMetadataDriver());
  const service = new ProvisioningService(repository, {
    databaseRuntime: new FakeDatabaseRuntime(),
    authRuntime: new FakeAuthRuntime(),
    clock: () => "2026-06-29T00:00:00.000Z",
    randomId: sequenceId()
  });

  const project = await service.provisionProject(manifest);
  const snapshot = await repository.snapshot();

  assert.equal(project.status, "active");
  assert.equal(snapshot.projects.length, 1);
  assert.equal(snapshot.databases.length, 1);
  assert.equal(snapshot.authInstances.length, 1);
  assert.equal(snapshot.routes.length, 1);
  assert.equal(snapshot.tokens.length, 3);
  assert.equal(snapshot.tokens.find((item) => item.scope === "mcp")?.accessMode, "read-only");
  for (const token of snapshot.tokens) {
    assert.notEqual(token.hash.includes(project.id), true);
    assert.equal(token.hash.length, 64);
  }
});

test("provisionProject rolls back metadata and runtimes when auth provisioning fails", async () => {
  const repository = new MetadataRepository(new InMemoryMetadataDriver());
  const databaseRuntime = new FakeDatabaseRuntime();
  const authRuntime = new FakeAuthRuntime(true);
  const service = new ProvisioningService(repository, {
    databaseRuntime,
    authRuntime,
    clock: () => "2026-06-29T00:00:00.000Z",
    randomId: sequenceId()
  });

  await assert.rejects(() => service.provisionProject(manifest), /Auth provisioning failed/);
  const snapshot = await repository.snapshot();

  assert.equal(snapshot.projects.length, 0);
  assert.equal(snapshot.databases.length, 0);
  assert.equal(snapshot.authInstances.length, 0);
  assert.equal(snapshot.tokens.length, 0);
  assert.equal(snapshot.routes.length, 0);
  assert.match(databaseRuntime.events.join(","), /deleteDatabase/);
  assert.equal(snapshot.auditLogs.some((item) => item.phase === "failed"), true);
});

test("deprovisionProject requires explicit confirmation", async () => {
  const repository = new MetadataRepository(new InMemoryMetadataDriver());
  const service = new ProvisioningService(repository, {
    databaseRuntime: new FakeDatabaseRuntime(),
    authRuntime: new FakeAuthRuntime(),
    clock: () => "2026-06-29T00:00:00.000Z",
    randomId: sequenceId()
  });

  const project = await service.provisionProject(manifest);
  await assert.rejects(() => service.deprovisionProject(project.id, "wrong-slug"), /Confirmation slug mismatch/);
  await service.deprovisionProject(project.id, manifest.slug);
  const snapshot = await repository.snapshot();
  assert.equal(snapshot.projects.length, 0);
});

test("dashboard, importer, bucket, MCP, and security helpers reflect later stories", async () => {
  const repository = new MetadataRepository(new InMemoryMetadataDriver());
  const service = new ProvisioningService(repository, {
    databaseRuntime: new FakeDatabaseRuntime(),
    authRuntime: new FakeAuthRuntime(),
    clock: () => "2026-06-29T00:00:00.000Z",
    randomId: sequenceId()
  });

  const project = await service.provisionProject(manifest);
  const snapshot = await repository.snapshot();
  const dashboard = buildDashboard(snapshot);
  const report = buildImportReport(project.id);
  const bucket = createBucket(project.id, "images", "public", "ssd", () => "2026-06-29T00:00:00.000Z", sequenceId());
  const mcp = buildMcpProfile(project.id);
  const securityChecklist = buildSecurityChecklist();

  assert.equal(dashboard.length, 1);
  assert.equal(report.importedSchemas.includes("auth"), true);
  assert.equal(bucket.cacheMode, "aggressive");
  assert.equal(mcp.writeRequiresConfirmation, true);
  assert.equal(securityChecklist.length >= 3, true);
});

test("identifier validation and tls defaults protect real-mode adapters", async () => {
  assert.equal(assertIdentifier("valid_name_1", "databaseName"), "valid_name_1");
  assert.throws(() => assertIdentifier("Invalid-Name", "databaseName"), /must match/);
  assert.equal(defineTlsStrategy().mode, "per-subdomain");
});

test("config loader defaults to dev mode and app factory builds the dev stack", async () => {
  const config = loadControlTowerConfig({
    CONTROL_TOWER_MODE: "dev",
    CONTROL_TOWER_DATA_FILE: ".data/test-control-tower.json"
  });
  assert.equal(config.mode, "dev");
  const app = await createControlTowerApp(config);
  try {
    const snapshot = await app.repository.snapshot();
    assert.equal(snapshot.projects.length, 0);
  } finally {
    await app.close();
  }
});

test("caddy route config is generated from registered project routes", async () => {
  const repository = new MetadataRepository(new InMemoryMetadataDriver());
  const service = new ProvisioningService(repository, {
    databaseRuntime: new FakeDatabaseRuntime(),
    authRuntime: new FakeAuthRuntime(),
    clock: () => "2026-06-30T00:00:00.000Z",
    randomId: sequenceId()
  });

  await service.provisionProject(manifest);
  const snapshot = await repository.snapshot();
  const caddy = buildCaddyRouteConfig(snapshot, {
    adminOrigin: "http://127.0.0.1:2019",
    listenAddress: ":80"
  });
  const routes = (
    (caddy.config.apps as { http: { servers: { control_tower: { routes: Array<Record<string, unknown>> } } } }).http
      .servers.control_tower.routes
  );

  assert.equal(caddy.routeCount, 1);
  assert.equal(Array.isArray(routes), true);
});

test("caddy route config can be published to a mock admin API", async () => {
  let receivedBody = "";
  const server = http.createServer((req, res) => {
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      receivedBody += chunk;
    });
    req.on("end", () => {
      res.statusCode = 200;
      res.end("{}");
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind mock server");
  }

  try {
    await publishCaddyConfig({
      adminOrigin: `http://127.0.0.1:${address.port}`,
      routeCount: 0,
      config: { apps: { http: { servers: {} } } }
    });
    assert.equal(receivedBody.includes("\"apps\""), true);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("smoke test produces a caddy export and dashboard summary", async () => {
  const config = loadControlTowerConfig({
    CONTROL_TOWER_MODE: "dev",
    CONTROL_TOWER_DATA_FILE: ".data/test-control-tower-smoke.json",
    CONTROL_TOWER_CADDY_ADMIN_ORIGIN: "http://127.0.0.1:2019",
    CONTROL_TOWER_CADDY_LISTEN_ADDRESS: ":80"
  });
  const app = await createControlTowerApp(config);
  try {
    const report = await runSmokeTest(app, config, manifest);
    assert.equal(report.dashboardProjects >= 1, true);
    assert.equal(report.routeCount, 1);
    assert.equal(report.caddyConfigPath.endsWith("caddy-config.json"), true);
  } finally {
    await app.close();
  }
});

test("provisionProject publishes routes via the injected routePublisher", async () => {
  const repository = new MetadataRepository(new InMemoryMetadataDriver());
  const published: MetadataSnapshot[] = [];
  const service = new ProvisioningService(repository, {
    databaseRuntime: new FakeDatabaseRuntime(),
    authRuntime: new FakeAuthRuntime(),
    routePublisher: {
      async publishRoutes(snapshot) {
        published.push(snapshot);
      }
    },
    clock: () => "2026-06-30T00:00:00.000Z",
    randomId: sequenceId()
  });

  await service.provisionProject(manifest);

  assert.equal(published.length, 1);
  assert.equal(
    published[0].routes.some((route) => route.subdomain === manifest.subdomain),
    true
  );

  const snapshot = await repository.snapshot();
  const audit = snapshot.auditLogs.find((entry) => entry.action === "route.publish");
  assert.equal(audit?.phase, "completed");
});

test("caddy route config enables https and acme issuance when tlsEnabled", async () => {
  const repository = new MetadataRepository(new InMemoryMetadataDriver());
  const service = new ProvisioningService(repository, {
    databaseRuntime: new FakeDatabaseRuntime(),
    authRuntime: new FakeAuthRuntime(),
    clock: () => "2026-06-30T00:00:00.000Z",
    randomId: sequenceId()
  });
  await service.provisionProject(manifest);
  const snapshot = await repository.snapshot();

  const caddy = buildCaddyRouteConfig(snapshot, {
    adminOrigin: "http://127.0.0.1:2019",
    listenAddress: ":80",
    httpsListenAddress: ":443",
    tlsEnabled: true,
    acmeEmail: "admin@fbr.news"
  });

  const apps = caddy.config.apps as {
    http: { servers: { control_tower: { listen: string[]; automatic_https?: { disable: boolean } } } };
    tls?: { automation: { policies: Array<{ issuers: Array<{ module: string; email?: string }> }> } };
  };

  assert.equal(apps.http.servers.control_tower.listen.includes(":443"), true);
  assert.equal(apps.http.servers.control_tower.automatic_https, undefined);
  assert.equal(apps.tls?.automation.policies[0].issuers[0].module, "acme");
  assert.equal(apps.tls?.automation.policies[0].issuers[0].email, "admin@fbr.news");
});

test("caddy route config can include the control plane panel route", async () => {
  const repository = new MetadataRepository(new InMemoryMetadataDriver());
  const service = new ProvisioningService(repository, {
    databaseRuntime: new FakeDatabaseRuntime(),
    authRuntime: new FakeAuthRuntime(),
    clock: () => "2026-06-30T00:00:00.000Z",
    randomId: sequenceId()
  });
  await service.provisionProject(manifest);
  const snapshot = await repository.snapshot();

  const caddy = buildCaddyRouteConfig(snapshot, {
    adminOrigin: "http://127.0.0.1:2019",
    listenAddress: ":80",
    httpsListenAddress: ":443",
    tlsEnabled: true,
    panelDomain: "control-tower.fbr.news",
    panelUpstream: "http://host.docker.internal:3000"
  });
  const routes = (
    caddy.config.apps as {
      http: { servers: { control_tower: { routes: Array<{ match: Array<{ host: string[] }> }> } } };
    }
  ).http.servers.control_tower.routes;

  assert.equal(routes[0].match[0].host[0], "control-tower.fbr.news");
});

test("real auth runtime attaches GoTrue containers to the configured docker network", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "control-tower-auth-"));
  const calls: Record<string, unknown>[] = [];
  const dockerClient = {
    async createContainer(payload: Record<string, unknown>) {
      calls.push(payload);
      return "container-123";
    },
    async startContainer() {}
  };
  const runtime = new RealAuthRuntime(
    dockerClient as never,
    {
      gotrueImage: "supabase/auth:v2.192.0",
      authPort: 9999,
      secretDirectory: tempDir,
      networkName: "control-tower-net"
    },
    {
      dbDatabaseUrlTemplate: "postgres://postgres:postgres@postgres:5432/{databaseName}?sslmode=disable",
      siteUrlTemplate: "https://{subdomain}",
      externalUrlTemplate: "https://{subdomain}/auth",
      disableSignup: false,
      jwtExpirySeconds: 3600,
      jwtAudience: "authenticated",
      redirectAllowList: "https://*.fbr.news"
    }
  );

  try {
    await runtime.createInstance("project-1", manifest);
    const hostConfig = calls[0].HostConfig as { NetworkMode?: string };
    const networking = calls[0].NetworkingConfig as {
      EndpointsConfig?: Record<string, Record<string, never>>;
    };
    assert.equal(hostConfig.NetworkMode, "control-tower-net");
    assert.equal(Boolean(networking.EndpointsConfig?.["control-tower-net"]), true);

    const privateKey = JSON.parse(
      await readFile(path.join(tempDir, `${manifest.slug}.private.jwk.json`), "utf8")
    ) as { kid: string };
    assert.equal(privateKey.kid.startsWith(`${manifest.slug}-`), true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("supabase-compatible API keys are HS256 JWTs with the right role claim", () => {
  const secret = generateJwtSecret();
  const ref = "project-ref-123";
  const keys = createSupabaseKeySet(secret, ref);

  const anonPayload = verifyJwt(keys.anonKey, secret);
  const servicePayload = verifyJwt(keys.serviceRoleKey, secret);

  assert.equal(anonPayload?.role, "anon");
  assert.equal(servicePayload?.role, "service_role");
  assert.equal(anonPayload?.iss, "supabase");
  assert.equal(anonPayload?.ref, ref);
  assert.equal(keys.anonKey.split(".").length, 3);
  assert.equal(keys.anonKey !== keys.serviceRoleKey, true);
  assert.equal(verifyJwt(keys.anonKey, "wrong-secret"), null);
});

test("supabase key set regenerated from the same secret is stable", () => {
  const secret = generateJwtSecret();
  const first = createSupabaseKeySet(secret, "ref");
  const second = createSupabaseKeySet(secret, "ref");
  assert.equal(first.anonKey, second.anonKey);
  assert.equal(first.serviceRoleKey, second.serviceRoleKey);
});

test("provisionProject provisions PostgREST and records the rest target when a runtime is provided", async () => {
  const repository = new MetadataRepository(new InMemoryMetadataDriver());
  const postgrest = new FakePostgrestRuntime();
  const service = new ProvisioningService(repository, {
    databaseRuntime: new FakeDatabaseRuntime(),
    authRuntime: new FakeAuthRuntime(),
    postgrestRuntime: postgrest,
    postgrestDbUriTemplate: "postgres://authenticator:{authenticatorPassword}@postgres:5432/{databaseName}",
    storageUpstream: "http://storage-api:4000",
    clock: () => "2026-07-01T00:00:00.000Z",
    randomId: sequenceId()
  });

  const project = await service.provisionProject(manifest);
  const snapshot = await repository.snapshot();

  assert.equal(snapshot.postgrestInstances.length, 1);
  assert.equal(snapshot.postgrestInstances[0].projectId, project.id);
  assert.equal(snapshot.postgrestInstances[0].dbSchema, "public");
  assert.equal(snapshot.postgrestInstances[0].anonRole, "anon");
  assert.equal(snapshot.routes[0].restTarget, snapshot.postgrestInstances[0].upstreamUrl);
  assert.equal(snapshot.routes[0].storageTarget, "http://storage-api:4000");
  assert.match(postgrest.events.join(","), /createInstance/);
});

test("caddy route config serves /auth/v1, /rest/v1 and /storage/v1 via a subroute per project", async () => {
  const repository = new MetadataRepository(new InMemoryMetadataDriver());
  const service = new ProvisioningService(repository, {
    databaseRuntime: new FakeDatabaseRuntime(),
    authRuntime: new FakeAuthRuntime(),
    postgrestRuntime: new FakePostgrestRuntime(),
    postgrestDbUriTemplate: "postgres://authenticator:{authenticatorPassword}@postgres:5432/{databaseName}",
    storageUpstream: "http://storage-api:4000",
    clock: () => "2026-07-01T00:00:00.000Z",
    randomId: sequenceId()
  });
  await service.provisionProject(manifest);
  const snapshot = await repository.snapshot();

  const caddy = buildCaddyRouteConfig(snapshot, {
    adminOrigin: "http://127.0.0.1:2019",
    listenAddress: ":80"
  });
  const server = (
    caddy.config.apps as {
      http: { servers: { control_tower: { routes: Array<Record<string, unknown>> } } };
    }
  ).http.servers.control_tower.routes;

  const projectRoute = server.find((route) => {
    const match = route.match as Array<{ host?: string[] }> | undefined;
    return Boolean(match?.[0]?.host?.includes(manifest.subdomain));
  });
  assert.equal(Boolean(projectRoute), true);

  const handle = projectRoute!.handle as Array<{ handler: string; routes?: Array<Record<string, unknown>> }>;
  assert.equal(handle[0].handler, "subroute");
  const subRoutes = handle[0].routes!;
  const paths = subRoutes
    .map((sub) => ((sub.match as Array<{ path?: string[] }> | undefined)?.[0]?.path ?? []).join(","))
    .join("|");
  assert.match(paths, /\/auth\/v1/);
  assert.match(paths, /\/rest\/v1/);
  assert.match(paths, /\/storage\/v1/);
});

test("provisioning without PostgREST leaves restTarget null and degrades to a single proxy", async () => {
  const repository = new MetadataRepository(new InMemoryMetadataDriver());
  const service = new ProvisioningService(repository, {
    databaseRuntime: new FakeDatabaseRuntime(),
    authRuntime: new FakeAuthRuntime(),
    clock: () => "2026-07-01T00:00:00.000Z",
    randomId: sequenceId()
  });
  await service.provisionProject(manifest);
  const snapshot = await repository.snapshot();
  assert.equal(snapshot.postgrestInstances.length, 0);
  assert.equal(snapshot.routes[0].restTarget, null);
  assert.equal(snapshot.routes[0].storageTarget, null);
});

test("deprovisionProject removes the PostgREST instance", async () => {
  const repository = new MetadataRepository(new InMemoryMetadataDriver());
  const postgrest = new FakePostgrestRuntime();
  const service = new ProvisioningService(repository, {
    databaseRuntime: new FakeDatabaseRuntime(),
    authRuntime: new FakeAuthRuntime(),
    postgrestRuntime: postgrest,
    postgrestDbUriTemplate: "postgres://authenticator:{authenticatorPassword}@postgres:5432/{databaseName}",
    clock: () => "2026-07-01T00:00:00.000Z",
    randomId: sequenceId()
  });

  const project = await service.provisionProject(manifest);
  await service.deprovisionProject(project.id, manifest.slug);
  const snapshot = await repository.snapshot();

  assert.equal(snapshot.postgrestInstances.length, 0);
  assert.match(postgrest.events.join(","), /deleteInstance/);
});

test("storage gateway isolates buckets per project slug", () => {
  const gateway = new StorageGateway({
    endpoint: "http://localhost:9000",
    region: "us-east-1",
    accessKey: "test",
    secretKey: "test"
  });
  const blogImages = gateway.resolveBucketName("blog-a", "images");
  const revistaImages = gateway.resolveBucketName("revista", "images");
  assert.equal(blogImages.startsWith("fbr-blog-a-"), true);
  assert.equal(revistaImages.startsWith("fbr-revista-"), true);
  assert.notEqual(blogImages, revistaImages);
  assert.equal(blogImages.length <= 63, true);
});

function sequenceId() {
  let index = 0;
  return () => `id-${++index}`;
}
