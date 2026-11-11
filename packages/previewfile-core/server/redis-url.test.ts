import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveConversionRedisUrl } from "./redis-url";

describe("resolveConversionRedisUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns redis:// and rediss:// URLs", () => {
    vi.stubEnv("REDIS_URL", "redis://default:@127.0.0.1:6379");
    expect(resolveConversionRedisUrl()).toBe("redis://default:@127.0.0.1:6379");

    vi.stubEnv("REDIS_URL", "rediss://cache.example:6380/2");
    expect(resolveConversionRedisUrl()).toBe("rediss://cache.example:6380/2");
  });

  it("falls back to REDIS_CONNECTION_STRING", () => {
    vi.stubEnv("REDIS_URL", "");
    vi.stubEnv("REDIS_CONNECTION_STRING", "redis://127.0.0.1:6379/1");
    expect(resolveConversionRedisUrl()).toBe("redis://127.0.0.1:6379/1");
  });

  it("treats a non-Redis backend such as lmdb:// as no Redis", () => {
    vi.stubEnv("REDIS_URL", "lmdb://./.data/cache");
    expect(resolveConversionRedisUrl()).toBeNull();

    vi.stubEnv("REDIS_URL", "lmdb:///data/cache");
    expect(resolveConversionRedisUrl()).toBeNull();
  });

  it("returns null when nothing is configured", () => {
    vi.stubEnv("REDIS_URL", "");
    vi.stubEnv("REDIS_CONNECTION_STRING", "");
    expect(resolveConversionRedisUrl()).toBeNull();
  });
});
