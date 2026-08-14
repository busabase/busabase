import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  addCloudSession: vi.fn(),
  getCloudSession: vi.fn(),
  setCloudSession: vi.fn(),
}));

vi.mock("expo-crypto", () => ({
  CryptoDigestAlgorithm: { SHA256: "SHA-256" },
  CryptoEncoding: { BASE64: "base64" },
  digestStringAsync: vi.fn(),
  getRandomBytes: vi.fn(),
}));
vi.mock("expo-web-browser", () => ({
  dismissAuthSession: vi.fn(),
  maybeCompleteAuthSession: vi.fn(),
  openAuthSessionAsync: vi.fn(),
}));
vi.mock("~/connection/config", () => ({
  busabaseConfig: {
    cloudUrl: "https://busabase.com",
    oauthClientId: "busabase-mobile",
    oauthRedirectUri: "busabase://oauth/callback",
    userAgent: "BusabaseApp/Test",
  },
}));
vi.mock("./session-store", () => ({
  addCloudSession: mocks.addCloudSession,
  getCloudSession: mocks.getCloudSession,
  setCloudSession: mocks.setCloudSession,
  isCloudSessionAccessTokenUsable: (session: { expiresAt: string } | null, minimumValidityMs = 0) =>
    Boolean(session && Date.parse(session.expiresAt) - Date.now() > minimumValidityMs),
}));

import * as Crypto from "expo-crypto";
import * as WebBrowser from "expo-web-browser";
import { getValidBusabaseCloudSession, signInWithBusabaseCloud } from "./oauth";

const originalFetch = global.fetch;

describe("getValidBusabaseCloudSession", () => {
  beforeEach(() => {
    mocks.addCloudSession.mockReset();
    mocks.getCloudSession.mockReset();
    mocks.setCloudSession.mockReset();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns a token with sufficient lifetime without a refresh request", async () => {
    const session = {
      accessToken: "bso_current",
      refreshToken: "bsr_current",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      user: { id: "current", email: "current@example.com", name: "Current", image: null },
    };
    mocks.getCloudSession.mockResolvedValue(session);
    global.fetch = vi.fn() as typeof fetch;

    await expect(getValidBusabaseCloudSession()).resolves.toEqual(session);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("rotates a near-expiry token with a standard form request and persists it", async () => {
    mocks.getCloudSession.mockResolvedValue({
      accessToken: "bso_old",
      refreshToken: "bsr_old",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      expect(request.headers.get("content-type")).toContain("application/x-www-form-urlencoded");
      const body = new URLSearchParams(await request.text());
      expect(Object.fromEntries(body)).toMatchObject({
        grant_type: "refresh_token",
        refresh_token: "bsr_old",
        client_id: "busabase-mobile",
        resource: "https://busabase.com/api/rpc",
      });
      return Response.json({
        access_token: "bso_new",
        refresh_token: "bsr_new",
        expires_in: 3600,
        user: { id: "user-1", email: "user@example.com", name: "User", image: null },
      });
    }) as typeof fetch;

    const [first, second] = await Promise.all([
      getValidBusabaseCloudSession(),
      getValidBusabaseCloudSession(),
    ]);
    expect(first).toMatchObject({
      accessToken: "bso_new",
      refreshToken: "bsr_new",
      user: { id: "user-1", email: "user@example.com" },
    });
    expect(second).toEqual(first);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.setCloudSession).toHaveBeenCalledWith(first);
  });
});

describe("signInWithBusabaseCloud authorization request", () => {
  beforeEach(() => {
    mocks.addCloudSession.mockReset();
    mocks.addCloudSession.mockResolvedValue(null);
    vi.mocked(Crypto.getRandomBytes).mockImplementation((length: number) =>
      new Uint8Array(length).fill(7),
    );
    vi.mocked(Crypto.digestStringAsync).mockResolvedValue("Zm9vYmFyL2NoYWxsZW5nZQ==");
    vi.mocked(WebBrowser.openAuthSessionAsync).mockResolvedValue({
      type: "success",
      url: "busabase://oauth/callback?code=auth-code&state=STATE&iss=https://busabase.com",
    } as Awaited<ReturnType<typeof WebBrowser.openAuthSessionAsync>>);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.mocked(WebBrowser.openAuthSessionAsync).mockReset();
  });

  const authorizeUrl = async () => {
    global.fetch = vi.fn(async () =>
      Response.json({
        access_token: "bso_new",
        refresh_token: "bsr_new",
        expires_in: 3600,
        user: { id: "user-1", email: "user@example.com", name: "User", image: null },
      }),
    ) as typeof fetch;

    // `state` is random, so read it back off the request we actually built and
    // feed it into the callback the mocked browser returns.
    vi.mocked(WebBrowser.openAuthSessionAsync).mockImplementation(async (url: string) => {
      const state = new URL(url).searchParams.get("state") ?? "";
      return {
        type: "success",
        url: `busabase://oauth/callback?code=auth-code&state=${state}&iss=https%3A%2F%2Fbusabase.com`,
      } as Awaited<ReturnType<typeof WebBrowser.openAuthSessionAsync>>;
    });

    await signInWithBusabaseCloud();
    const [url] = vi.mocked(WebBrowser.openAuthSessionAsync).mock.calls[0];
    return new URL(url);
  };

  it("does not force a full re-login — the Cloud confirmation screen handles account selection", async () => {
    const url = await authorizeUrl();

    // Removing `prompt=login` is only safe because busabase-native/-mobile now
    // require consent: the confirmation screen (with its account switcher) is
    // what stops a live browser session from silently minting a token.
    expect(url.searchParams.get("prompt")).toBeNull();
    expect(url.searchParams.has("prompt")).toBe(false);
  });

  it("still sends the full PKCE authorization-code request", async () => {
    const url = await authorizeUrl();

    expect(url.pathname).toBe("/api/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      client_id: "busabase-mobile",
      resource: "https://busabase.com/api/rpc",
      scope: "rpc",
      response_type: "code",
      code_challenge_method: "S256",
      redirect_uri: "busabase://oauth/callback",
    });
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("state")).toBeTruthy();
  });
});
