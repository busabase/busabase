import { afterEach, describe, expect, it, vi } from "vitest";
import {
  beginCloudConnectAuthorize,
  completeCloudConnectAuthorize,
  refreshCloudConnectCredential,
} from "../src/domains/settings/logic/cloud-connect-oauth";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe("beginCloudConnectAuthorize", () => {
  it("builds an authorize URL that forces re-authentication (prompt=login)", () => {
    const { authorizeUrl } = beginCloudConnectAuthorize({
      cloudUrl: "https://busabase.com",
      tunnelId: "tnl_123456789012345678901",
      redirectUri: "http://127.0.0.1:3000/api/cloud-connect/callback",
    });

    const url = new URL(authorizeUrl);
    expect(url.searchParams.get("client_id")).toBe("busabase-oss");
    expect(url.searchParams.get("client_platform")).toBeNull();
    expect(url.searchParams.get("resource")).toBe(
      "https://busabase.com/api/tunnel/tnl_123456789012345678901",
    );
    expect(url.searchParams.get("scope")).toBe("tunnel");
    // Cloud Connect must never silently link this OSS instance to whatever
    // account the admin's default browser already has a live session for.
    expect(url.searchParams.get("prompt")).toBe("login");
  });

  it("rotates the tunnel token set with a standard refresh-token request", async () => {
    global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      expect(request.headers.get("content-type")).toContain("application/x-www-form-urlencoded");
      expect(Object.fromEntries(new URLSearchParams(await request.text()))).toMatchObject({
        grant_type: "refresh_token",
        refresh_token: "bsr_old",
        client_id: "busabase-oss",
        resource: "https://busabase.com/api/tunnel/tnl_123456789012345678901",
      });
      return Response.json({
        access_token: "bso_new",
        refresh_token: "bsr_new",
        expires_in: 3600,
      });
    }) as typeof fetch;

    await expect(
      refreshCloudConnectCredential("https://busabase.com", "bsr_old", "tnl_123456789012345678901"),
    ).resolves.toMatchObject({
      token: "bso_new",
      refreshToken: "bsr_new",
      tunnelId: "tnl_123456789012345678901",
    });
  });

  it("rejects a callback from a different authorization-server issuer", async () => {
    const { authorizeUrl } = beginCloudConnectAuthorize({
      cloudUrl: "https://busabase.com",
      tunnelId: "tnl_123456789012345678901",
      redirectUri: "http://127.0.0.1:3000/api/cloud-connect/callback",
    });
    const state = new URL(authorizeUrl).searchParams.get("state") ?? "";
    global.fetch = vi.fn() as typeof fetch;

    await expect(
      completeCloudConnectAuthorize({
        code: "authorization-code",
        state,
        issuer: "https://evil.example",
      }),
    ).rejects.toThrow(/issuer mismatch/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
