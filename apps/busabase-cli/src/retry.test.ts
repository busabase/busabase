import { describe, expect, it, vi } from "vitest";
import { parseRetryAfter, shouldRetry, withRetry } from "./retry";

const ok = () => new Response("{}", { status: 200 });
const fail = (status: number, headers?: Record<string, string>) =>
  new Response("{}", { status, headers });

const harness = (responses: Array<() => Response | never>) => {
  const slept: number[] = [];
  const notices: string[] = [];
  let call = 0;
  const base = vi.fn(async () =>
    responses[Math.min(call++, responses.length - 1)](),
  ) as unknown as typeof fetch;
  const wrapped = withRetry(base, {
    retries: 2,
    sleep: async (ms) => {
      slept.push(ms);
    },
    notify: (message) => notices.push(message),
    jitter: () => 0.5,
  });
  return { base, wrapped, slept, notices, calls: () => call };
};

describe("shouldRetry", () => {
  it("retries a 429 for any method — the server refused before doing work", () => {
    expect(shouldRetry("POST", 429)).toBe(true);
    expect(shouldRetry("GET", 429)).toBe(true);
  });

  it("retries 5xx and transport failures for reads", () => {
    expect(shouldRetry("GET", 503)).toBe(true);
    expect(shouldRetry("GET", undefined)).toBe(true);
  });

  it("never retries a 5xx or a dropped socket on a mutation — it may have applied", () => {
    expect(shouldRetry("POST", 502)).toBe(false);
    expect(shouldRetry("POST", undefined)).toBe(false);
    expect(shouldRetry("DELETE", 500)).toBe(false);
  });

  it("never retries a client error", () => {
    expect(shouldRetry("GET", 404)).toBe(false);
    expect(shouldRetry("GET", 400)).toBe(false);
  });
});

describe("parseRetryAfter", () => {
  it("reads delay-seconds", () => {
    expect(parseRetryAfter("3")).toBe(3000);
  });

  it("reads an HTTP-date relative to now", () => {
    const now = Date.parse("2026-08-25T00:00:00Z");
    expect(parseRetryAfter("Tue, 25 Aug 2026 00:00:05 GMT", now)).toBe(5000);
  });

  it("never returns a negative wait for a date already past", () => {
    const now = Date.parse("2026-08-25T00:00:10Z");
    expect(parseRetryAfter("Tue, 25 Aug 2026 00:00:00 GMT", now)).toBe(0);
  });

  it("ignores a header it cannot read", () => {
    expect(parseRetryAfter("soon")).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });
});

describe("withRetry", () => {
  it("is the identity when retries are disabled, adding no wrapper at all", () => {
    const base = vi.fn() as unknown as typeof fetch;
    expect(withRetry(base, { retries: 0 })).toBe(base);
  });

  it("retries a read through a 503 and returns the eventual success", async () => {
    const h = harness([() => fail(503), () => ok()]);
    const res = await h.wrapped("https://busabase.com/api/v1/records");
    expect(res.status).toBe(200);
    expect(h.calls()).toBe(2);
    expect(h.notices[0]).toContain("HTTP 503");
  });

  it("honours Retry-After instead of its own backoff", async () => {
    const h = harness([() => fail(429, { "retry-after": "4" }), () => ok()]);
    await h.wrapped("https://busabase.com/api/v1/records");
    expect(h.slept).toEqual([4000]);
  });

  it("gives up after the configured attempts and returns the last response", async () => {
    const h = harness([() => fail(503)]);
    const res = await h.wrapped("https://busabase.com/api/v1/records");
    expect(res.status).toBe(503);
    expect(h.calls()).toBe(3); // first attempt + 2 retries
  });

  it("does not retry a POST that failed with a 5xx", async () => {
    const h = harness([() => fail(500)]);
    const res = await h.wrapped("https://busabase.com/api/v1/nodes", { method: "POST" });
    expect(res.status).toBe(500);
    expect(h.calls()).toBe(1);
  });

  it("retries a transport failure on a read and reports it as a connection failure", async () => {
    const h = harness([
      () => {
        throw new TypeError("fetch failed");
      },
      () => ok(),
    ]);
    const res = await h.wrapped("https://busabase.com/api/v1/records");
    expect(res.status).toBe(200);
    expect(h.notices[0]).toContain("connection failed");
  });

  it("rethrows a transport failure on a mutation without retrying", async () => {
    const h = harness([
      () => {
        throw new TypeError("fetch failed");
      },
    ]);
    await expect(
      h.wrapped("https://busabase.com/api/v1/nodes", { method: "POST" }),
    ).rejects.toThrow("fetch failed");
    expect(h.calls()).toBe(1);
  });

  it("backs off exponentially when the server gives no Retry-After", async () => {
    const h = harness([() => fail(503)]);
    await h.wrapped("https://busabase.com/api/v1/records");
    expect(h.slept).toEqual([375, 750]);
  });
});
