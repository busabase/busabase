import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createBetterAuthRedisRateLimitStorage,
  getBetterAuthRateLimitConfig,
} from "./better-auth-rate-limit";

describe("getBetterAuthRateLimitConfig", () => {
  it("uses local memory when REDIS_URL is absent or points at LMDB", () => {
    expect(getBetterAuthRateLimitConfig({ appName: "productready", env: {} })).toMatchObject({
      enabled: true,
      window: 60,
      max: 100,
      storage: "memory",
    });
    expect(
      getBetterAuthRateLimitConfig({
        appName: "productready",
        env: { REDIS_URL: "lmdb://./.data/cache" },
      }).customStorage,
    ).toBeUndefined();
  });

  it("applies secure endpoint defaults and numeric environment overrides", () => {
    const config = getBetterAuthRateLimitConfig({
      appName: "productready",
      env: {
        BETTER_AUTH_RATE_LIMIT_MAX: "250",
        BETTER_AUTH_RATE_LIMIT_SIGN_IN_MAX: "7",
      },
    });

    expect(config.max).toBe(250);
    expect(config.customRules["/sign-in/email"]).toEqual({ window: 60, max: 7 });
    expect(config.customRules["/sign-up/email"]).toEqual({ window: 300, max: 5 });
    expect(config.customRules["/request-password-reset"]).toEqual({ window: 300, max: 3 });
    expect(config.customRules["/send-verification-email"]).toEqual({ window: 60, max: 1 });
  });
});

describe("Redis rate-limit storage", () => {
  const client = {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
    eval: vi.fn(),
    connect: vi.fn(),
    destroy: vi.fn(),
    on: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("namespaces every operation by app", async () => {
    client.get.mockResolvedValue(null);
    client.eval.mockResolvedValue([1, 60]);
    client.del.mockResolvedValue(1);
    const storage = createBetterAuthRedisRateLimitStorage({
      appName: "Busabase Cloud",
      getClient: async () => client as never,
    });

    await storage?.get("127.0.0.1:/sign-in/email");
    await storage?.set("127.0.0.1:/sign-in/email", {
      key: "127.0.0.1:/sign-in/email",
      count: 1,
      lastRequest: 1,
    });
    await storage?.consume("127.0.0.1:/sign-in/email", { window: 60, max: 5 });
    await storage?.delete("127.0.0.1:/sign-in/email");

    const expected = "better-auth:busabase-cloud:rate-limit:127.0.0.1:/sign-in/email";
    expect(client.get).toHaveBeenCalledWith(expected);
    expect(client.eval).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      expect.objectContaining({ keys: [expected] }),
    );
    expect(client.eval).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.objectContaining({ keys: [expected] }),
    );
    expect(client.del).toHaveBeenCalledWith(expected);
  });

  it("fails open when Redis rejects a command, instead of taking down auth", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    client.eval.mockRejectedValue(new Error("Redis unavailable"));
    const storage = createBetterAuthRedisRateLimitStorage({
      appName: "productready",
      getClient: async () => client as never,
    });

    // better-auth's rate-limit hook has no try/catch of its own around `consume()`,
    // so a throw here would crash every Better Auth request (including getSession)
    // on a Redis blip. Must resolve `allowed: true` instead.
    await expect(storage?.consume("key", { window: 60, max: 5 })).resolves.toEqual({
      allowed: true,
      retryAfter: null,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("Redis storage failed for productready, failing open"),
      expect.any(Error),
    );
    warn.mockRestore();
  });
});
