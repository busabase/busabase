/**
 * Reusable `/api/health/deep` probes over the clients an app already has: its drizzle
 * database, the `openlib/cache` provider (Redis or LMDB per `REDIS_URL`) or else the app's own
 * Redis client (`PING`), and the `openlib/storage` object store (`STORAGE_URL`). Each probe
 * takes the app's existing client — it never builds a second one — and reports `skipped` when
 * the dependency is not configured in this deployment. A Busabase CMS probe, which needs the
 * CMS SDK, lives with the apps that read one.
 */

import { randomUUID } from "node:crypto";
import { type SQL, sql } from "drizzle-orm";
import type { CacheProvider } from "../cache/types";
import type { IStorage } from "../storage/types";
import { HEALTH_PROBE_SKIPPED, type HealthProbe, HealthProbeError } from "./deep-health-check";

const isEnvSet = (name: string) => () => Boolean(process.env[name]?.trim());

/** The one call `createDatabaseProbe` makes on a drizzle database. */
export interface SqlExecutor {
  execute: (query: SQL) => Promise<unknown>;
}

/**
 * `select 1` on the app's primary drizzle database (node-postgres or PGLite) — the instance
 * itself, or the app's async accessor (`getDb`). Never skipped: every app has a database.
 */
export const createDatabaseProbe =
  (db: SqlExecutor | (() => SqlExecutor | Promise<SqlExecutor>)): HealthProbe =>
  async () => {
    const executor = typeof db === "function" ? await db() : db;
    await executor.execute(sql`select 1`);
  };

/** Seconds the round-trip key outlives a probe; one key per server process, overwritten. */
const CACHE_PROBE_TTL_SECONDS = 60;

/**
 * Write-then-read round trip through the app's shared cache provider.
 *
 * The provider interface has no PING, and `RedisCacheProvider` swallows a failed connection
 * (`get` → `null`, `set` → no-op), so a read alone cannot tell "Redis is down" from "key is
 * missing". Reading back a token this process just wrote can: a dead Redis either hangs (the
 * client keeps reconnecting — the probe deadline reports `timeout`) or answers with nothing
 * (`unavailable`). The key is unique per process so pods sharing one Redis never race.
 */
export const createCacheRoundTripProbe = (
  cache: Promise<CacheProvider | null>,
  { isConfigured = isEnvSet("REDIS_URL") }: { isConfigured?: () => boolean } = {},
): HealthProbe => {
  const key = `health:deep-probe:${randomUUID()}`;
  let sequence = 0;

  return async () => {
    if (!isConfigured()) return HEALTH_PROBE_SKIPPED;
    const provider = await cache;
    // REDIS_URL is set but openlib/cache could not build a provider for it.
    if (!provider) throw new HealthProbeError("not_initialized");

    sequence += 1;
    const token = `${Date.now()}:${sequence}`;
    await provider.set(key, token, CACHE_PROBE_TTL_SECONDS);
    if ((await provider.get(key)) !== token) throw new HealthProbeError("unavailable");
  };
};

/** The one call `createRedisPingProbe` makes — node-redis and ioredis clients both have it. */
export interface RedisPingClient {
  ping: () => Promise<unknown>;
}

/**
 * `PING` through a Redis client the app already holds, for apps whose Redis traffic does not
 * go through `openlib/cache` (their own node-redis / ioredis singleton). `getClient` is the
 * app's existing accessor, so the probe exercises the very connection the app uses; it
 * resolving `null` means the app has no Redis configured here, which is `skipped`. A client
 * that is reconnecting queues or rejects the command — the deadline or the rejection reports it.
 */
export const createRedisPingProbe =
  (getClient: () => RedisPingClient | null | Promise<RedisPingClient | null>): HealthProbe =>
  async () => {
    const client = await getClient();
    if (!client) return HEALTH_PROBE_SKIPPED;
    await client.ping();
  };

/** A key no app ever writes: the probe only needs the store to answer, not to find it. */
export const STORAGE_HEALTH_PROBE_KEY = "healthcheck/deep-probe";

/**
 * Cheapest authenticated call `IStorage` exposes: a metadata HEAD for an absent key. The S3
 * adapter returns `null` for a 404 and throws for anything else (bad credentials → 403,
 * unreachable endpoint → socket error), so "answered, object absent" is a pass.
 */
export const createStorageProbe = (
  storage: IStorage,
  { isConfigured = isEnvSet("STORAGE_URL") }: { isConfigured?: () => boolean } = {},
): HealthProbe => {
  return async () => {
    if (!isConfigured()) return HEALTH_PROBE_SKIPPED;
    await storage.getObjectMetadata(STORAGE_HEALTH_PROBE_KEY);
  };
};
