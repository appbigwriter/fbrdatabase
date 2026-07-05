import crypto from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { generateKeyPairSync } from "node:crypto";
import type { ProjectManifest } from "./types.js";
import type { AuthRuntime } from "./services.js";
const execFileAsync = promisify(execFile);

export interface DockerRuntimeConfig {
  socketPath?: string;
  baseUrl?: string;
  gotrueImage: string;
  authPort: number;
  secretDirectory: string;
  networkName?: string;
  hostGatewayName?: string;
  publishedPortBase?: number;
}

export interface GoTrueEnvConfig {
  dbDatabaseUrlTemplate: string;
  siteUrlTemplate: string;
  externalUrlTemplate: string;
  disableSignup: boolean;
  jwtExpirySeconds: number;
  jwtAudience: string;
  redirectAllowList: string;
}

export class RealAuthRuntime implements AuthRuntime {
  constructor(
    private readonly dockerClient: DockerEngineClient,
    private readonly dockerConfig: DockerRuntimeConfig,
    private readonly gotrueConfig: GoTrueEnvConfig
  ) {}

  async createInstance(
    projectId: string,
    manifest: ProjectManifest
  ): Promise<{ containerId: string; authUrl: string; upstreamUrl: string; publicKeyId: string; privateKeyRef: string }> {
    const keyMaterial = await createProjectKeyMaterial(this.dockerConfig.secretDirectory, manifest.slug);
    const authUrl = interpolateTemplate(this.gotrueConfig.externalUrlTemplate, manifest);
    const siteUrl = interpolateTemplate(this.gotrueConfig.siteUrlTemplate, manifest);
    const dbUrl = interpolateTemplate(this.gotrueConfig.dbDatabaseUrlTemplate, manifest);
    const containerName = `gotrue-${manifest.slug}`;
    const upstreamUrl = `http://${containerName}:${this.dockerConfig.authPort}`;
    const environment = [
      `API_EXTERNAL_URL=${authUrl}`,
      "GOTRUE_API_HOST=0.0.0.0",
      `PORT=${this.dockerConfig.authPort}`,
      "GOTRUE_DB_DRIVER=postgres",
      `DATABASE_URL=${dbUrl}`,
      `GOTRUE_DISABLE_SIGNUP=${this.gotrueConfig.disableSignup}`,
      "GOTRUE_EXTERNAL_EMAIL_ENABLED=true",
      "GOTRUE_EXTERNAL_PHONE_ENABLED=false",
      "GOTRUE_JWT_ADMIN_ROLES=admin,service_role",
      `GOTRUE_JWT_AUD=${this.gotrueConfig.jwtAudience}`,
      `GOTRUE_JWT_EXP=${this.gotrueConfig.jwtExpirySeconds}`,
      `GOTRUE_JWT_SECRET=${keyMaterial.legacySecret}`,
      `GOTRUE_SITE_URL=${siteUrl}`,
      `GOTRUE_URI_ALLOW_LIST=${this.gotrueConfig.redirectAllowList}`
    ];

    const containerId = await this.dockerClient.createContainer({
      name: containerName,
      Image: this.dockerConfig.gotrueImage,
      Env: environment,
      ExposedPorts: { [`${this.dockerConfig.authPort}/tcp`]: {} },
      HostConfig: {
        RestartPolicy: { Name: "unless-stopped" },
        ...(this.dockerConfig.networkName ? { NetworkMode: this.dockerConfig.networkName } : {})
      },
      ...(this.dockerConfig.networkName
        ? {
            NetworkingConfig: {
              EndpointsConfig: {
                [this.dockerConfig.networkName]: {}
              }
            }
          }
        : {})
    });
    await this.dockerClient.startContainer(containerId);

    return {
      containerId,
      authUrl,
      upstreamUrl,
      publicKeyId: keyMaterial.kid,
      privateKeyRef: keyMaterial.privateKeyRef
    };
  }

  async deleteInstance(_projectId: string, manifest: ProjectManifest): Promise<void> {
    const containerName = `gotrue-${manifest.slug}`;
    await this.dockerClient.removeContainer(containerName);
  }
}

export class DockerCliAuthRuntime implements AuthRuntime {
  constructor(
    private readonly dockerConfig: DockerRuntimeConfig,
    private readonly gotrueConfig: GoTrueEnvConfig
  ) {}

  async createInstance(
    projectId: string,
    manifest: ProjectManifest
  ): Promise<{ containerId: string; authUrl: string; upstreamUrl: string; publicKeyId: string; privateKeyRef: string }> {
    const keyMaterial = await createProjectKeyMaterial(this.dockerConfig.secretDirectory, manifest.slug);
    const authUrl = interpolateTemplate(this.gotrueConfig.externalUrlTemplate, manifest);
    const siteUrl = interpolateTemplate(this.gotrueConfig.siteUrlTemplate, manifest);
    const dbUrl = interpolateTemplate(this.gotrueConfig.dbDatabaseUrlTemplate, manifest);
    const containerName = `gotrue-${manifest.slug}`;
    const environment = [
      `API_EXTERNAL_URL=${authUrl}`,
      "GOTRUE_API_HOST=0.0.0.0",
      `PORT=${this.dockerConfig.authPort}`,
      "GOTRUE_DB_DRIVER=postgres",
      `DATABASE_URL=${dbUrl}`,
      `GOTRUE_DISABLE_SIGNUP=${this.gotrueConfig.disableSignup}`,
      "GOTRUE_EXTERNAL_EMAIL_ENABLED=true",
      "GOTRUE_EXTERNAL_PHONE_ENABLED=false",
      "GOTRUE_JWT_ADMIN_ROLES=admin,service_role",
      `GOTRUE_JWT_AUD=${this.gotrueConfig.jwtAudience}`,
      `GOTRUE_JWT_EXP=${this.gotrueConfig.jwtExpirySeconds}`,
      `GOTRUE_JWT_SECRET=${keyMaterial.legacySecret}`,
      `GOTRUE_SITE_URL=${siteUrl}`,
      `GOTRUE_URI_ALLOW_LIST=${this.gotrueConfig.redirectAllowList}`
    ];

    const args = [
      "run",
      "-d",
      "--name",
      containerName,
      "--restart",
      "unless-stopped",
      "-p",
      `127.0.0.1::${this.dockerConfig.authPort}`
    ];

    if (this.dockerConfig.networkName) {
      args.push("--network", this.dockerConfig.networkName);
    }

    for (const entry of environment) {
      args.push("-e", entry);
    }

    args.push(this.dockerConfig.gotrueImage);

    const { stdout } = await execFileAsync("docker", args, { windowsHide: true });
    const containerId = stdout.trim();
    const publishedPort = await lookupPublishedPort(containerName, this.dockerConfig.authPort);
    const upstreamUrl = `http://${this.dockerConfig.hostGatewayName ?? "host.docker.internal"}:${publishedPort}/auth`;

    return {
      containerId,
      authUrl,
      upstreamUrl,
      publicKeyId: keyMaterial.kid,
      privateKeyRef: keyMaterial.privateKeyRef
    };
  }

  async deleteInstance(_projectId: string, manifest: ProjectManifest): Promise<void> {
    const containerName = `gotrue-${manifest.slug}`;
    try {
      await execFileAsync("docker", ["rm", "-f", containerName], { windowsHide: true });
    } catch (error) {
      const typed = error as { stderr?: string };
      if (typed.stderr?.includes("No such container")) {
        return;
      }
      throw error;
    }
  }
}

export class DockerEngineClient {
  constructor(private readonly config: DockerRuntimeConfig) {}

  async createContainer(payload: Record<string, unknown>): Promise<string> {
    const response = await this.request<{ Id: string }>(
      "POST",
      `/containers/create?name=${encodeURIComponent(String(payload.name ?? "control-tower-auth"))}`,
      payload
    );
    return response.Id;
  }

  async startContainer(containerId: string): Promise<void> {
    await this.request("POST", `/containers/${encodeURIComponent(containerId)}/start`);
  }

  async removeContainer(containerIdOrName: string): Promise<void> {
    try {
      await this.request("DELETE", `/containers/${encodeURIComponent(containerIdOrName)}?force=true`);
    } catch (error) {
      if (error instanceof DockerHttpError && error.statusCode === 404) {
        return;
      }
      throw error;
    }
  }

  private async request<T = Record<string, unknown>>(
    method: string,
    targetPath: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const payload = body ? JSON.stringify(body) : undefined;
    const requestOptions = buildRequestOptions(this.config, method, targetPath, payload);

    const transport = requestOptions.protocol === "https:" ? https : http;
    const responseText = await new Promise<string>((resolve, reject) => {
      const request = transport.request(requestOptions, (response) => {
        let data = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          data += chunk;
        });
        response.on("end", () => {
          const statusCode = response.statusCode ?? 500;
          if (statusCode >= 200 && statusCode < 300) {
            resolve(data);
            return;
          }
          reject(new DockerHttpError(statusCode, data || response.statusMessage || "Docker request failed"));
        });
      });

      request.on("error", reject);
      if (payload) {
        request.write(payload);
      }
      request.end();
    });

    if (!responseText) {
      return {} as T;
    }
    return JSON.parse(responseText) as T;
  }
}

export class DockerHttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}

interface DockerRequestOptions extends http.RequestOptions {
  protocol?: string;
}

function buildRequestOptions(
  config: DockerRuntimeConfig,
  method: string,
  targetPath: string,
  payload?: string
): DockerRequestOptions {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (payload) {
    headers["Content-Length"] = String(Buffer.byteLength(payload));
  }

  if (config.baseUrl) {
    const url = new URL(targetPath, config.baseUrl);
    return {
      method,
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      headers
    };
  }

  if (config.socketPath) {
    return {
      method,
      socketPath: config.socketPath,
      path: targetPath,
      headers
    };
  }

  throw new Error("Docker configuration requires CONTROL_TOWER_DOCKER_BASE_URL or CONTROL_TOWER_DOCKER_SOCKET_PATH");
}

async function createProjectKeyMaterial(secretDirectory: string, slug: string): Promise<{
  kid: string;
  privateKeyRef: string;
  privateJwk: Record<string, unknown>;
  legacySecret: string;
  legacySymmetricJwk: Record<string, unknown>;
}> {
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const kid = `${slug}-${crypto.randomUUID()}`;
  const publicJwk = publicKey.export({ format: "jwk" }) as Record<string, string>;
  const privateJwk = privateKey.export({ format: "jwk" }) as Record<string, string>;
  const legacySecret = crypto.randomBytes(32).toString("base64url");
  const privateKeyRef = path.join(secretDirectory, `${slug}.private.jwk.json`);
  const publicKeyRef = path.join(secretDirectory, `${slug}.public.jwk.json`);

  await mkdir(secretDirectory, { recursive: true });
  await writeFile(
    privateKeyRef,
    JSON.stringify({ ...privateJwk, kid, alg: "ES256", use: "sig" }, null, 2) + "\n",
    "utf8"
  );
  await writeFile(
    publicKeyRef,
    JSON.stringify({ ...publicJwk, kid, alg: "ES256", use: "sig" }, null, 2) + "\n",
    "utf8"
  );

  return {
    kid,
    privateKeyRef,
    privateJwk: { ...privateJwk, kid, alg: "ES256", use: "sig" },
    legacySecret,
    legacySymmetricJwk: {
      kty: "oct",
      kid: `${kid}-legacy`,
      alg: "HS256",
      use: "sig",
      k: Buffer.from(legacySecret, "utf8").toString("base64url")
    }
  };
}

function interpolateTemplate(template: string, manifest: ProjectManifest): string {
  return template
    .replaceAll("{slug}", manifest.slug)
    .replaceAll("{subdomain}", manifest.subdomain)
    .replaceAll("{databaseName}", manifest.databaseName)
    .replaceAll("{ownerEmail}", manifest.ownerEmail);
}

async function lookupPublishedPort(containerName: string, internalPort: number): Promise<number> {
  const { stdout } = await execFileAsync("docker", ["port", containerName, `${internalPort}/tcp`], {
    windowsHide: true
  });
  const match = stdout.trim().match(/:(\d+)\s*$/);
  if (!match) {
    throw new Error(`Could not determine published port for ${containerName}`);
  }
  return Number(match[1]);
}
