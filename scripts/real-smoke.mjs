import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readFile, writeFile } from "node:fs/promises";

const execFileAsync = promisify(execFile);
const execAsync = promisify(exec);
const root = process.cwd();
const nodeBin = process.execPath;
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const caddyListenAddress = process.env.CONTROL_TOWER_CADDY_LISTEN_ADDRESS ?? ":80";
const metadataUrl =
  process.env.CONTROL_TOWER_METADATA_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5433/control_tower_meta";
const superPostgresUrl =
  process.env.CONTROL_TOWER_SUPER_POSTGRES_URL ?? "postgres://postgres:postgres@127.0.0.1:5433/postgres";
const projectDbHost = process.env.CONTROL_TOWER_PROJECT_DB_HOST ?? "postgres://127.0.0.1:5433";
const gotrueDbUrlTemplate =
  process.env.CONTROL_TOWER_GOTRUE_DB_URL_TEMPLATE ??
  "postgres://postgres:postgres@postgres:5432/{databaseName}?sslmode=disable";

const env = sanitizeEnv({
  ...process.env,
  CONTROL_TOWER_MODE: "real",
  CONTROL_TOWER_METADATA_DATABASE_URL: metadataUrl,
  CONTROL_TOWER_SUPER_POSTGRES_URL: superPostgresUrl,
  CONTROL_TOWER_PROJECT_DB_HOST: projectDbHost,
  CONTROL_TOWER_DOCKER_NETWORK_NAME: process.env.CONTROL_TOWER_DOCKER_NETWORK_NAME ?? "control-tower-net",
  CONTROL_TOWER_DOCKER_HOST_GATEWAY_NAME: process.env.CONTROL_TOWER_DOCKER_HOST_GATEWAY_NAME ?? "host.docker.internal",
  CONTROL_TOWER_DOCKER_PUBLISHED_PORT_BASE: process.env.CONTROL_TOWER_DOCKER_PUBLISHED_PORT_BASE ?? "11000",
  CONTROL_TOWER_GOTRUE_IMAGE: process.env.CONTROL_TOWER_GOTRUE_IMAGE ?? "supabase/auth:v2.192.0",
  CONTROL_TOWER_GOTRUE_DB_URL_TEMPLATE: gotrueDbUrlTemplate,
  CONTROL_TOWER_GOTRUE_SITE_URL_TEMPLATE:
    process.env.CONTROL_TOWER_GOTRUE_SITE_URL_TEMPLATE ?? toPublicBaseUrl(caddyListenAddress, "{subdomain}"),
  CONTROL_TOWER_GOTRUE_EXTERNAL_URL_TEMPLATE:
    process.env.CONTROL_TOWER_GOTRUE_EXTERNAL_URL_TEMPLATE ?? `${toPublicBaseUrl(caddyListenAddress, "{subdomain}")}/auth`,
  CONTROL_TOWER_CADDY_ADMIN_ORIGIN: process.env.CONTROL_TOWER_CADDY_ADMIN_ORIGIN ?? "http://127.0.0.1:2019",
  CONTROL_TOWER_CADDY_LISTEN_ADDRESS: caddyListenAddress
});

await run(npmBin, ["run", "build"]);
if (process.env.SKIP_DOCKER !== "true") {
  await run("docker", ["compose", "-f", "docker-compose.real.yml", "up", "-d"]);
}
await waitForMetadata();
await run(nodeBin, ["dist/bin/control-tower.js", "metadata", "migrate"], { env });
const manifestPath = await createSmokeManifest();
const smoke = await run(nodeBin, ["dist/bin/control-tower.js", "smoke", "run", manifestPath], {
  env
});
try {
  await run(nodeBin, ["dist/bin/control-tower.js", "routes", "publish"], { env });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes("socket hang up")) {
    throw error;
  }
  await sleep(1000);
}

const smokeJson = JSON.parse(smoke.stdout.trim());
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
let response;
let lastFetchError = "";
for (let attempt = 1; attempt <= 60; attempt += 1) {
  try {
    response = await fetch(`${toLoopbackBaseUrl(caddyListenAddress)}/health`, {
      headers: { Host: manifest.subdomain }
    });
    if (response.ok || response.status === 200 || response.status === 307 || response.status === 308) {
      break;
    }
    await sleep(1000);
  } catch (error) {
    lastFetchError = error instanceof Error ? error.message : String(error);
    await sleep(1000);
  }
}
if (!response) {
  throw new Error(`Failed to fetch health check from Caddy after 60 attempts: ${lastFetchError}`);
}

console.log(
  JSON.stringify(
    {
      smoke: smokeJson,
      caddyStatus: response.status,
      caddyOk: response.ok
    },
    null,
    2
  )
);

async function waitForMetadata() {
  let lastError = "";
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      await run(nodeBin, ["dist/bin/control-tower.js", "metadata", "migrate"], { env });
      return;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await sleep(2000);
    }
  }
  throw new Error(`Metadata database did not become ready: ${lastError}`);
}

async function run(command, args, options = {}) {
  if (process.platform === "win32") {
    const escaped = [command, ...args].map(quoteForCmd).join(" ");
    return execAsync(escaped, {
      cwd: root,
      windowsHide: true,
      ...options
    });
  }

  return execFileAsync(command, args, {
    cwd: root,
    windowsHide: true,
    ...options
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeEnv(input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

async function createSmokeManifest() {
  const template = JSON.parse(await readFile("examples/project-manifest.json", "utf8"));
  const suffix = Date.now().toString(36);
  const manifest = {
    ...template,
    name: `${template.name} ${suffix}`,
    slug: `revista-control-tower-${suffix}`,
    subdomain: (
      process.env.NEXT_PUBLIC_CONTROL_TOWER_PROJECT_SUBDOMAIN_TEMPLATE ?? "{slug}.lab.fbr.news"
    ).replaceAll("{slug}", `revista-${suffix}`),
    databaseName: `revista_control_tower_${suffix}`
  };
  const manifestPath = ".data/smoke/project-manifest.real.json";
  await mkdir(".data/smoke", { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return manifestPath;
}

function quoteForCmd(value) {
  if (/^[A-Za-z0-9_./:=+\\-]+$/.test(value)) {
    return value;
  }
  return `"${String(value).replace(/"/g, '""')}"`;
}

function toLoopbackBaseUrl(listenAddress) {
  if (process.env.SKIP_DOCKER === "true") {
    return "http://caddy";
  }
  const { host, port } = parseListenAddress(listenAddress);
  const baseHost = host && host !== "0.0.0.0" ? host : "127.0.0.1";
  return `http://${baseHost}${port === 80 ? "" : `:${port}`}`;
}

function toPublicBaseUrl(listenAddress, host) {
  const { port } = parseListenAddress(listenAddress);
  return `http://${host}${port === 80 ? "" : `:${port}`}`;
}

function parseListenAddress(listenAddress) {
  const normalized = String(listenAddress || ":80").trim();
  if (!normalized.startsWith(":")) {
    const url = new URL(`http://${normalized}`);
    return {
      host: url.hostname,
      port: Number(url.port || "80")
    };
  }
  return {
    host: "127.0.0.1",
    port: Number(normalized.slice(1) || "80")
  };
}
