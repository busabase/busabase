import { afterEach, describe, expect, it, vi } from "vitest";
import { EXIT_CODES } from "./errors";
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
  webUrl: "https://busabase.com",
  output: "table" as const,
  retries: 2,
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
      expect(out).toContain("npx -y busabase@latest server");
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

  it("exits NETWORK (9) and prints the connection guidance when the transport throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    global.fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;

    const exitCode = await runCli(["--base-url", "http://localhost:15419", "records", "list"]);

    expect(exitCode).toBe(EXIT_CODES.NETWORK);
    const printed = error.mock.calls.join("\n");
    expect(printed).toContain("Could not reach http://localhost:15419");
    expect(printed).toContain("npx -y busabase@latest server");
    expect(printed).toContain(DOCS);
  });

  it("explains a 401 against the real target host when the server rejects the call", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    global.fetch = vi.fn(
      async () => new Response('{"error":"unauthorized"}', { status: 401 }),
    ) as typeof fetch;

    const exitCode = await runCli(["--base-url", "https://busabase.com", "records", "list"]);

    expect(exitCode).toBe(EXIT_CODES.UNAUTHORIZED);
    const printed = error.mock.calls.join("\n");
    expect(printed).toContain("Unauthorized (401) from https://busabase.com");
    expect(printed).toContain("busabase-cli login");
  });
});

describe("machine-readable failures", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const failWith = async (status: number, body: string, argv: string[]) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    global.fetch = vi.fn(async () => new Response(body, { status })) as typeof fetch;
    const exitCode = await runCli(argv);
    return { exitCode, stdout: log.mock.calls.map((call) => call.join(" ")).join("\n"), error };
  };

  it("writes the envelope to stdout under --output json, keeping the prose on stderr", async () => {
    const { exitCode, stdout, error } = await failWith(404, '{"error":"Node not found"}', [
      "--base-url",
      "https://busabase.com",
      "--output",
      "json",
      "records",
      "list",
    ]);

    expect(exitCode).toBe(EXIT_CODES.NOT_FOUND);
    expect(JSON.parse(stdout)).toMatchObject({
      ok: false,
      code: "NOT_FOUND",
      status: 404,
      retryable: false,
    });
    expect(error.mock.calls.join("\n")).toContain(DOCS);
  });

  it("stays silent on stdout for a human run, so nothing changes for a terminal", async () => {
    const { exitCode, stdout } = await failWith(404, '{"error":"Node not found"}', [
      "--base-url",
      "https://busabase.com",
      "records",
      "list",
    ]);

    expect(exitCode).toBe(EXIT_CODES.NOT_FOUND);
    expect(stdout).toBe("");
  });

  it("classifies a usage error before any config is resolved", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    global.fetch = vi.fn() as typeof fetch;

    const exitCode = await runCli(["--output", "json", "records", "count", "--filters", "[]"]);

    expect(exitCode).toBe(EXIT_CODES.USAGE);
    expect(JSON.parse(log.mock.calls.map((call) => call.join(" ")).join("\n"))).toMatchObject({
      ok: false,
      code: "USAGE",
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

/**
 * `members …` is Cloud-only, and the CLI ships separately from the server: a new
 * CLI can call it on an older Cloud, or on the open-source / Desktop server, which
 * has no members at all. Those servers answer with their router's 404, which on
 * its own reads like a wrong id. A procedure's own NOT_FOUND (revoking a link
 * that does not exist) must still read as exactly that.
 */
describe("members commands on a server without the route", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const respondWith = async (response: () => Response, argv: string[]) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    global.fetch = vi.fn(async () => response()) as typeof fetch;
    const exitCode = await runCli(argv);
    return {
      exitCode,
      stdout: log.mock.calls.map((call) => call.join(" ")).join("\n"),
      stderr: error.mock.calls.map((call) => call.join(" ")).join("\n"),
    };
  };

  // The exact body both servers' `/api/v1` handlers send for an unmatched path
  // (the Busabase Cloud app's oRPC HTTP handler, and the open-source server's
  // `/api/v1` catch-all route).
  const routerFallback = (path: string) => () =>
    Response.json({ error: "Not found", path }, { status: 404 });

  it("explains the router's JSON 404 from an older Cloud server and gives the web path", async () => {
    const { exitCode, stderr } = await respondWith(routerFallback("/api/v1/members/invitations"), [
      "--base-url",
      "https://busabase.com",
      "members",
      "invite",
      "--email",
      "ada@example.com",
    ]);

    expect(exitCode).toBe(EXIT_CODES.NOT_FOUND);
    expect(stderr).toContain("does not support member invitations over the API");
    expect(stderr).toContain(
      "open https://busabase.com/dashboard?settings=space&tab=people (avatar menu → Account Settings → Space Settings → Members)",
    );
    expect(stderr).toContain("open-source / Desktop edition");
    expect(stderr).toContain("https://busabase.com/docs/organizations");
  });

  it("explains the same on the open-source server, and carries it in the JSON envelope", async () => {
    const { exitCode, stdout } = await respondWith(routerFallback("/api/v1/members/invite-links"), [
      "--base-url",
      "http://localhost:15419",
      "--output",
      "json",
      "members",
      "list-invite-links",
    ]);

    expect(exitCode).toBe(EXIT_CODES.NOT_FOUND);
    const envelope = JSON.parse(stdout);
    expect(envelope).toMatchObject({ ok: false, code: "NOT_FOUND", status: 404, retryable: false });
    expect(envelope.message).toContain("does not support member invitations over the API");
    expect(envelope.hint).toContain("open-source / Desktop edition, which has no members");
  });

  it("treats a non-JSON 404 (a proxy, or a host with no /api/v1) as route-missing too", async () => {
    const { exitCode, stderr } = await respondWith(
      () =>
        new Response("<html>404 Not Found</html>", {
          status: 404,
          headers: { "content-type": "text/html" },
        }),
      ["--base-url", "https://busabase.com", "members", "list-join-requests"],
    );

    expect(exitCode).toBe(EXIT_CODES.NOT_FOUND);
    expect(stderr).toContain("does not support member invitations over the API");
  });

  it("leaves a procedure's own NOT_FOUND alone — the route exists, the link does not", async () => {
    const { exitCode, stderr } = await respondWith(
      () => Response.json({ error: "Invite link not found", code: "NOT_FOUND" }, { status: 404 }),
      [
        "--base-url",
        "https://busabase.com",
        "members",
        "revoke-invite-link",
        "--invite-link-id",
        "ivl_x",
      ],
    );

    expect(exitCode).toBe(EXIT_CODES.NOT_FOUND);
    expect(stderr).toContain("Invite link not found");
    expect(stderr).not.toContain("does not support member invitations");
  });

  it("does not reinterpret a route-missing 404 on any other command", async () => {
    const { exitCode, stderr } = await respondWith(routerFallback("/api/v1/records"), [
      "--base-url",
      "https://busabase.com",
      "records",
      "list",
    ]);

    expect(exitCode).toBe(EXIT_CODES.NOT_FOUND);
    expect(stderr).not.toContain("member invitations");
  });
});
