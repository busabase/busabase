/**
 * Redis Cache Provider
 *
 * Implements CacheProvider using node-redis.
 * Requires `redis` package as a peer dependency from the consuming app.
 */

import type { CacheProvider, SortedSetMember } from "./types";

type RedisClientType = Awaited<ReturnType<typeof import("redis")["createClient"]>>;

import { createRedisClient } from "./redis-client";

export class RedisCacheProvider implements CacheProvider {
  readonly name = "redis";

  private client: RedisClientType | null = null;
  private connected = false;
  private connecting: Promise<RedisClientType | null> | null = null;
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  private async getClient(): Promise<RedisClientType | null> {
    if (this.client && this.connected) return this.client;
    if (this.connecting) return this.connecting;

    const connecting = this.connectClient();
    this.connecting = connecting;
    try {
      return await connecting;
    } finally {
      if (this.connecting === connecting) this.connecting = null;
    }
  }

  private async connectClient(): Promise<RedisClientType | null> {
    let client = this.client;

    try {
      if (!client) {
        client = await createRedisClient({ url: this.url });
        client.on("error", (err: Error) => {
          console.error(`[Cache:Redis] connection error: ${err.message}`);
        });
        this.client = client;
      }

      if (!this.connected) {
        await client.connect();
        this.connected = true;
        console.log("[Cache:Redis] ✅ connected");
      }

      return client;
    } catch (err) {
      console.warn(`[Cache:Redis] ❌ unavailable: ${(err as Error).message}`);
      // A Redis outage during the first connection must not poison this
      // provider for the lifetime of the pod. Dispose the failed client so the
      // next operation can create a fresh connection and recover.
      try {
        client?.destroy();
      } catch {
        // The client may already be closed.
      }
      if (this.client === client) {
        this.client = null;
        this.connected = false;
      }
      return null;
    }
  }

  // ── Key-Value ──────────────────────────────────────────────

  async get(key: string): Promise<string | null> {
    const r = await this.getClient();
    if (!r) return null;
    return r.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const r = await this.getClient();
    if (!r) return;
    if (ttlSeconds) {
      await r.set(key, value, { EX: ttlSeconds });
    } else {
      await r.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    const r = await this.getClient();
    if (!r) return;
    await r.del(key);
  }

  async refreshTtlIfValue(
    key: string,
    expectedValue: string,
    ttlSeconds: number,
  ): Promise<boolean> {
    const r = await this.getClient();
    if (!r) return false;
    const result = await r.eval(
      `if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("EXPIRE", KEYS[1], ARGV[2])
      end
      return 0`,
      { keys: [key], arguments: [expectedValue, String(ttlSeconds)] },
    );
    return Number(result) === 1;
  }

  async deleteIfValue(key: string, expectedValue: string): Promise<boolean> {
    const r = await this.getClient();
    if (!r) return false;
    const result = await r.eval(
      `if redis.call("GET", KEYS[1]) == ARGV[1] then
        return redis.call("DEL", KEYS[1])
      end
      return 0`,
      { keys: [key], arguments: [expectedValue] },
    );
    return Number(result) === 1;
  }

  // ── Sorted Set ─────────────────────────────────────────────

  async zAdd(key: string, member: SortedSetMember): Promise<void> {
    const r = await this.getClient();
    if (!r) return;
    await r.zAdd(key, { score: member.score, value: member.value });
  }

  async zRem(key: string, member: string): Promise<void> {
    const r = await this.getClient();
    if (!r) return;
    await r.zRem(key, member);
  }

  async zRangeByScore(key: string, min: number, max: number): Promise<string[]> {
    const r = await this.getClient();
    if (!r) return [];
    return r.zRangeByScore(key, min, max);
  }

  async zRangeWithScores(key: string, start: number, stop: number): Promise<SortedSetMember[]> {
    const r = await this.getClient();
    if (!r) return [];
    const result = await r.zRangeWithScores(key, start, stop);
    return result.map((item) => ({ value: item.value, score: item.score }));
  }

  async zCard(key: string): Promise<number> {
    const r = await this.getClient();
    if (!r) return 0;
    return r.zCard(key);
  }

  // ── Locking ────────────────────────────────────────────────

  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    const r = await this.getClient();
    // A distributed lock cannot be granted without the shared coordinator.
    // Failing closed prevents two pods from both becoming gateway leader.
    if (!r) return false;
    const result = await r.set(key, "1", { EX: ttlSeconds, NX: true });
    return result === "OK";
  }

  async releaseLock(key: string): Promise<void> {
    const r = await this.getClient();
    if (!r) return;
    await r.del(key);
  }

  // ── Batch ──────────────────────────────────────────────────

  async multi(ops: Array<{ op: "zAdd"; key: string; member: SortedSetMember }>): Promise<void> {
    const r = await this.getClient();
    if (!r) return;
    const multi = r.multi();
    for (const op of ops) {
      if (op.op === "zAdd") {
        multi.zAdd(op.key, { score: op.member.score, value: op.member.value });
      }
    }
    await multi.exec();
  }

  // ── Pub/Sub ────────────────────────────────────────────────

  async publish(channel: string, message: string): Promise<number> {
    const r = await this.getClient();
    if (!r) return 0;
    return r.publish(channel, message);
  }

  // ── Lifecycle ──────────────────────────────────────────────

  async close(): Promise<void> {
    if (this.client && this.connected) {
      await this.client.disconnect();
      this.connected = false;
    }
  }
}
