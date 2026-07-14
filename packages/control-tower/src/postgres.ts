import crypto from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import type { ProjectManifest } from "./types.js";
import type { DatabaseRuntime } from "./services.js";
import type { SqlQueryable } from "./store.js";

export interface PostgresRuntimeConfig {
  adminDatabaseUrl: string;
  projectHost: string;
  secretDirectory?: string;
}

export interface MetadataDatabaseConfig {
  databaseUrl: string;
  schemaFilePath: string;
}

export class PostgresClient implements SqlQueryable {
  private readonly pool: Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
  }

  async query<T = Record<string, unknown>>(text: string, values: unknown[] = []): Promise<{ rows: T[] }> {
    const result = values.length > 0 ? await this.pool.query<T>(text, values) : await this.pool.query<T>(text);
    return { rows: result.rows };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

export class RealDatabaseRuntime implements DatabaseRuntime {
  constructor(
    private readonly db: SqlQueryable,
    private readonly config: PostgresRuntimeConfig
  ) {}

  async createDatabase(_projectId: string, manifest: ProjectManifest): Promise<{ host: string }> {
    const databaseName = assertIdentifier(manifest.databaseName, "databaseName");
    await this.db.query(`CREATE DATABASE ${quoteIdentifier(databaseName)}`);
    const databaseUrl = replaceDatabaseName(this.config.adminDatabaseUrl, databaseName);
    const client = new PostgresClient(databaseUrl);
    try {
      await client.query('CREATE SCHEMA IF NOT EXISTS auth');
    } finally {
      await client.close();
    }
    return { host: this.config.projectHost };
  }

  async createRoles(
    _projectId: string,
    manifest: ProjectManifest
  ): Promise<{ writerRole: string; readerRole: string }> {
    const writerRole = assertIdentifier(`${manifest.slug.replace(/-/g, "_")}_writer`, "writerRole");
    const readerRole = assertIdentifier(`${manifest.slug.replace(/-/g, "_")}_reader`, "readerRole");
    const databaseName = assertIdentifier(manifest.databaseName, "databaseName");
    const writerPassword = randomPassword();
    const readerPassword = randomPassword();
    const databaseUrl = replaceDatabaseName(this.config.adminDatabaseUrl, databaseName);
    const client = new PostgresClient(databaseUrl);

    await this.db.query(`CREATE ROLE ${quoteIdentifier(writerRole)} LOGIN PASSWORD '${escapeLiteral(writerPassword)}'`);
    await this.db.query(`CREATE ROLE ${quoteIdentifier(readerRole)} LOGIN PASSWORD '${escapeLiteral(readerPassword)}'`);

    try {
      await client.query(`GRANT CONNECT ON DATABASE ${quoteIdentifier(databaseName)} TO ${quoteIdentifier(writerRole)}`);
      await client.query(`GRANT CONNECT ON DATABASE ${quoteIdentifier(databaseName)} TO ${quoteIdentifier(readerRole)}`);
      await client.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(writerRole)}`);
      await client.query(`GRANT USAGE ON SCHEMA auth TO ${quoteIdentifier(writerRole)}`);
      await client.query(`GRANT USAGE ON SCHEMA public TO ${quoteIdentifier(readerRole)}`);
      await client.query(`GRANT USAGE ON SCHEMA auth TO ${quoteIdentifier(readerRole)}`);
      await client.query(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${quoteIdentifier(writerRole)}`);
      await client.query(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA auth TO ${quoteIdentifier(writerRole)}`);
      await client.query(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${quoteIdentifier(writerRole)}`);
      await client.query(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA auth TO ${quoteIdentifier(writerRole)}`);
      await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${quoteIdentifier(readerRole)}`);
      await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA auth TO ${quoteIdentifier(readerRole)}`);
      await client.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO ${quoteIdentifier(writerRole)}`
      );
      await client.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL PRIVILEGES ON TABLES TO ${quoteIdentifier(writerRole)}`
      );
      await client.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO ${quoteIdentifier(writerRole)}`
      );
      await client.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT ALL PRIVILEGES ON SEQUENCES TO ${quoteIdentifier(writerRole)}`
      );
      await client.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${quoteIdentifier(readerRole)}`
      );
      await client.query(
        `ALTER DEFAULT PRIVILEGES IN SCHEMA auth GRANT SELECT ON TABLES TO ${quoteIdentifier(readerRole)}`
      );
      await writeRoleSecret(this.config.secretDirectory, manifest.slug, "writer", writerRole, writerPassword);
      await writeRoleSecret(this.config.secretDirectory, manifest.slug, "reader", readerRole, readerPassword);
    } catch (error) {
      await this.db.query(`DROP ROLE IF EXISTS ${quoteIdentifier(writerRole)}`);
      await this.db.query(`DROP ROLE IF EXISTS ${quoteIdentifier(readerRole)}`);
      throw error;
    } finally {
      await client.close();
    }
    return { writerRole, readerRole };
  }

  async deleteDatabase(_projectId: string, manifest: ProjectManifest): Promise<void> {
    const databaseName = assertIdentifier(manifest.databaseName, "databaseName");
    await this.db.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(databaseName)} WITH (FORCE)`);
    const writerRole = toRoleName(manifest.slug, "writer");
    const readerRole = toRoleName(manifest.slug, "reader");
    await this.db.query(`DROP ROLE IF EXISTS ${quoteIdentifier(writerRole)}`);
    await this.db.query(`DROP ROLE IF EXISTS ${quoteIdentifier(readerRole)}`);
  }
}

export async function applyMetadataSchema(config: MetadataDatabaseConfig): Promise<void> {
  const sql = await readFile(path.resolve(config.schemaFilePath), "utf8");
  const client = new PostgresClient(config.databaseUrl);
  try {
    await client.query(sql);
  } finally {
    await client.close();
  }
}

export function assertIdentifier(value: string, fieldName: string): string {
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(value)) {
    throw new Error(`${fieldName} must match ^[a-z_][a-z0-9_]{0,62}$`);
  }
  return value;
}

export function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, "\"\"")}"`;
}

function toRoleName(slug: string, suffix: "writer" | "reader"): string {
  return assertIdentifier(`${slug.replace(/-/g, "_")}_${suffix}`, `${suffix}Role`);
}

function replaceDatabaseName(connectionString: string, databaseName: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function randomPassword(): string {
  return crypto.randomBytes(32).toString("base64url");
}

function escapeLiteral(value: string): string {
  return value.replace(/'/g, "''");
}

async function writeRoleSecret(
  secretDirectory: string | undefined,
  slug: string,
  accessMode: "writer" | "reader",
  roleName: string,
  password: string
): Promise<void> {
  if (!secretDirectory) {
    return;
  }
  await mkdir(secretDirectory, { recursive: true });
  const filePath = path.join(secretDirectory, `${slug}.${accessMode}.db.json`);
  await writeFile(filePath, JSON.stringify({ roleName, password }, null, 2) + "\n", "utf8");
}
