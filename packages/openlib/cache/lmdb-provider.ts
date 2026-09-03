/**
 * LMDB Cache Provider
 *
 * Implements CacheProvider using LMDB (Lightning Memory-Mapped Database).
 * Provides a local file-based alternative to Redis, suitable for
 * single-instance deployments or development environments.
 *
 * LMDB specifics:
 * - Sorted sets are emulated using a dedicated LMDB database per key
 * - TTL is tracked manually and checked on read
 * - Locking is process-local (not distributed)
 */

import type { CacheProvider, SortedSetMember } from "./types";

type LmdbDatabase = Awaited<ReturnType<typeof import("lmdb")["open"]>>;

interface StoredValue {
  value: string;
  expiresAt?: number; // Unix timestamp in ms
}

interface ZSetEntry {
  score: number;
}

const ZSET_PREFIX = "zset:";
const LOCK_PREFIX = "lock:";

export class LmdbCacheProvider implements CacheProvider {
  readonly name = "lmdb";

  private db: LmdbDatabase | null = null;
  private dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
  }

  private async getDb(): Promise<LmdbDatabase> {
    if (this.db) return this.db;

    const { open } = await import("lmdb");
    this.db = open({
      path: this.dbPath,
      compression: true,
    });
    console.log(`[Cache:LMDB] ✅ opened at ${this.dbPath}`);
    return this.db;
  }

  // ── Key-Value ──────────────────────────────────────────────

  async get(key: string): Promise<string | null> {
    const db = await this.getDb();
    const stored = db.get(key) as StoredValue | undefined;
    if (!stored) return null;
    if (stored.expiresAt && stored.expiresAt < Date.now()) {
      await db.remove(key);
      return null;
    }
    return stored.value;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const db = await this.getDb();
    const stored: StoredValue = { value };
    if (ttlSeconds) {
      stored.expiresAt = Date.now() + ttlSeconds * 1000;
    }
    await db.put(key, stored);
  }

  async del(key: string): Promise<void> {
    const db = await this.getDb();
    await db.remove(key);
  }

  async refreshTtlIfValue(
    key: string,
    expectedValue: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    const db = await this.getDb();
    let refreshed = false;
    await db.transaction(() => {
      const stored = db.get(key) as StoredValue | undefined;
      if (!stored || (stored.expiresAt && stored.expiresAt < Date.now())) return;
      if (stored.value !== expectedValue) return;
      db.put(key, {
        value: expectedValue,
        expiresAt: Date.now() + ttlSeconds * 1000,
      } satisfies StoredValue);
      refreshed = true;
    });
    return refreshed;
  }

  async deleteIfValue(key: string, expectedValue: string): Promise<boolean> {
    const db = await this.getDb();
    let deleted = false;
    await db.transaction(() => {
      const stored = db.get(key) as StoredValue | undefined;
      if (!stored || (stored.expiresAt && stored.expiresAt < Date.now())) return;
      if (stored.value !== expectedValue) return;
      db.remove(key);
      deleted = true;
    });
    return deleted;
  }

  // ── Sorted Set (emulated with prefixed keys) ──────────────

  private zsetMemberKey(key: string, member: string): string {
    return `${ZSET_PREFIX}${key}:m:${member}`;
  }

  private zsetIndexPrefix(key: string): string {
    return `${ZSET_PREFIX}${key}:m:`;
  }

  async zAdd(key: string, member: SortedSetMember): Promise<void> {
    const db = await this.getDb();
    const memberKey = this.zsetMemberKey(key, member.value);
    const entry: ZSetEntry = { score: member.score };
    await db.put(memberKey, entry);
  }

  async zRem(key: string, member: string): Promise<void> {
    const db = await this.getDb();
    const memberKey = this.zsetMemberKey(key, member);
    await db.remove(memberKey);
  }

  async zRangeByScore(key: string, min: number, max: number): Promise<string[]> {
    const db = await this.getDb();
    const prefix = this.zsetIndexPrefix(key);
    const results: Array<{ member: string; score: number }> = [];

    for (const { key: k, value } of db.getRange({ start: prefix, end: `${prefix}\xFF` })) {
      const entry = value as ZSetEntry;
      if (entry.score >= min && entry.score <= max) {
        const member = (k as string).slice(prefix.length);
        results.push({ member, score: entry.score });
      }
    }

    results.sort((a, b) => a.score - b.score);
    return results.map((r) => r.member);
  }

  async zRangeWithScores(key: string, start: number, stop: number): Promise<SortedSetMember[]> {
    const db = await this.getDb();
    const prefix = this.zsetIndexPrefix(key);
    const all: SortedSetMember[] = [];

    for (const { key: k, value } of db.getRange({ start: prefix, end: `${prefix}\xFF` })) {
      const entry = value as ZSetEntry;
      const member = (k as string).slice(prefix.length);
      all.push({ value: member, score: entry.score });
    }

    all.sort((a, b) => a.score - b.score);

    // Convert stop=-1 to "until end"
    const endIdx = stop < 0 ? all.length : stop + 1;
    return all.slice(start, endIdx);
  }

  async zCard(key: string): Promise<number> {
    const db = await this.getDb();
    const prefix = this.zsetIndexPrefix(key);
    let count = 0;

    for (const _entry of db.getRange({ start: prefix, end: `${prefix}\xFF` })) {
      count++;
    }
    return count;
  }

  // ── Locking (process-local) ────────────────────────────────

  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    const db = await this.getDb();
    const lockKey = `${LOCK_PREFIX}${key}`;
    const existing = db.get(lockKey) as StoredValue | undefined;

    if (existing?.expiresAt && existing.expiresAt > Date.now()) {
      return false; // Lock held
    }

    await db.put(lockKey, {
      value: "1",
      expiresAt: Date.now() + ttlSeconds * 1000,
    } satisfies StoredValue);
    return true;
  }

  async releaseLock(key: string): Promise<void> {
    const db = await this.getDb();
    const lockKey = `${LOCK_PREFIX}${key}`;
    await db.remove(lockKey);
  }

  // ── Batch ──────────────────────────────────────────────────

  async multi(ops: Array<{ op: "zAdd"; key: string; member: SortedSetMember }>): Promise<void> {
    const db = await this.getDb();
    await db.transaction(() => {
      for (const op of ops) {
        if (op.op === "zAdd") {
          const memberKey = this.zsetMemberKey(op.key, op.member.value);
          db.put(memberKey, { score: op.member.score } satisfies ZSetEntry);
        }
      }
    });
  }

  // ── Lifecycle ──────────────────────────────────────────────

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }
}
