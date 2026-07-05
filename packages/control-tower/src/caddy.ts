import { mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import type { CaddyRouteConfig, MetadataSnapshot, RoutePublisher } from "./types.js";

export interface CaddyPublishOptions {
  adminOrigin: string;
  /** HTTP listen address, e.g. ":80". */
  listenAddress: string;
  /** HTTPS listen address, e.g. ":443". Only used when tlsEnabled is true. */
  httpsListenAddress?: string;
  /** When true, Caddy binds HTTPS and issues per-subdomain certificates automatically. */
  tlsEnabled?: boolean;
  /** ACME contact email used for Let's Encrypt in production. */
  acmeEmail?: string;
  /** Optional panel hostname served by the same Caddy instance. */
  panelDomain?: string;
  /** Upstream for the Next.js control plane panel, e.g. http://host.docker.internal:3000. */
  panelUpstream?: string;
}

export function buildCaddyRouteConfig(
  snapshot: MetadataSnapshot,
  options: CaddyPublishOptions
): CaddyRouteConfig {
  const routes: Array<Record<string, unknown>> = snapshot.routes.map((route) => {
    const upstream = new URL(route.authTarget);
    const dial = upstream.port ? `${upstream.hostname}:${upstream.port}` : upstream.hostname;
    const handle: Record<string, unknown>[] = [];

    if (upstream.pathname && upstream.pathname !== "/") {
      handle.push({
        handler: "rewrite",
        strip_path_prefix: upstream.pathname
      });
    }

    handle.push({
      handler: "reverse_proxy",
      upstreams: [{ dial }]
    });

    return {
      match: [{ host: [route.subdomain] }],
      handle
    };
  });

  if (options.panelDomain && options.panelUpstream) {
    const upstream = new URL(options.panelUpstream);
    const dial = upstream.port ? `${upstream.hostname}:${upstream.port}` : upstream.hostname;
    const panelHandle: Record<string, unknown>[] = [];

    if (upstream.pathname && upstream.pathname !== "/") {
      panelHandle.push({
        handler: "rewrite",
        strip_path_prefix: upstream.pathname
      });
    }

    panelHandle.push({
      handler: "reverse_proxy",
      upstreams: [{ dial }]
    });

    routes.unshift({
      match: [{ host: [options.panelDomain] }],
      handle: panelHandle,
      terminal: true
    });
  }

  const tlsEnabled = options.tlsEnabled ?? false;
  const httpsListenAddress = options.httpsListenAddress ?? ":443";
  const server: Record<string, unknown> = tlsEnabled
    ? {
        listen: [options.listenAddress, httpsListenAddress],
        routes
      }
    : {
        listen: [options.listenAddress],
        automatic_https: {
          disable: true
        },
        routes
      };

  const apps: Record<string, unknown> = {
    http: {
      servers: {
        control_tower: server
      }
    }
  };

  if (tlsEnabled && options.acmeEmail) {
    apps.tls = {
      automation: {
        policies: [
          {
            issuers: [{ module: "acme", email: options.acmeEmail }]
          }
        ]
      }
    };
  }

  return {
    adminOrigin: options.adminOrigin,
    routeCount: routes.length,
    config: {
      admin: {
        listen: options.adminOrigin.replace(/^https?:\/\//, "")
      },
      apps
    }
  };
}

export async function writeCaddyConfigFile(filePath: string, config: CaddyRouteConfig): Promise<string> {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(config.config, null, 2) + "\n", "utf8");
  return filePath;
}

export async function publishCaddyConfig(config: CaddyRouteConfig): Promise<void> {
  const target = new URL("/load", config.adminOrigin);
  const payload = JSON.stringify(config.config);
  const transport = target.protocol === "https:" ? https : http;

  await new Promise<void>((resolve, reject) => {
    const request = transport.request(
      {
        method: "POST",
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": String(Buffer.byteLength(payload))
        }
      },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          const statusCode = response.statusCode ?? 500;
          if (statusCode >= 200 && statusCode < 300) {
            resolve();
            return;
          }
          reject(new Error(`Caddy admin API returned ${statusCode}: ${body || response.statusMessage}`));
        });
      }
    );

    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

export class CaddyAdminRoutePublisher implements RoutePublisher {
  constructor(private readonly options: CaddyPublishOptions) {}

  async publishRoutes(snapshot: MetadataSnapshot): Promise<void> {
    await publishCaddyConfig(buildCaddyRouteConfig(snapshot, this.options));
  }
}

export class CaddyFileRoutePublisher implements RoutePublisher {
  constructor(
    private readonly filePath: string,
    private readonly options: CaddyPublishOptions
  ) {}

  async publishRoutes(snapshot: MetadataSnapshot): Promise<void> {
    await writeCaddyConfigFile(this.filePath, buildCaddyRouteConfig(snapshot, this.options));
  }
}
