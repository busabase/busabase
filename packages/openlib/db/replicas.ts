import { withReplicas } from "drizzle-orm/pg-core";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { isPgliteUrl, parsePgliteDataDir, sanitizeDatabaseUrl } from "./index";

const DEFAULT_SINGLE_POOL_MAX = 10;
const DEFAULT_REPLICATED_POOL_MAX = 5;
const POSTGRES_PROTOCOLS = new Set(["postgres:", "postgresql:"]);

/**
 * Server-side waits are opt-in, not a default.
 *
 * The problem they solve is real. postgres.js opens a small pool (10
 * connections, 5+5 with a read replica) and queues every statement that cannot
 * get a connection — with no timeout, no error, and no log line. PostgreSQL has
 * the same failure shape server-side: `statement_timeout`, `lock_timeout` and
 * `idle_in_transaction_session_timeout` all default to 0, meaning "wait
 * forever". On 2026-10-30 one busabase.com upload path stalled while holding a
 * `spaces` row lock, every later statement queued behind it, all 10 connections
 * per pod were consumed, and the whole app — sign-in included — hung silently
 * for over an hour with not a single database error in the logs.
 *
 * They are nevertheless OFF by default, because of how they have to be
 * delivered. postgres.js can only send a session setting as a connection
 * startup parameter (`statement_timeout=120000ms`), and a connection pooler
 * (PgBouncer, Supavisor, PgCat) answers a startup parameter it does not proxy
 * with `FATAL 08P01 unsupported startup parameter` *before authentication*.
 * Every pooled connection then fails — `db:migrate:deploy` included, on its
 * very first statement. A default that can stop an app from opening a
 * connection at all is worse than the stall it prevents: the stall is silent
 * but rare and recoverable, a rejected handshake is instant and total.
 *
 * So: set one of the `PG_DATABASE_*_TIMEOUT_MS` variables where the endpoint is
 * known to accept them — a direct PostgreSQL, or a pooler configured to let
 * them through. Behind a pooler you cannot control, leave them at 0 and set the
 * ceilings on the database role instead, which reaches every connection without
 * touching the startup packet:
 *
 *   ALTER ROLE <user> SET statement_timeout = '120s';
 *   ALTER ROLE <user> SET lock_timeout = '30s';
 *   ALTER ROLE <user> SET idle_in_transaction_session_timeout = '120s';
 */
const DEFAULT_STATEMENT_TIMEOUT_MS = 0;
const DEFAULT_LOCK_TIMEOUT_MS = 0;
const DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS = 0;
/** Drop idle sockets so a database failover or restart cannot leave stale ones. */
const DEFAULT_IDLE_TIMEOUT_SECONDS = 60;
const DEFAULT_CONNECT_TIMEOUT_SECONDS = 30;
const DEFAULT_MAX_LIFETIME_SECONDS = 1_800;

export type DatabaseEnvironment = Record<string, string | undefined>;

export type PgliteDatabaseConfig = {
  mode: "pglite";
  primaryUrl: string;
  dataDir: string;
};

/** Server-side wait ceilings. 0 disables the corresponding guard. */
export type PostgresTimeoutConfig = {
  statementTimeoutMs: number;
  lockTimeoutMs: number;
  idleInTransactionTimeoutMs: number;
};

export type PostgresDatabaseConfig = {
  mode: "postgres";
  primaryUrl: string;
  primaryPoolMax: number;
  readUrl?: string;
  readPoolMax?: number;
  timeouts?: PostgresTimeoutConfig;
};

export const DEFAULT_POSTGRES_TIMEOUTS: PostgresTimeoutConfig = {
  statementTimeoutMs: DEFAULT_STATEMENT_TIMEOUT_MS,
  lockTimeoutMs: DEFAULT_LOCK_TIMEOUT_MS,
  idleInTransactionTimeoutMs: DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS,
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

/** Timeouts accept 0 (= disabled) in addition to a positive millisecond value. */
function parseTimeoutMs(value: string | undefined, variableName: string, fallback: number): number {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${variableName} must be a non-negative integer (0 disables the timeout).`);
  }
  return parsed;
}

/**
 * Build the PostgreSQL startup parameters that carry the server-side guards.
 * Omitted entries keep the server default (wait forever), which is what an
 * explicit 0 asks for.
 */
function buildTimeoutStartupParameters(timeouts: PostgresTimeoutConfig) {
  const connection: Record<string, string> = {};
  if (timeouts.statementTimeoutMs > 0) {
    connection.statement_timeout = `${timeouts.statementTimeoutMs}ms`;
  }
  if (timeouts.lockTimeoutMs > 0) {
    connection.lock_timeout = `${timeouts.lockTimeoutMs}ms`;
  }
  if (timeouts.idleInTransactionTimeoutMs > 0) {
    connection.idle_in_transaction_session_timeout = `${timeouts.idleInTransactionTimeoutMs}ms`;
  }
  return Object.keys(connection).length > 0 ? connection : undefined;
}

function resolvePostgresTimeouts(env: DatabaseEnvironment): PostgresTimeoutConfig {
  return {
    statementTimeoutMs: parseTimeoutMs(
      env.PG_DATABASE_STATEMENT_TIMEOUT_MS,
      "PG_DATABASE_STATEMENT_TIMEOUT_MS",
      DEFAULT_STATEMENT_TIMEOUT_MS,
    ),
    lockTimeoutMs: parseTimeoutMs(
      env.PG_DATABASE_LOCK_TIMEOUT_MS,
      "PG_DATABASE_LOCK_TIMEOUT_MS",
      DEFAULT_LOCK_TIMEOUT_MS,
    ),
    idleInTransactionTimeoutMs: parseTimeoutMs(
      env.PG_DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS,
      "PG_DATABASE_IDLE_IN_TRANSACTION_TIMEOUT_MS",
      DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS,
    ),
  };
}

function buildPostgresClientGuards(timeouts: PostgresTimeoutConfig) {
  const connection = buildTimeoutStartupParameters(timeouts);
  return {
    connect_timeout: DEFAULT_CONNECT_TIMEOUT_SECONDS,
    idle_timeout: DEFAULT_IDLE_TIMEOUT_SECONDS,
    max_lifetime: DEFAULT_MAX_LIFETIME_SECONDS,
    ...(connection ? { connection } : {}),
  };
}

type PostgresClient = postgres.Sql;
type PostgresClientOptions = NonNullable<Parameters<typeof postgres>[1]>;

/**
 * The one postgres.js client shape every app and core package should use.
 *
 * Client-side guards (connect/idle/lifetime) are always applied — they are
 * driver options, not startup parameters, so a pooler never sees them. The
 * server-side ceilings are sent only when the caller enabled them.
 */
export function createGuardedPostgresClient(
  url: string,
  options: PostgresClientOptions = {},
  timeouts: PostgresTimeoutConfig = resolvePostgresTimeouts(process.env),
): PostgresClient {
  const guards = buildPostgresClientGuards(timeouts);
  const callerConnection = options.connection ?? {};
  const connection = { ...callerConnection, ...guards.connection };

  const clientOptions: PostgresClientOptions = {
    connect_timeout: guards.connect_timeout,
    idle_timeout: guards.idle_timeout,
    max_lifetime: guards.max_lifetime,
    ...options,
  };
  if (Object.keys(connection).length > 0) {
    clientOptions.connection = connection;
  } else {
    delete clientOptions.connection;
  }

  return postgres(url, clientOptions as never) as unknown as PostgresClient;
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
  const timeouts = resolvePostgresTimeouts(env);

  if (!readUrl) {
    if (env.PG_DATABASE_READ_POOL_MAX?.trim()) {
      throw new Error("PG_DATABASE_READ_POOL_MAX requires PG_DATABASE_READ_URL to be configured.");
    }
    return { mode: "postgres", primaryUrl, primaryPoolMax, timeouts };
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
    timeouts,
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
  const timeouts = config.timeouts ?? DEFAULT_POSTGRES_TIMEOUTS;
  const primaryClient = createGuardedPostgresClient(
    sanitizeDatabaseUrl(config.primaryUrl),
    {
      max: config.primaryPoolMax,
      prepare: false,
      target_session_attrs: "read-write",
    },
    timeouts,
  );
  const db = drizzlePg({ client: primaryClient, schema });

  if (!config.readUrl || config.readPoolMax === undefined) {
    return { db, readDb: db };
  }

  const readClient = createGuardedPostgresClient(
    sanitizeDatabaseUrl(config.readUrl),
    {
      max: config.readPoolMax,
      prepare: false,
      target_session_attrs: "read-only",
    },
    timeouts,
  );
  const replica = drizzlePg({ client: readClient, schema });

  return {
    db,
    readDb: withReplicas(db, [replica]),
  };
}
