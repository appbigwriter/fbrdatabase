#!/usr/bin/env node

import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  buildBackupPlan,
  buildCaddyRouteConfig,
  buildDashboard,
  buildHealthSummary,
  buildImportReport,
  buildMcpProfile,
  buildPanelContracts,
  buildSecurityChecklist,
  createControlTowerApp,
  createBucket,
  defineTlsStrategy,
  loadControlTowerConfig,
  applyMetadataSchema,
  publishCaddyConfig,
  runSmokeTest,
  storyMap,
  writeCaddyConfigFile,
  type ProjectManifest
} from "../packages/control-tower/src/index.js";

const config = loadControlTowerConfig();

async function main(): Promise<void> {
  if (process.argv[2] === "metadata" && process.argv[3] === "migrate") {
    if (!config.metadataDatabaseUrl) {
      throw new Error("CONTROL_TOWER_METADATA_DATABASE_URL is required to run metadata migrations");
    }
    await applyMetadataSchema({
      databaseUrl: config.metadataDatabaseUrl,
      schemaFilePath: config.metadataSchemaFile
    });
    printJson({ migrated: true, schemaFile: path.resolve(config.metadataSchemaFile) });
    return;
  }

  const app = await createControlTowerApp(config);
  const { repository, provisioningService } = app;
  const [command, subcommand, ...rest] = process.argv.slice(2);
  try {
    switch (`${command ?? ""}:${subcommand ?? ""}`) {
      case "stories:list":
        printJson(storyMap);
        return;
      case "backup:plan":
        printJson(buildBackupPlan());
        return;
      case "tls:strategy":
        printJson(defineTlsStrategy());
        return;
      case "project:provision":
        await handleProvision(rest[0], provisioningService);
        return;
      case "project:list": {
        const snapshot = await repository.snapshot();
        printJson(snapshot.projects);
        return;
      }
      case "project:delete":
        await handleDelete(rest, provisioningService);
        return;
      case "dashboard:show": {
        const snapshot = await repository.snapshot();
        printJson(buildDashboard(snapshot));
        return;
      }
      case "health:show": {
        const snapshot = await repository.snapshot();
        printJson(buildHealthSummary(snapshot));
        return;
      }
      case "panel:contracts": {
        const snapshot = await repository.snapshot();
        printJson(buildPanelContracts(snapshot));
        return;
      }
      case "import:analyze":
        await handleImportAnalyze(rest[0], repository);
        return;
      case "bucket:create":
        await handleBucketCreate(rest, repository);
        return;
      case "mcp:profile":
        await handleMcpProfile(rest[0]);
        return;
      case "routes:export":
        await handleRoutesExport(repository, rest[0]);
        return;
      case "routes:publish":
        await handleRoutesPublish(repository);
        return;
      case "smoke:run":
        await handleSmokeRun(rest[0], app);
        return;
      case "security:checklist":
        printJson(buildSecurityChecklist());
        return;
      default:
        printHelp();
    }
  } finally {
    await app.close();
  }
}

async function handleProvision(
  manifestPath: string | undefined,
  provisioningService: Awaited<ReturnType<typeof createControlTowerApp>>["provisioningService"]
): Promise<void> {
  if (!manifestPath) {
    throw new Error("Usage: control-tower project provision <manifest-path>");
  }

  const manifest = await loadManifest(manifestPath);
  const project = await provisioningService.provisionProject(manifest, defineTlsStrategy().mode);
  printJson(project);
}

async function handleDelete(
  args: string[],
  provisioningService: Awaited<ReturnType<typeof createControlTowerApp>>["provisioningService"]
): Promise<void> {
  const [projectId, flag, confirmation] = args;
  if (!projectId || flag !== "--confirm" || !confirmation) {
    throw new Error("Usage: control-tower project delete <project-id> --confirm <project-slug>");
  }

  await provisioningService.deprovisionProject(projectId, confirmation);
  printJson({ deleted: projectId });
}

async function handleImportAnalyze(
  manifestPath: string | undefined,
  repository: Awaited<ReturnType<typeof createControlTowerApp>>["repository"]
): Promise<void> {
  if (!manifestPath) {
    throw new Error("Usage: control-tower import analyze <manifest-path>");
  }

  const manifest = await loadManifest(manifestPath);
  const snapshot = await repository.snapshot();
  const project = snapshot.projects.find((item) => item.slug === manifest.slug);
  if (!project) {
    throw new Error(`Project with slug ${manifest.slug} not found`);
  }
  printJson(buildImportReport(project.id));
}

async function handleBucketCreate(
  args: string[],
  repository: Awaited<ReturnType<typeof createControlTowerApp>>["repository"]
): Promise<void> {
  const [projectId, bucketName, visibility] = args;
  if (!projectId || !bucketName || (visibility !== "public" && visibility !== "private")) {
    throw new Error("Usage: control-tower bucket create <project-id> <bucket-name> <public|private>");
  }
  const bucket = createBucket(projectId, bucketName, visibility);
  await repository.upsertBucket(bucket);
  printJson(bucket);
}

async function handleMcpProfile(projectId?: string): Promise<void> {
  if (!projectId) {
    throw new Error("Usage: control-tower mcp profile <project-id>");
  }
  printJson(buildMcpProfile(projectId));
}

async function handleRoutesExport(
  repository: Awaited<ReturnType<typeof createControlTowerApp>>["repository"],
  outputPath?: string
): Promise<void> {
  const snapshot = await repository.snapshot();
  const routeConfig = buildCaddyRouteConfig(snapshot, {
    adminOrigin: config.caddyAdminOrigin,
    listenAddress: config.caddyListenAddress,
    httpsListenAddress: config.caddyHttpsListenAddress,
    tlsEnabled: config.caddyTlsEnabled,
    acmeEmail: config.caddyAcmeEmail,
    panelDomain: config.caddyPanelDomain,
    panelUpstream: config.caddyPanelUpstream
  });
  const finalPath = await writeCaddyConfigFile(
    path.resolve(process.cwd(), outputPath ?? ".data/caddy/control-tower.json"),
    routeConfig
  );
  printJson({ exported: true, path: finalPath, routeCount: routeConfig.routeCount });
}

async function handleRoutesPublish(
  repository: Awaited<ReturnType<typeof createControlTowerApp>>["repository"]
): Promise<void> {
  const snapshot = await repository.snapshot();
  const routeConfig = buildCaddyRouteConfig(snapshot, {
    adminOrigin: config.caddyAdminOrigin,
    listenAddress: config.caddyListenAddress,
    httpsListenAddress: config.caddyHttpsListenAddress,
    tlsEnabled: config.caddyTlsEnabled,
    acmeEmail: config.caddyAcmeEmail,
    panelDomain: config.caddyPanelDomain,
    panelUpstream: config.caddyPanelUpstream
  });
  await publishCaddyConfig(routeConfig);
  printJson({ published: true, routeCount: routeConfig.routeCount, adminOrigin: config.caddyAdminOrigin });
}

async function handleSmokeRun(
  manifestPath: string | undefined,
  app: Awaited<ReturnType<typeof createControlTowerApp>>
): Promise<void> {
  if (!manifestPath) {
    throw new Error("Usage: control-tower smoke run <manifest-path>");
  }

  const manifest = await loadManifest(manifestPath);
  if (config.mode === "dev") {
    const isolatedConfig = {
      ...config,
      dataFile: path.join(process.cwd(), ".data", "smoke", "control-tower-smoke.json")
    };
    await rm(isolatedConfig.dataFile, { force: true });
    const isolatedApp = await createControlTowerApp(isolatedConfig);
    try {
      const report = await runSmokeTest(isolatedApp, isolatedConfig, manifest);
      printJson(report);
      return;
    } finally {
      await isolatedApp.close();
    }
  }

  const report = await runSmokeTest(app, config, manifest);
  printJson(report);
}

async function loadManifest(manifestPath: string): Promise<ProjectManifest> {
  const content = await readFile(path.resolve(process.cwd(), manifestPath), "utf8");
  return JSON.parse(content) as ProjectManifest;
}

function printHelp(): void {
  console.log(`Control Tower CLI

Usage:
  control-tower stories list
  control-tower backup plan
  control-tower tls strategy
  control-tower metadata migrate
  control-tower project provision <manifest-path>
  control-tower project list
  control-tower project delete <project-id> --confirm <project-slug>
  control-tower dashboard show
  control-tower health show
  control-tower panel contracts
  control-tower import analyze <manifest-path>
  control-tower bucket create <project-id> <bucket-name> <public|private>
  control-tower mcp profile <project-id>
  control-tower routes export [output-path]
  control-tower routes publish
  control-tower smoke run <manifest-path>
  control-tower security checklist`);
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
