import path from "node:path";
import { buildCaddyRouteConfig, writeCaddyConfigFile } from "./caddy.js";
import { buildDashboard } from "./services.js";
import type { SmokeTestReport, ProjectManifest } from "./types.js";
import type { ControlTowerApp, ControlTowerConfig } from "./config.js";

export async function runSmokeTest(
  app: ControlTowerApp,
  config: ControlTowerConfig,
  manifest: ProjectManifest
): Promise<SmokeTestReport> {
  const project = await app.provisioningService.provisionProject(manifest);
  const snapshot = await app.repository.snapshot();
  const dashboard = buildDashboard(snapshot);
  const routeConfig = buildCaddyRouteConfig(snapshot, {
    adminOrigin: config.caddyAdminOrigin,
    listenAddress: config.caddyListenAddress
  });
  const caddyConfigPath = await writeCaddyConfigFile(
    path.join(process.cwd(), ".data", "smoke", "caddy-config.json"),
    routeConfig
  );

  const warnings: string[] = [];
  if (config.mode === "real" && !config.metadataDatabaseUrl) {
    warnings.push("Real mode is selected but no metadata database is configured.");
  }

  return {
    mode: config.mode,
    provisionedProjectId: project.id,
    routeCount: snapshot.routes.filter((route) => route.projectId === project.id).length,
    dashboardProjects: dashboard.filter((item) => item.projectId === project.id).length,
    caddyConfigPath,
    warnings
  };
}
