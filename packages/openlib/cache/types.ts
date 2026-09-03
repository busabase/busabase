/**
 * Cache Provider Interface
 *
 * Abstraction layer for cache backends (Redis, LMDB, etc.)
 * Supports key-value operations, sorted sets, and distributed locking.
 *
 * Providers:
 * - Redis: For distributed/production environments
 * - LMDB: For local/embedded environments (file-based, no server needed)
 */

/**
 * Supported cache provider types
 */
export type CacheProviderType = "redis" | "lmdb";

/**
 * Configuration for cache provider
 */
export interface CacheProviderConfig {
  /** Provider type: "redis" or "lmdb" */
  provider: CacheProviderType;
  /** Redis URL (required for redis provider) */
  redisUrl?: string;
  /** LMDB data directory (required for lmdb provider) */
  lmdbPath?: string;
}

/**
 * Sorted set member with score
 */
export interface SortedSetMember {
  value: string;
  score: number;
}

/**
 * Cache provider interface
 *
 * Provides key-value operations, sorted sets (ZSET), and distributed locking.
 * Implementations should handle errors gracefully and return sensible defaults.
 */
export interface CacheProvider {
  /** Provider name for logging */
  readonly name: string;

  // ── Key-Value Operations ──────────────────────────────────

  /** Get a string value by key */
  get(key: string): Promise<string | null>;

  /** Set a string value with optional TTL in seconds */
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;

  /** Delete a key */
  del(key: string): Promise<void>;

  /** Refresh a key's TTL only when its value still matches the expected owner token. */
  refreshTtlIfValue(key: string, expectedValue: string, ttlSeconds: number): Promise<boolean>;

  /** Delete a key only when its value still matches the expected owner token. */
  deleteIfValue(key: string, expectedValue: string): Promise<boolean>;

  // ── Sorted Set (ZSET) Operations ──────────────────────────

  /** Add or update a member in a sorted set */
  zAdd(key: string, member: SortedSetMember): Promise<void>;

  /** Remove a member from a sorted set */
  zRem(key: string, member: string): Promise<void>;

  /** Get members with scores in a score range */
  zRangeByScore(key: string, min: number, max: number): Promise<string[]>;

  /** Get members with scores (first N by score ascending) */
  zRangeWithScores(key: string, start: number, stop: number): Promise<SortedSetMember[]>;

  /** Get the number of members in a sorted set */
  zCard(key: string): Promise<number>;

  // ── Distributed Locking ───────────────────────────────────

  /**
   * Acquire a lock (SET NX with TTL)
   * @returns true if lock acquired, false if already held
   */
  acquireLock(key: string, ttlSeconds: number): Promise<boolean>;

  /** Release a lock */
  releaseLock(key: string): Promise<void>;

  // ── Batch Operations ──────────────────────────────────────

  /**
   * Execute multiple operations atomically (best-effort for non-Redis)
   * @param ops Array of operations to execute
   */
  multi(ops: Array<{ op: "zAdd"; key: string; member: SortedSetMember }>): Promise<void>;

  // ── Pub/Sub ────────────────────────────────────────────────

  /** Publish a message to a channel (no-op for non-Redis providers) */
  publish?(channel: string, message: string): Promise<number>;

  // ── Lifecycle ─────────────────────────────────────────────

  /** Close the connection / cleanup resources */
  close(): Promise<void>;
}
