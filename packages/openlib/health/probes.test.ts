import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CacheProvider } from "../cache/types";
import type { IStorage } from "../storage/types";
import { createDeepHealthCheck, HEALTH_PROBE_SKIPPED } from "./deep-health-check";
import {
  createCacheRoundTripProbe,
  createDatabaseProbe,
  createRedisPingProbe,
  createStorageProbe,
  STORAGE_HEALTH_PROBE_KEY,
} from "./probes";

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const configured = () => true;
const notConfigured = () => false;

/** In-memory stand-in for a working Redis/LMDB provider (only the two calls the probe makes). */
const memoryCache = () => {
  const values = new Map<string, string>();
  return {
    set: vi.fn(async (key: string, value: string) => {
      values.set(key, value);
    }),
    get: vi.fn(async (key: string) => values.get(key) ?? null),
  } as unknown as CacheProvider & { set: ReturnType<typeof vi.fn> };
};

describe("createDatabaseProbe", () => {
  it("runs `select 1` through the app's drizzle database and fails when it throws", async () => {
    const execute = vi.fn(async (_query: unknown) => [{ "?column?": 1 }]);
    await expect(createDatabaseProbe({ execute })()).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
    const query = execute.mock.calls[0]?.[0] as { queryChunks?: unknown[] } | undefined;
    expect(JSON.stringify(query?.queryChunks)).toContain("select 1");

    const refused = Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" });
    const report = await createDeepHealthCheck({
      service: "test",
      probes: { database: createDatabaseProbe({ execute: async () => Promise.reject(refused) }) },
    }).run();
    expect(report.checks.database).toMatchObject({ status: "error", error: "ECONNREFUSED" });
  });
});

describe("createDatabaseProbe with an async accessor", () => {
  it("resolves the app's getDb() on every run", async () => {
    const execute = vi.fn(async (_query: unknown) => []);
    const getDb = vi.fn(async () => ({ execute }));
    const probe = createDatabaseProbe(getDb);
    await probe();
    await probe();
    expect(getDb).toHaveBeenCalledTimes(2);
    expect(execute).toHaveBeenCalledTimes(2);
  });
});

describe("createCacheRoundTripProbe", () => {
  it("skips when REDIS_URL is not configured", async () => {
    const probe = createCacheRoundTripProbe(Promise.resolve(null), { isConfigured: notConfigured });
    await expect(probe()).resolves.toBe(HEALTH_PROBE_SKIPPED);
  });

  it("passes when the token it wrote reads back", async () => {
    const cache = memoryCache();
    const probe = createCacheRoundTripProbe(Promise.resolve(cache), { isConfigured: configured });
    await expect(probe()).resolves.toBeUndefined();
    await expect(probe()).resolves.toBeUndefined();
    // One key per process, rewritten with a short TTL — the probe never accumulates keys.
    const keys = new Set(cache.set.mock.calls.map(([key]) => key));
    expect(keys.size).toBe(1);
    expect(cache.set.mock.calls[0][2]).toBeGreaterThan(0);
  });

  it("fails as `unavailable` when a dead Redis provider silently drops the write", async () => {
    // RedisCacheProvider swallows a failed connection: set() is a no-op, get() is null.
    const dead = {
      set: async () => {},
      get: async () => null,
    } as unknown as CacheProvider;
    const check = createDeepHealthCheck({
      service: "test",
      probes: {
        cache: createCacheRoundTripProbe(Promise.resolve(dead), { isConfigured: configured }),
      },
    });
    const report = await check.run();
    expect(report.checks.cache).toMatchObject({ status: "error", error: "unavailable" });
  });

  it("fails when REDIS_URL is set but no provider could be built", async () => {
    const probe = createCacheRoundTripProbe(Promise.resolve(null), { isConfigured: configured });
    await expect(probe()).rejects.toMatchObject({ reason: "not_initialized" });
  });
});

describe("createRedisPingProbe", () => {
  it("skips when the app's own accessor says there is no Redis here", async () => {
    await expect(createRedisPingProbe(() => null)()).resolves.toBe(HEALTH_PROBE_SKIPPED);
    await expect(createRedisPingProbe(async () => null)()).resolves.toBe(HEALTH_PROBE_SKIPPED);
  });

  it("PINGs the very client the app's accessor hands out, on every run", async () => {
    const client = { ping: vi.fn(async () => "PONG") };
    const getClient = vi.fn(async () => client);
    const probe = createRedisPingProbe(getClient);
    await expect(probe()).resolves.toBeUndefined();
    await expect(probe()).resolves.toBeUndefined();
    expect(getClient).toHaveBeenCalledTimes(2);
    expect(client.ping).toHaveBeenCalledTimes(2);
  });

  it("reports a refused connection by its code", async () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED 10.0.0.7:6379"), {
      code: "ECONNREFUSED",
    });
    const report = await createDeepHealthCheck({
      service: "test",
      probes: { redis: createRedisPingProbe(async () => Promise.reject(refused)) },
    }).run();
    expect(report.checks.redis).toMatchObject({ status: "error", error: "ECONNREFUSED" });
    expect(JSON.stringify(report)).not.toContain("10.0.0.7");
  });

  it("reports a PING that a reconnecting client never answers as `timeout`", async () => {
    const queued = { ping: () => new Promise<never>(() => {}) };
    const report = await createDeepHealthCheck({
      service: "test",
      timeoutMs: 20,
      probes: { redis: createRedisPingProbe(() => queued) },
    }).run();
    expect(report.checks.redis).toMatchObject({ status: "error", error: "timeout" });
  });
});

describe("createStorageProbe", () => {
  const storageWith = (getObjectMetadata: IStorage["getObjectMetadata"]) =>
    ({ getObjectMetadata: vi.fn(getObjectMetadata) }) as unknown as IStorage & {
      getObjectMetadata: ReturnType<typeof vi.fn>;
    };

  it("skips without touching the store when STORAGE_URL is not configured", async () => {
    const storage = storageWith(async () => null);
    const probe = createStorageProbe(storage, { isConfigured: notConfigured });
    await expect(probe()).resolves.toBe(HEALTH_PROBE_SKIPPED);
    expect(storage.getObjectMetadata).not.toHaveBeenCalled();
  });

  it("passes when the store answers a HEAD for the absent probe key", async () => {
    const storage = storageWith(async () => null);
    const probe = createStorageProbe(storage, { isConfigured: configured });
    await expect(probe()).resolves.toBeUndefined();
    expect(storage.getObjectMetadata).toHaveBeenCalledWith(STORAGE_HEALTH_PROBE_KEY);
  });

  it("reports a rejected credential as its HTTP status, not the bucket name", async () => {
    const storage = storageWith(async () => {
      throw Object.assign(new Error("Access Denied on bucket acme-private"), {
        name: "InvalidAccessKeyId",
        $metadata: { httpStatusCode: 403 },
      });
    });
    const check = createDeepHealthCheck({
      service: "test",
      probes: { storage: createStorageProbe(storage, { isConfigured: configured }) },
    });
    const report = await check.run();
    expect(report.checks.storage).toMatchObject({ status: "error", error: "HTTP 403" });
    expect(JSON.stringify(report)).not.toContain("acme-private");
  });
});
