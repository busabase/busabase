import { afterEach, describe, expect, it, vi } from "vitest";
import { explainError, runCli } from "./run";

/**
 * The skill drives Busabase through `busabase-cli`, so a failed command is the
 * moment a human (or an agent following SKILL.md) gets stuck. These assertions
 * pin the *actionable* part of every error: which host was tried, the concrete
 * next step, and the troubleshooting link — the difference between "it broke"
 * and "run `login`, or point at a local server".
 */

const DOCS = "https://busabase.com/docs/troubleshooting";

const config = (over: Record<string, unknown> = {}) => ({
  baseUrl: "https://busabase.com",
  output: "table" as const,
  ...over,
});

describe("explainError", () => {
  it("tells a keyed caller to re-login when the credential is rejected (401)", () => {
    const out = explainError(new Error("HTTP 401 Unauthorized: {}"), config({ apiKey: "sk_x" }));
    expect(out).toContain("Unauthorized (401) from https://busabase.com");
    expect(out).toContain("busabase-cli login");
    expect(out).toContain("rejected or expired");
    expect(out).toContain(DOCS);
  });

  it("tells an unauthenticated caller how to sign in or point at a local server (401)", () => {
    const out = explainError(new Error("HTTP 401 Unauthorized: {}"), config());
    expect(out).toContain("This host needs sign-in");
    // Both escape hatches are offered: an API key AND the local-server base URL.
    expect(out).toContain("--api-key");
    expect(out).toContain("http://localhost:15419");
    expect(out).toContain(DOCS);
  });

  it("classifies a 401 from the error's numeric `status`, not just the message text", () => {
    const err = Object.assign(new Error("request failed"), { status: 401 });
    expect(explainError(err, config({ apiKey: "sk_x" }))).toContain("Unauthorized (401)");
  });

  it("turns a connection failure into a start-the-server hint", () => {
    for (const message of [
      "fetch failed",
      "connect ECONNREFUSED 127.0.0.1:15419",
      "getaddrinfo ENOTFOUND busabase.com",
    ]) {
      const out = explainError(new Error(message), config({ baseUrl: "http://localhost:15419" }));
      expect(out).toContain("Could not reach http://localhost:15419");
      expect(out).toContain("npx busabase server");
      // The underlying error is preserved for debugging, not swallowed.
      expect(out).toContain(message);
      expect(out).toContain(DOCS);
    }
  });

  it("falls back to the raw message plus the resolved host and key state", () => {
    const withKey = explainError(new Error("boom"), config({ apiKey: "sk_x" }));
    expect(withKey).toContain("boom");
    expect(withKey).toContain("with API key");

    const noKey = explainError(new Error("boom"), config());
    expect(noKey).toContain("no API key");
    expect(noKey).toContain("https://busabase.com");
  });

  it("stringifies non-Error throws instead of printing [object Object]", () => {
    expect(explainError("kaboom", config())).toContain("kaboom");
  });
});

describe("runCli surfaces explained errors", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("exits 1 and prints the connection guidance when the transport throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    global.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;

    const exitCode = await runCli(["--base-url", "http://localhost:15419", "records", "list"]);

    expect(exitCode).toBe(1);
    const printed = error.mock.calls.join("\n");
    expect(printed).toContain("Could not reach http://localhost:15419");
    expect(printed).toContain("npx busabase server");
    expect(printed).toContain(DOCS);
  });

  it("explains a 401 against the real target host when the server rejects the call", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    global.fetch = vi.fn(
      async () => new Response('{"error":"unauthorized"}', { status: 401 }),
    ) as typeof fetch;

    const exitCode = await runCli(["--base-url", "https://busabase.com", "records", "list"]);

    expect(exitCode).toBe(1);
    const printed = error.mock.calls.join("\n");
    expect(printed).toContain("Unauthorized (401) from https://busabase.com");
    expect(printed).toContain("busabase-cli login");
  });
});
