import { createClient } from "redis";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  closeBetterAuthRedisRateLimitConnections,
  createBetterAuthRedisRateLimitStorage,
} from "./better-auth-rate-limit";

const redisUrl = process.env.TEST_REDIS_URL;
const describeRedis = redisUrl ? describe : describe.skip;
const runId = `${process.pid}-${Date.now()}`;

describeRedis("Better Auth Redis rate limiting", () => {
  const inspector = createClient({ url: redisUrl });

  beforeAll(async () => {
    await inspector.connect();
  });

  afterAll(async () => {
    await closeBetterAuthRedisRateLimitConnections();
    const keys = await inspector.keys(`better-auth:*${runId}*:rate-limit:*`);
    if (keys.length > 0) await inspector.del(keys);
    await inspector.disconnect();
  });

  it("shares an atomic counter across adapters and keeps the first TTL fixed", async () => {
    const appName = `integration-${runId}`;
    const key = "shared:/sign-in/email";
    const first = createBetterAuthRedisRateLimitStorage({ appName, redisUrl });
    const second = createBetterAuthRedisRateLimitStorage({ appName, redisUrl });

    await first?.delete(key);
    const decisions = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        (index % 2 ? first : second)?.consume(key, { window: 8, max: 5 }),
      ),
    );
    expect(decisions.filter((decision) => decision?.allowed)).toHaveLength(5);
    expect(decisions.filter((decision) => !decision?.allowed)).toHaveLength(7);
    expect(await first?.get(key)).toMatchObject({ key, count: 5 });

    const redisKey = `better-auth:${appName}:rate-limit:${key}`;
    const initialTtl = await inspector.ttl(redisKey);
    expect(initialTtl).toBeGreaterThanOrEqual(6);
    await new Promise((resolve) => setTimeout(resolve, 1_100));
    const denied = await second?.consume(key, { window: 8, max: 5 });
    const laterTtl = await inspector.ttl(redisKey);
    expect(denied).toEqual({ allowed: false, retryAfter: laterTtl });
    expect(laterTtl).toBeLessThan(initialTtl);
    expect(await closeBetterAuthRedisRateLimitConnections()).toBe(1);
  });

  it("isolates identical Better Auth keys by app namespace", async () => {
    const key = "same-client:/sign-in/email";
    const one = createBetterAuthRedisRateLimitStorage({ appName: `one-${runId}`, redisUrl });
    const two = createBetterAuthRedisRateLimitStorage({ appName: `two-${runId}`, redisUrl });

    await one?.delete(key);
    await two?.delete(key);
    expect(await one?.consume(key, { window: 30, max: 1 })).toEqual({
      allowed: true,
      retryAfter: null,
    });
    expect(await one?.consume(key, { window: 30, max: 1 })).toMatchObject({ allowed: false });
    expect(await two?.consume(key, { window: 30, max: 1 })).toEqual({
      allowed: true,
      retryAfter: null,
    });
  });

  it("fails closed after a real Redis client becomes unavailable", async () => {
    const client = createClient({ url: redisUrl });
    await client.connect();
    const storage = createBetterAuthRedisRateLimitStorage({
      appName: `failure-${runId}`,
      getClient: async () => client as never,
    });
    await client.disconnect();

    await expect(storage?.consume("key", { window: 30, max: 1 })).rejects.toThrow(
      "Better Auth Redis rate limiting failed",
    );
  });
});
