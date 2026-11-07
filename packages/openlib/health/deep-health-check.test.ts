import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDeepHealthCheck,
  HEALTH_PROBE_SKIPPED,
  HealthProbeError,
  isHealthCheckAuthorized,
  sanitizeHealthError,
} from "./deep-health-check";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const TOKEN = "test-health-token";

/** A request the deep check accepts: `Authorization: Bearer <HEALTH_CHECK_TOKEN>`. */
const authorized = (authorization = `Bearer ${TOKEN}`) =>
  new Request("http://app/api/health/deep", { headers: { authorization } });

beforeEach(() => {
  // Failed probes log the raw error for operators; keep test output readable.
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubEnv("HEALTH_CHECK_TOKEN", TOKEN);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("createDeepHealthCheck — per-probe timeout", () => {
  it("reports a probe that exceeds 2s as `timeout` without waiting for it", async () => {
    vi.useFakeTimers();
    const check = createDeepHealthCheck({
      service: "test",
      probes: {
        hung: () => new Promise(() => {}), // a TCP connect that never completes
        fast: async () => {},
      },
    });

    let settled = false;
    const pending = check.run().then((report) => {
      settled = true;
      return report;
    });

    // The spec is a hard 2s per probe — pinned as a literal, not the exported default.
    await vi.advanceTimersByTimeAsync(1_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    const report = await pending;
    expect(report.status).toBe("error");
    expect(report.checks.hung).toMatchObject({ status: "error", error: "timeout" });
    expect(report.checks.fast.status).toBe("ok");
  });

  it("turns a probe's synchronous throw into an error result", async () => {
    const check = createDeepHealthCheck({
      service: "test",
      probes: {
        broken: () => {
          throw Object.assign(new Error("boom"), { code: "ECONNREFUSED" });
        },
      },
    });

    const report = await check.run();
    expect(report.checks.broken).toMatchObject({ status: "error", error: "ECONNREFUSED" });
  });
});

describe("createDeepHealthCheck — cache and single-flight", () => {
  it("serves the cached report within 10s and probes again after", async () => {
    vi.useFakeTimers();
    const probe = vi.fn(async () => {});
    const check = createDeepHealthCheck({ service: "test", probes: { db: probe } });

    const first = await check.run();
    expect(first.cached).toBe(false);
    expect(probe).toHaveBeenCalledTimes(1);

    // The spec is a 10s cache — pinned as a literal, not the exported default.
    await vi.advanceTimersByTimeAsync(9_999);
    const second = await check.run();
    expect(second.cached).toBe(true);
    expect(second.checkedAt).toBe(first.checkedAt);
    expect(probe).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    const third = await check.run();
    expect(third.cached).toBe(false);
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("caches failures too, so a caller polling an outage does not multiply load", async () => {
    vi.useFakeTimers();
    const probe = vi.fn(async () => {
      throw Object.assign(new Error("down"), { code: "ECONNREFUSED" });
    });
    const check = createDeepHealthCheck({ service: "test", probes: { db: probe } });

    await check.run();
    const again = await check.run();
    expect(again).toMatchObject({ status: "error", cached: true });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("shares one in-flight probe run between concurrent callers", async () => {
    const gate = deferred();
    const probe = vi.fn(() => gate.promise);
    const check = createDeepHealthCheck({ service: "test", probes: { db: probe } });

    const runs = Promise.all([check.run(), check.run(), check.respond(authorized()), check.run()]);
    // Let every caller reach the shared promise before the probe finishes.
    await Promise.resolve();
    expect(probe).toHaveBeenCalledTimes(1);

    gate.resolve();
    const [a, b, response, d] = await runs;
    expect(probe).toHaveBeenCalledTimes(1);
    expect(b).toEqual(a);
    expect(d).toEqual(a);
    expect(response.status).toBe(200);
  });

  it("starts a new run once the previous in-flight run has finished and expired", async () => {
    const probe = vi.fn(async () => {});
    const check = createDeepHealthCheck({ service: "test", probes: { db: probe }, cacheTtlMs: 0 });

    await check.run();
    await check.run();
    expect(probe).toHaveBeenCalledTimes(2);
  });
});

describe("createDeepHealthCheck — status and response", () => {
  it("answers 503 when any configured check fails", async () => {
    const check = createDeepHealthCheck({
      service: "test",
      probes: {
        database: async () => {},
        cache: async () => {
          throw new HealthProbeError("unavailable");
        },
        cms: async () => HEALTH_PROBE_SKIPPED,
      },
    });

    const response = await check.respond(authorized());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body).toMatchObject({
      status: "error",
      service: "test",
      cached: false,
      checks: {
        database: { status: "ok" },
        cache: { status: "error", error: "unavailable" },
        cms: { status: "skipped" },
      },
    });
    expect(typeof body.checkedAt).toBe("string");
    expect(Number.isNaN(Date.parse(body.checkedAt))).toBe(false);
    expect(typeof body.checks.database.latencyMs).toBe("number");
    expect(body.checks.database).not.toHaveProperty("error");
  });

  it("treats skipped as healthy: ok + skipped answers 200", async () => {
    const check = createDeepHealthCheck({
      service: "test",
      probes: {
        database: async () => {},
        cms: async () => HEALTH_PROBE_SKIPPED,
        storage: async () => HEALTH_PROBE_SKIPPED,
      },
    });

    const response = await check.respond(authorized());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.status).toBe("ok");
    expect(body.checks.cms).toEqual({ status: "skipped", latencyMs: expect.any(Number) });
  });

  it("never puts the raw error message in the public response body", async () => {
    const secret = "postgres://admin:hunter2@db.internal.example:5432/prod bucket=acme-private";
    const check = createDeepHealthCheck({
      service: "test",
      probes: {
        database: async () => {
          throw new Error(secret);
        },
        storage: async () => {
          throw Object.assign(new Error(`Access Denied for ${secret}`), {
            name: "AccessDenied",
            $metadata: { httpStatusCode: 403 },
          });
        },
      },
    });

    const response = await check.respond(authorized());
    const text = await response.text();
    expect(response.status).toBe(503);
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("db.internal");
    expect(text).not.toContain("acme-private");
    const body = JSON.parse(text);
    expect(body.checks.database.error).toBe("error");
    expect(body.checks.storage.error).toBe("HTTP 403");
  });
});

describe("sanitizeHealthError", () => {
  it("prefers the errno code over the message", () => {
    const error = Object.assign(new Error("connect ECONNREFUSED 10.0.0.12:6379"), {
      code: "ECONNREFUSED",
      address: "10.0.0.12",
    });
    expect(sanitizeHealthError(error)).toBe("ECONNREFUSED");
  });

  it("walks the cause chain (drizzle → postgres SQLSTATE, fetch → socket error)", () => {
    const drizzleError = new Error("Failed query: select 1", {
      cause: Object.assign(new Error('password authentication failed for user "bika"'), {
        name: "PostgresError",
        code: "28P01",
      }),
    });
    expect(sanitizeHealthError(drizzleError)).toBe("28P01");

    const fetchError = new TypeError("fetch failed", {
      cause: Object.assign(new Error("getaddrinfo ENOTFOUND cms.internal"), {
        code: "ENOTFOUND",
        hostname: "cms.internal",
      }),
    });
    expect(sanitizeHealthError(fetchError)).toBe("ENOTFOUND");
  });

  it("reports HTTP status from oRPC, fetch-style and AWS SDK errors", () => {
    expect(sanitizeHealthError(Object.assign(new Error("Unauthorized"), { status: 401 }))).toBe(
      "HTTP 401",
    );
    expect(
      sanitizeHealthError(
        Object.assign(new Error("x"), { name: "Forbidden", $metadata: { httpStatusCode: 403 } }),
      ),
    ).toBe("HTTP 403");
    expect(sanitizeHealthError({ response: { status: 502 } })).toBe("HTTP 502");
  });

  it("maps timeout-shaped errors to `timeout`", () => {
    expect(sanitizeHealthError(new DOMException("signal timed out", "TimeoutError"))).toBe(
      "timeout",
    );
    expect(
      sanitizeHealthError(new Error("wrapped", { cause: { name: "ConnectionTimeoutError" } })),
    ).toBe("timeout");
  });

  it("falls back to a safe error name, then to `error`, never the message", () => {
    expect(
      sanitizeHealthError(Object.assign(new Error("db.internal"), { name: "ErrorReply" })),
    ).toBe("ErrorReply");
    expect(sanitizeHealthError(new Error("redis://:secret@cache.internal:6379"))).toBe("error");
    expect(sanitizeHealthError(Object.assign(new Error("x"), { name: "bad name.with:host" }))).toBe(
      "error",
    );
    expect(
      sanitizeHealthError(Object.assign(new Error("x"), { code: "lowercase code with host.a" })),
    ).toBe("error");
    expect(sanitizeHealthError("plain string with s3.amazonaws.com")).toBe("error");
    expect(sanitizeHealthError(undefined)).toBe("error");
  });

  it("only lets identifier-shaped HealthProbeError reasons through", () => {
    expect(sanitizeHealthError(new HealthProbeError("not_found"))).toBe("not_found");
    expect(sanitizeHealthError(new HealthProbeError("bucket acme-private missing"))).toBe("error");
  });

  it("survives a cyclic cause chain", () => {
    const error = new Error("loop") as Error & { cause?: unknown };
    error.cause = error;
    expect(sanitizeHealthError(error)).toBe("error");
  });
});

describe("HEALTH_CHECK_TOKEN gate", () => {
  const passing = () =>
    createDeepHealthCheck({ service: "test", probes: { db: vi.fn(async () => {}) } });

  it("answers only a request bearing the configured token", async () => {
    const response = await passing().respond(authorized());
    expect(response.status).toBe(200);
  });

  it("answers 404, before running any probe, without the right token", async () => {
    const probe = vi.fn(async () => {});
    const check = createDeepHealthCheck({ service: "test", probes: { db: probe } });
    for (const request of [
      new Request("http://app/api/health/deep"),
      authorized("Bearer wrong-token"),
      authorized(`Basic ${TOKEN}`),
      authorized("Bearer"),
      // A query string is not a credential: it would leak into access logs.
      new Request(`http://app/api/health/deep?token=${TOKEN}`),
    ]) {
      const response = await check.respond(request);
      expect(response.status).toBe(404);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toBe("Not Found");
    }
    expect(probe).not.toHaveBeenCalled();
  });

  it("is off — 404 even for a bearer of the old value — when HEALTH_CHECK_TOKEN is unset or blank", async () => {
    for (const value of ["", "   "]) {
      vi.stubEnv("HEALTH_CHECK_TOKEN", value);
      expect((await passing().respond(authorized())).status).toBe(404);
      expect((await passing().respond(authorized("Bearer "))).status).toBe(404);
    }
    vi.unstubAllEnvs();
    delete process.env.HEALTH_CHECK_TOKEN;
    expect((await passing().respond(authorized())).status).toBe(404);
  });

  it("reads the token per request, so rotating it needs no restart", async () => {
    const check = passing();
    expect((await check.respond(authorized())).status).toBe(200);
    vi.stubEnv("HEALTH_CHECK_TOKEN", "rotated");
    expect((await check.respond(authorized())).status).toBe(404);
    expect((await check.respond(authorized("Bearer rotated"))).status).toBe(200);
  });

  it("accepts the scheme in any case and tolerates surrounding whitespace", () => {
    expect(isHealthCheckAuthorized(authorized(`bearer ${TOKEN}`))).toBe(true);
    expect(isHealthCheckAuthorized(authorized(`Bearer   ${TOKEN}  `))).toBe(true);
    expect(isHealthCheckAuthorized(authorized(`Bearer ${TOKEN}x`), TOKEN)).toBe(false);
    expect(isHealthCheckAuthorized(authorized(`Bearer ${TOKEN.slice(0, -1)}`), TOKEN)).toBe(false);
  });
});
