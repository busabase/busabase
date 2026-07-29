import { describe, expect, it, vi } from "vitest";
import {
  BUSABASE_AIRAPP_CLIENT_ID,
  BusabaseOAuthError,
  createBusabaseOAuthRequest,
  exchangeBusabaseOAuthCode,
  parseBusabaseOAuthCallback,
  refreshBusabaseOAuthToken,
  revokeBusabaseOAuthToken,
} from "./oauth.js";

describe("Busabase OAuth", () => {
  it("builds a PKCE request for the local app client", async () => {
    const request = await createBusabaseOAuthRequest({
      baseUrl: "https://busabase.com/api/v1/",
      redirectUri: "http://127.0.0.1:3107/auth/callback",
      state: "fixed-state",
    });
    const url = new URL(request.authorizeUrl);
    expect(request.baseUrl).toBe("https://busabase.com");
    expect(request.clientId).toBe(BUSABASE_AIRAPP_CLIENT_ID);
    expect(request.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.pathname).toBe("/api/oauth/authorize");
    expect(url.searchParams.get("resource")).toBe("https://busabase.com/api/v1");
    expect(url.searchParams.get("scope")).toBe("api");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("code_challenge")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.searchParams.get("state")).toBe("fixed-state");
  });

  it("rejects non-origin base URLs", async () => {
    await expect(
      createBusabaseOAuthRequest({
        baseUrl: "https://user:secret@busabase.com/workspace",
        redirectUri: "http://127.0.0.1:3107/auth/callback",
      }),
    ).rejects.toMatchObject({ code: "invalid_base_url" });
  });

  it("validates callback state and issuer", async () => {
    const request = await createBusabaseOAuthRequest({
      baseUrl: "https://busabase.com",
      redirectUri: "http://127.0.0.1:3107/auth/callback",
      state: "expected",
    });
    expect(
      parseBusabaseOAuthCallback(
        "http://127.0.0.1:3107/auth/callback?code=boc_1&state=expected&iss=https%3A%2F%2Fbusabase.com",
        request,
      ),
    ).toBe("boc_1");
    expect(() =>
      parseBusabaseOAuthCallback(
        "http://127.0.0.1:3107/auth/callback?code=boc_1&state=wrong&iss=https%3A%2F%2Fbusabase.com",
        request,
      ),
    ).toThrow(BusabaseOAuthError);
  });

  it("exchanges, refreshes, and revokes through form-encoded endpoints", async () => {
    const request = await createBusabaseOAuthRequest({
      baseUrl: "https://busabase.com",
      redirectUri: "http://127.0.0.1:3107/auth/callback",
    });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input);
      if (url.pathname === "/api/oauth/revoke") return new Response(null, { status: 200 });
      return new Response(
        JSON.stringify({
          access_token: "bso_access",
          refresh_token: "bsr_refresh",
          expires_in: 3600,
          scope: "api",
          token_type: "Bearer",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const fetchImpl = fetchMock as unknown as typeof fetch;

    await expect(exchangeBusabaseOAuthCode(request, "boc_1", fetchImpl)).resolves.toMatchObject({
      accessToken: "bso_access",
      refreshToken: "bsr_refresh",
      scope: ["api"],
    });
    await expect(
      refreshBusabaseOAuthToken(
        { baseUrl: request.baseUrl, refreshToken: "bsr_refresh" },
        fetchImpl,
      ),
    ).resolves.toMatchObject({ accessToken: "bso_access" });
    await expect(
      revokeBusabaseOAuthToken({ baseUrl: request.baseUrl, token: "bsr_refresh" }, fetchImpl),
    ).resolves.toBeUndefined();

    const calls = fetchMock.mock.calls.map(([input, init]) => ({
      path: new URL(input instanceof Request ? input.url : input).pathname,
      body: String(init?.body),
    }));
    expect(calls[0]).toMatchObject({ path: "/api/oauth/token" });
    expect(calls[0]?.body).toContain("grant_type=authorization_code");
    expect(calls[1]?.body).toContain("grant_type=refresh_token");
    expect(calls[2]?.path).toBe("/api/oauth/revoke");
  });
});
