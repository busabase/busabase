import { withReplicas } from "drizzle-orm/pg-core";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { isPgliteUrl, parsePgliteDataDir, sanitizeDatabaseUrl } from "./index";

const DEFAULT_SINGLE_POOL_MAX = 10;
const DEFAULT_REPLICATED_POOL_MAX = 5;
const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);

export type DatabaseEnvironment = Record<string, string | undefined>;

export type PgliteDatabaseConfig = {
  mode: "pglite";
  primaryUrl: string;
  dataDir: string;
};

export type PostgresDatabaseConfig = {
  mode: "postgres";
  primaryUrl: string;
  primaryPoolMax: number;
  readUrl?: string;
  readPoolMax?: number;
};

export type DatabaseRuntimeConfig = PgliteDatabaseConfig | PostgresDatabaseConfig;

function requirePostgresUrl(value: string, variableName: string): void {
  let protocol: string;
  try {
    protocol = new URL(value).protocol;
  } catch {
    throw new Error(`${variableName} must be a valid PostgreSQL connection URL.`);
  }

  if (!POSTGRES_PROTOCOLS.has(protocol)) {
    throw new Error(`${variableName} must use the postgres:// or postgresql:// protocol.`);
  }
}

function parsePoolMax(value: string | undefined, variableName: string, fallback: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${variableName} must be a positive integer.`);
  }
  return parsed;
}

/**
 * Resolve the primary and optional read-replica settings without opening a connection.
 *
 * A single PostgreSQL connection keeps postgres.js's existing default pool maximum
 * of 10. When a read replica is enabled, the defaults split that same budget into
 * 5 primary + 5 reader connections. Both limits can be overridden explicitly.
 */
export function resolveDatabaseRuntimeConfig(
  env: DatabaseEnvironment = process.env,
): DatabaseRuntimeConfig {
  const primaryUrl = env.PG_DATABASE_URL?.trim();
  if (!primaryUrl) {
    throw new Error(
      "PG_DATABASE_URL environment variable is not set. Please check your .env file.",
    );
  }

  const readUrl = env.PG_DATABASE_READ_URL?.trim() || undefined;
  if (isPgliteUrl(primaryUrl)) {
    if (readUrl) {
      throw new Error(
        "PG_DATABASE_READ_URL cannot be used when PG_DATABASE_URL uses PGLite. PGLite reads use the primary database.",
      );
    }
    return {
      mode: "pglite",
      primaryUrl,
      dataDir: parsePgliteDataDir(primaryUrl),
    };
  }

  requirePostgresUrl(primaryUrl, "PG_DATABASE_URL");
  if (readUrl) {
    requirePostgresUrl(readUrl, "PG_DATABASE_READ_URL");
    if (sanitizeDatabaseUrl(primaryUrl) === sanitizeDatabaseUrl(readUrl)) {
      throw new Error(
        "PG_DATABASE_READ_URL must not be the same connection URL as PG_DATABASE_URL.",
      );
    }
  }

  const defaultPoolMax = readUrl ? DEFAULT_REPLICATED_POOL_MAX : DEFAULT_SINGLE_POOL_MAX;
  const primaryPoolMax = parsePoolMax(
    env.PG_DATABASE_PRIMARY_POOL_MAX,
    "PG_DATABASE_PRIMARY_POOL_MAX",
    defaultPoolMax,
  );

  if (!readUrl) {
    if (env.PG_DATABASE_READ_POOL_MAX?.trim()) {
      throw new Error("PG_DATABASE_READ_POOL_MAX requires PG_DATABASE_READ_URL to be configured.");
    }
    return { mode: "postgres", primaryUrl, primaryPoolMax };
  }

  return {
    mode: "postgres",
    primaryUrl,
    primaryPoolMax,
    readUrl,
    readPoolMax: parsePoolMax(
      env.PG_DATABASE_READ_POOL_MAX,
      "PG_DATABASE_READ_POOL_MAX",
      DEFAULT_REPLICATED_POOL_MAX,
    ),
  };
}

/**
 * Create a primary Drizzle database and an explicit read-oriented database.
 *
 * `db` always addresses the primary. When configured, `readDb` is Drizzle's
 * official `withReplicas` wrapper: select/query methods use the reader while
 * mutations, transactions, and raw execute calls remain on the primary.
 */
export function createPostgresJsDatabaseWithReadReplica<TSchema extends Record<string, unknown>>(
  schema: TSchema,
  config: PostgresDatabaseConfig,
) {
  const primaryClient = postgres(sanitizeDatabaseUrl(config.primaryUrl), {
    max: config.primaryPoolMax,
    prepare: false,
    target_session_attrs: "read-write",
  });
  const db = drizzlePg({ client: primaryClient, schema });

  if (!config.readUrl || config.readPoolMax === undefined) {
    return { db, readDb: db };
  }

  const readClient = postgres(sanitizeDatabaseUrl(config.readUrl), {
    max: config.readPoolMax,
    prepare: false,
    target_session_attrs: "read-only",
  });
  const replica = drizzlePg({ client: readClient, schema });

  return {
    db,
    readDb: withReplicas(db, [replica]),
  };
}
