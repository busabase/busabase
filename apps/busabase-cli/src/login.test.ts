import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDotEnvFile, writeDotEnvFile } from "./config-file";
import { maybeAutoRefresh, runLogin, runLogout, runRefresh } from "./login";

/**
 * Auth is the first thing a skill/agent does, so the non-interactive login, session
 * refresh, silent auto-refresh, and logout branches are where "can't connect" bugs
 * would live. Tests run with no TTY (so login takes the non-interactive path), a
 * scratch HOME, and a mocked `fetch` — asserting both the persisted `~/.busabase/.env`
 * and the returned summary.
 */

const LOCAL = "http://localhost:15419";
const CLOUD = "https://busabase.com";

let home: string;
let originalHome: string | undefined;
const originalFetch = global.fetch;

beforeEach(async () => {
  originalHome = process.env.HOME;
  home = await mkdtemp(join(tmpdir(), "busabase-login-"));
  process.env.HOME = home;
  // Silence the stderr progress chatter (`say`) so test output stays clean.
  vi.spyOn(process.stderr, "write").mockImplementation(() => true);
});

afterEach(async () => {
  process.env.HOME = originalHome;
  global.fetch = originalFetch;
  vi.restoreAllMocks();
  await rm(home, { force: true, recursive: true });
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("runLogin", () => {
  it("verifies an API key and persists the connection (non-interactive)", async () => {
    const calls: string[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push(`${request.method} ${request.url}`);
      expect(request.headers.get("authorization")).toBe("Bearer sk_test");
      return jsonResponse({
        user: { id: "usr_1", email: "dev@example.com" },
        space: { id: "spc_1", name: "Space One" },
        spaces: [{ id: "spc_1", name: "Space One" }],
      });
    }) as typeof fetch;

    const summary = await runLogin({ baseUrl: CLOUD, apiKey: "sk_test", browser: false });

    expect(calls).toEqual([`GET ${CLOUD}/api/v1/auth`]);
    expect(summary).toMatchObject({ status: "signed in", method: "api-key", space: "spc_1" });
    const env = loadDotEnvFile();
    expect(env.BUSABASE_API_KEY).toBe("sk_test");
    expect(env.BUSABASE_SPACE_ID).toBe("spc_1");
    expect(env.BUSABASE_BASE_URL).toBe(CLOUD);
  });

  it("requires --space-id for non-interactive login with multiple spaces", async () => {
    global.fetch = vi.fn(async () =>
      jsonResponse({
        user: { id: "usr_1", email: "dev@example.com" },
        space: { id: "spc_1", name: "Space One" },
        spaces: [
          { id: "spc_1", name: "Space One" },
          { id: "spc_2", name: "Space Two" },
        ],
      }),
    ) as typeof fetch;

    await expect(runLogin({ baseUrl: CLOUD, apiKey: "sk_test", browser: false })).rejects.toThrow(
      /--space-id/,
    );
    expect(loadDotEnvFile()).not.toHaveProperty("BUSABASE_SPACE_ID");
  });

  it("connects to an open local server without a token", async () => {
    // The auth probe (`GET /api/v1/bases`) returns 200 ⇒ open server, no login.
    global.fetch = vi.fn(async () => jsonResponse([])) as typeof fetch;

    const summary = await runLogin({ baseUrl: LOCAL, browser: false });

    expect(summary.status).toBe("connected (no auth)");
    const env = loadDotEnvFile();
    expect(env.BUSABASE_BASE_URL).toBe(LOCAL);
    expect(env).not.toHaveProperty("BUSABASE_API_KEY");
  });

  it("refuses to save a keyless connection when the local host actually requires auth", async () => {
    // Probe returns 401 ⇒ this host needs sign-in, so the no-auth path must bail.
    global.fetch = vi.fn(async () => new Response("{}", { status: 401 })) as typeof fetch;

    await expect(runLogin({ baseUrl: LOCAL, browser: false })).rejects.toThrow(/requires sign-in/i);
    expect(loadDotEnvFile()).not.toHaveProperty("BUSABASE_BASE_URL");
  });
});

describe("runRefresh", () => {
  it("no-ops for an API key (which never expires)", async () => {
    global.fetch = vi.fn() as typeof fetch;
    const summary = await runRefresh({ baseUrl: CLOUD, apiKey: "sk_static" });
    expect(summary.status).toBe("nothing to refresh");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("slides a session token forward and stores the new expiry", async () => {
    const calls: string[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push(`${request.method} ${request.url}`);
      return jsonResponse({ token: "bss_live", expiresAt: "2099-01-01T00:00:00.000Z" });
    }) as typeof fetch;

    const summary = await runRefresh({ baseUrl: CLOUD, apiKey: "bss_live" });

    expect(calls).toEqual([`POST ${CLOUD}/api/oauth/refresh`]);
    expect(summary).toMatchObject({ status: "refreshed", expiresAt: "2099-01-01T00:00:00.000Z" });
    expect(loadDotEnvFile().BUSABASE_TOKEN_EXPIRES_AT).toBe("2099-01-01T00:00:00.000Z");
  });

  it("tells an expired session to log in again", async () => {
    global.fetch = vi.fn(async () => new Response("{}", { status: 401 })) as typeof fetch;
    await expect(runRefresh({ baseUrl: CLOUD, apiKey: "bss_dead" })).rejects.toThrow(/expired/i);
  });

  it("errors when there is no saved credential", async () => {
    await expect(runRefresh({ baseUrl: CLOUD })).rejects.toThrow(/run .*login/i);
  });
});

describe("maybeAutoRefresh", () => {
  it("does nothing for an API key credential", async () => {
    global.fetch = vi.fn() as typeof fetch;
    await maybeAutoRefresh(CLOUD, "sk_key");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("refreshes a file-stored session that is within the expiry window", async () => {
    const nearExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // <2 days
    writeDotEnvFile({
      BUSABASE_BASE_URL: CLOUD,
      BUSABASE_API_KEY: "bss_soon",
      BUSABASE_TOKEN_EXPIRES_AT: nearExpiry,
    });
    global.fetch = vi.fn(async () =>
      jsonResponse({ token: "bss_soon", expiresAt: "2099-02-02T00:00:00.000Z" }),
    ) as typeof fetch;

    await maybeAutoRefresh(CLOUD, "bss_soon");

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(loadDotEnvFile().BUSABASE_TOKEN_EXPIRES_AT).toBe("2099-02-02T00:00:00.000Z");
  });

  it("leaves a session with plenty of runway alone", async () => {
    const farExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    writeDotEnvFile({ BUSABASE_API_KEY: "bss_fresh", BUSABASE_TOKEN_EXPIRES_AT: farExpiry });
    global.fetch = vi.fn() as typeof fetch;
    await maybeAutoRefresh(CLOUD, "bss_fresh");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("ignores a token that did not come from the config file", async () => {
    // File holds a different token ⇒ this one arrived via --api-key/env, so don't touch disk.
    writeDotEnvFile({
      BUSABASE_API_KEY: "bss_other",
      BUSABASE_TOKEN_EXPIRES_AT: "2000-01-01T00:00:00.000Z",
    });
    global.fetch = vi.fn() as typeof fetch;
    await maybeAutoRefresh(CLOUD, "bss_flag");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("runLogout", () => {
  it("revokes a session token server-side and clears the credential", async () => {
    writeDotEnvFile({ BUSABASE_API_KEY: "bss_live", BUSABASE_SPACE_ID: "spc_1" });
    const calls: string[] = [];
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      calls.push(`${request.method} ${request.url}`);
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const summary = await runLogout({ baseUrl: CLOUD, apiKey: "bss_live" });

    expect(calls).toEqual([`POST ${CLOUD}/api/oauth/revoke`]);
    expect(summary).toMatchObject({ status: "signed out", detail: "session revoked" });
    expect(loadDotEnvFile()).not.toHaveProperty("BUSABASE_API_KEY");
  });

  it("clears an API key locally without a revoke call", async () => {
    writeDotEnvFile({ BUSABASE_API_KEY: "sk_local" });
    global.fetch = vi.fn() as typeof fetch;
    const summary = await runLogout({ baseUrl: CLOUD, apiKey: "sk_local" });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(summary.detail).toMatch(/cleared locally/i);
    expect(loadDotEnvFile()).not.toHaveProperty("BUSABASE_API_KEY");
  });
});
