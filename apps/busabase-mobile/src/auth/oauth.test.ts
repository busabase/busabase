import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
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
  getCloudSession: mocks.getCloudSession,
  setCloudSession: mocks.setCloudSession,
  isCloudSessionAccessTokenUsable: (session: { expiresAt: string } | null, minimumValidityMs = 0) =>
    Boolean(session && Date.parse(session.expiresAt) - Date.now() > minimumValidityMs),
}));

import { getValidBusabaseCloudSession } from "./oauth";

const originalFetch = global.fetch;

describe("getValidBusabaseCloudSession", () => {
  beforeEach(() => {
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
      });
    }) as typeof fetch;

    const [first, second] = await Promise.all([
      getValidBusabaseCloudSession(),
      getValidBusabaseCloudSession(),
    ]);
    expect(first).toMatchObject({ accessToken: "bso_new", refreshToken: "bsr_new" });
    expect(second).toEqual(first);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(mocks.setCloudSession).toHaveBeenCalledWith(first);
  });
});
