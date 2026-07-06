import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDotEnvFile } from "./config-file";
import { runLogin } from "./login";

/**
 * The OAuth PKCE loopback flow (`login --oauth`) is the security-critical, hardest-
 * to-test branch: it spins up a real localhost callback server, prints an authorize
 * URL, and exchanges the returned code for a native session token. These tests drive
 * it for real — `fetch` is mocked for the outbound token/verify calls, but the browser
 * redirect is simulated by hitting the loopback `/callback` with the *original* fetch,
 * so the server, PKCE state check, and token exchange all actually run.
 */

const CLOUD = "https://busabase.com";

let home: string;
let originalHome: string | undefined;
const originalFetch = global.fetch;
let stderr: string[];

beforeEach(async () => {
  originalHome = process.env.HOME;
  home = await mkdtemp(join(tmpdir(), "busabase-oauth-"));
  process.env.HOME = home;
  stderr = [];
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  });
});

afterEach(async () => {
  process.env.HOME = originalHome;
  global.fetch = originalFetch;
  vi.restoreAllMocks();
  await rm(home, { force: true, recursive: true });
});

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Poll a predicate until it returns a value or the timeout elapses. */
const waitFor = async <T>(predicate: () => T | undefined, timeoutMs = 3000): Promise<T> => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = predicate();
    if (value !== undefined) return value;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for the authorize URL");
};

/** The authorize URL `oauthLogin` prints to stderr once the loopback server is up. */
const findAuthorizeUrl = (): string | undefined =>
  stderr.find((line) => line.includes("/api/oauth/authorize"))?.match(/https?:\/\/\S+/)?.[0];

describe("runLogin --oauth (PKCE loopback)", () => {
  it("completes the browser flow: exchanges the code and persists the session token", async () => {
    let tokenBody: Record<string, unknown> = {};
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.url.endsWith("/api/oauth/token")) {
        tokenBody = (await request.json()) as Record<string, unknown>;
        return jsonResponse({ token: "bss_session", expiresAt: "2099-01-01T00:00:00.000Z" });
      }
      if (request.url.endsWith("/api/v1/auth")) {
        return jsonResponse({
          user: { id: "usr_1", email: "dev@example.com" },
          space: { id: "spc_1", name: "Space One" },
          spaces: [{ id: "spc_1", name: "Space One" }],
        });
      }
      return originalFetch(input as RequestInfo, init);
    }) as typeof fetch;

    const loginPromise = runLogin({ baseUrl: CLOUD, oauth: true, browser: false });

    // Simulate the browser redirect back to the loopback callback with the real state.
    const authorizeUrl = new URL(await waitFor(findAuthorizeUrl));
    const state = authorizeUrl.searchParams.get("state");
    const redirectUri = authorizeUrl.searchParams.get("redirect_uri") as string;
    expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    await originalFetch(`${redirectUri}?code=auth_code_123&state=${state}`);

    const summary = await loginPromise;

    // PKCE: the code verifier is sent on exchange and matches the S256 challenge.
    expect(tokenBody).toMatchObject({ grant_type: "authorization_code", code: "auth_code_123" });
    expect(String(tokenBody.code_verifier)).toBeTruthy();
    expect(authorizeUrl.searchParams.get("code_challenge_method")).toBe("S256");

    expect(summary).toMatchObject({ status: "signed in", method: "oauth" });
    const env = loadDotEnvFile();
    expect(env.BUSABASE_API_KEY).toBe("bss_session");
    expect(env.BUSABASE_TOKEN_EXPIRES_AT).toBe("2099-01-01T00:00:00.000Z");
    expect(env.BUSABASE_SPACE_ID).toBe("spc_1");
  });

  it("rejects a callback whose state does not match the request", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
      originalFetch(input as RequestInfo, init),
    ) as typeof fetch;

    const loginPromise = runLogin({ baseUrl: CLOUD, oauth: true, browser: false });
    // Attach the rejection handler before firing the callback so the reject never
    // races ahead of its `.catch` (which Vitest would flag as an unhandled rejection).
    const rejects = expect(loginPromise).rejects.toThrow(/state mismatch/i);
    const authorizeUrl = new URL(await waitFor(findAuthorizeUrl));
    const redirectUri = authorizeUrl.searchParams.get("redirect_uri") as string;
    await originalFetch(`${redirectUri}?code=auth_code_123&state=WRONG_STATE`);

    await rejects;
    expect(loadDotEnvFile()).not.toHaveProperty("BUSABASE_API_KEY");
  });

  it("surfaces a failed token exchange", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.url.endsWith("/api/oauth/token")) {
        return new Response("bad grant", { status: 400 });
      }
      return originalFetch(input as RequestInfo, init);
    }) as typeof fetch;

    const loginPromise = runLogin({ baseUrl: CLOUD, oauth: true, browser: false });
    const rejects = expect(loginPromise).rejects.toThrow(/token exchange failed/i);
    const authorizeUrl = new URL(await waitFor(findAuthorizeUrl));
    const state = authorizeUrl.searchParams.get("state");
    const redirectUri = authorizeUrl.searchParams.get("redirect_uri") as string;
    await originalFetch(`${redirectUri}?code=auth_code_123&state=${state}`);

    await rejects;
    expect(loadDotEnvFile()).not.toHaveProperty("BUSABASE_API_KEY");
  });
});
