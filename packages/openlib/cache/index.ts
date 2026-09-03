/**
 * Cache Module
 *
 * Provides a polymorphic cache service with pluggable backends:
 * - **Redis**: For distributed/production environments
 * - **LMDB**: For local/embedded environments (file-based, no server needed)
 *
 * Provider is auto-detected from `REDIS_URL` protocol:
 * - `redis://...` or `rediss://...` → Redis
 * - `lmdb://./data/cache` → LMDB (local file-based)
 * - Not set → caching disabled (null)
 *
 * Usage:
 * ```typescript
 * import { cache } from "openlib/cache";
 *
 * const c = await cache;
 * if (c) await c.set("key", "value", 60);
 * ```
 */

import type { CacheProvider, CacheProviderConfig } from "./types";

const LMDB_PROTOCOL = "lmdb://";

function detectConfig(): CacheProviderConfig | null {
  const url = process.env.REDIS_URL;
  if (!url) return null;

  if (url.startsWith(LMDB_PROTOCOL)) {
    const lmdbPath = url.slice(LMDB_PROTOCOL.length);
    if (!lmdbPath) {
      console.warn("[Cache] REDIS_URL has lmdb:// protocol but no path");
      return null;
    }
    return { provider: "lmdb", lmdbPath };
  }

  return { provider: "redis", redisUrl: url };
}

async function createProvider(config: CacheProviderConfig): Promise<CacheProvider> {
  switch (config.provider) {
    case "redis": {
      if (!config.redisUrl) throw new Error("redisUrl is required for redis cache provider");
      const { RedisCacheProvider } = await import("./redis-provider");
      return new RedisCacheProvider(config.redisUrl);
    }
    case "lmdb": {
      if (!config.lmdbPath) throw new Error("lmdbPath is required for lmdb cache provider");
      const { LmdbCacheProvider } = await import("./lmdb-provider");
      return new LmdbCacheProvider(config.lmdbPath);
    }
    default:
      throw new Error(`Unknown cache provider: ${config.provider}`);
  }
}

async function initCache(): Promise<CacheProvider | null> {
  const config = detectConfig();
  if (!config) {
    console.log("[Cache] No cache provider configured (REDIS_URL not set), caching disabled");
    return null;
  }
  try {
    const instance = await createProvider(config);
    console.log(`[Cache] Using ${instance.name} provider`);
    return instance;
  } catch (err) {
    console.warn(`[Cache] Failed to create ${config.provider} provider: ${(err as Error).message}`);
    return null;
  }
}

/**
 * Singleton cache instance promise.
 *
 * Usage: `const c = await cache; if (c) await c.set(...)`
 */
export const cache: Promise<CacheProvider | null> = initCache();

/**
 * Create a cache provider with explicit config (for testing or custom setups)
 */
export const createCache = (config: CacheProviderConfig): Promise<CacheProvider> =>
  createProvider(config);

export { createRedisClient } from "./redis-client";
export {
  type PubsubHandler,
  type PubsubOptions,
  pSubscribeToPattern,
  publishToChannel,
  subscribeToChannel,
} from "./redis-pubsub";
// Re-export types
export type {
  CacheProvider,
  CacheProviderConfig,
  CacheProviderType,
  SortedSetMember,
} from "./types";
