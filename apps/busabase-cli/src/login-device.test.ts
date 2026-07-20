import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadDotEnvFile } from "./config-file";
import { runLogin, runLogout, runRefresh } from "./login";

const CLOUD = "https://busabase.com";
const ACCESS_TOKEN = "opaque-device-session-secret";
const API_KEY = "sk_device_selected_secret";
const originalFetch = global.fetch;
let home: string;
let originalHome: string | undefined;
let stderr: string[];

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(async () => {
  vi.useFakeTimers();
  originalHome = process.env.HOME;
  home = await mkdtemp(join(tmpdir(), "busabase-device-"));
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  await rm(home, { force: true, recursive: true });
});

describe("runLogin --device-code", () => {
  it("uses the temporary session only to finalize and persists the selected API key", async () => {
    let tokenPolls = 0;
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      if (request.url.endsWith("/api/auth/device/code")) {
        expect(request.headers.get("origin")).toBe(CLOUD);
        return jsonResponse({
          device_code: "private-device-code",
          user_code: "ABCD2345",
          verification_uri: `${CLOUD}/device`,
          verification_uri_complete: `${CLOUD}/device?user_code=ABCD2345`,
          expires_in: 60,
          interval: 1,
        });
      }
      if (request.url.endsWith("/api/auth/device/token")) {
        expect(request.headers.get("origin")).toBe(CLOUD);
        tokenPolls += 1;
        return tokenPolls === 1
          ? jsonResponse({ error: "authorization_pending", error_description: "Pending" }, 400)
          : jsonResponse({ access_token: ACCESS_TOKEN, expires_in: 3600 });
      }
      if (request.url.endsWith("/api/v1/device/finalize")) {
        expect(request.headers.get("authorization")).toBe(`Bearer ${ACCESS_TOKEN}`);
        expect(await request.json()).toEqual({ deviceCode: "private-device-code" });
        return jsonResponse({
          apiKey: API_KEY,
          apiKeyId: "apk_1",
          expiresAt: "2099-01-01T00:00:00.000Z",
          credentialType: "api_key",
        });
      }
      if (request.url.endsWith("/api/v1/auth")) {
        expect(request.headers.get("authorization")).toBe(`Bearer ${API_KEY}`);
        return jsonResponse({
          user: { id: "usr_1", email: "dev@example.com" },
          space: { id: "spc_1", name: "Space One" },
          spaces: [{ id: "spc_1", name: "Space One" }],
          createdSpace: true,
          bootstrapRequired: true,
        });
      }
      throw new Error(`Unexpected request: ${request.url}`);
    }) as typeof fetch;

    const login = runLogin({ baseUrl: CLOUD, deviceCode: true, browser: false });
    await vi.advanceTimersByTimeAsync(2_000);
    const summary = await login;

    expect(summary).toMatchObject({
      status: "signed in",
      method: "device",
      credentialType: "api_key",
      createdSpace: "true",
      bootstrapRequired: "true",
    });
    const env = loadDotEnvFile();
    expect(env.BUSABASE_API_KEY).toBe(API_KEY);
    expect(env).not.toHaveProperty("BUSABASE_TOKEN_EXPIRES_AT");
    expect(summary.expiresAt).toBe("2099-01-01T00:00:00.000Z");
    expect(stderr.join("\n")).toContain("ABCD2345");
    expect(stderr.join("\n")).not.toContain(ACCESS_TOKEN);
    expect(stderr.join("\n")).not.toContain(API_KEY);
    expect(JSON.stringify(summary)).not.toContain(ACCESS_TOKEN);
    expect(JSON.stringify(summary)).not.toContain(API_KEY);

    const callsBeforeCredentialActions = vi.mocked(global.fetch).mock.calls.length;
    await expect(runRefresh({ baseUrl: CLOUD, apiKey: API_KEY })).resolves.toMatchObject({
      status: "nothing to refresh",
    });
    expect(vi.mocked(global.fetch).mock.calls).toHaveLength(callsBeforeCredentialActions);
    await expect(runLogout({ baseUrl: CLOUD, apiKey: API_KEY })).resolves.toMatchObject({
      detail: "API key cleared locally (revoke it in the dashboard to disable it)",
    });
    expect(vi.mocked(global.fetch).mock.calls).toHaveLength(callsBeforeCredentialActions);
  });

  it("does not save the temporary session when API key finalization fails", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.endsWith("/api/auth/device/code")) {
        return jsonResponse({
          device_code: "private-device-code",
          user_code: "ABCD2345",
          verification_uri: `${CLOUD}/device`,
          expires_in: 60,
          interval: 1,
        });
      }
      if (url.endsWith("/api/auth/device/token")) {
        return jsonResponse({ access_token: ACCESS_TOKEN, expires_in: 3600 });
      }
      if (url.endsWith("/api/v1/device/finalize")) {
        return jsonResponse({ error: "The selected API key was deleted" }, 409);
      }
      throw new Error(`Unexpected request: ${url}`);
    }) as typeof fetch;

    const login = runLogin({ baseUrl: CLOUD, deviceCode: true, browser: false });
    const assertion = expect(login).rejects.toThrow(/finalize.*deleted/i);
    await vi.advanceTimersByTimeAsync(1_000);
    await assertion;
    expect(loadDotEnvFile()).not.toHaveProperty("BUSABASE_API_KEY");
  });

  it("honors slow_down and reports denial without saving a credential", async () => {
    let polls = 0;
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.endsWith("/api/auth/device/code")) {
        return jsonResponse({
          device_code: "private-device-code",
          user_code: "ABCD2345",
          verification_uri: `${CLOUD}/device`,
          expires_in: 60,
          interval: 1,
        });
      }
      polls += 1;
      return polls === 1
        ? jsonResponse({ error: "slow_down", error_description: "Slow down" }, 400)
        : jsonResponse({ error: "access_denied", error_description: "Denied" }, 400);
    }) as typeof fetch;

    const login = runLogin({ baseUrl: CLOUD, deviceCode: true, browser: false });
    const assertion = expect(login).rejects.toThrow(/denied/i);
    await vi.advanceTimersByTimeAsync(7_000);
    await assertion;
    expect(loadDotEnvFile()).not.toHaveProperty("BUSABASE_API_KEY");
  });

  it("fails clearly after repeated polling network errors", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = input.toString();
      if (url.endsWith("/api/auth/device/code")) {
        return jsonResponse({
          device_code: "private-device-code",
          user_code: "ABCD2345",
          verification_uri: `${CLOUD}/device`,
          expires_in: 60,
          interval: 1,
        });
      }
      throw new Error("offline");
    }) as typeof fetch;

    const login = runLogin({ baseUrl: CLOUD, deviceCode: true, browser: false });
    const assertion = expect(login).rejects.toThrow(/network connection/i);
    await vi.advanceTimersByTimeAsync(3_000);
    await assertion;
  });
});
