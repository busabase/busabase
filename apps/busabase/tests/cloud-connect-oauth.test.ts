import { describe, expect, it } from "vitest";
import { beginCloudConnectAuthorize } from "../src/domains/settings/logic/cloud-connect-oauth";

describe("beginCloudConnectAuthorize", () => {
  it("builds an authorize URL that forces re-authentication (prompt=login)", () => {
    const { authorizeUrl } = beginCloudConnectAuthorize({
      cloudUrl: "https://busabase.com",
      tunnelId: "tun_test123",
      redirectUri: "http://127.0.0.1:3000/api/cloud-connect/callback",
    });

    const url = new URL(authorizeUrl);
    expect(url.searchParams.get("client_id")).toBe("busabase-oss");
    expect(url.searchParams.get("client_platform")).toBe("tunnel");
    expect(url.searchParams.get("tunnel_id")).toBe("tun_test123");
    // Cloud Connect must never silently link this OSS instance to whatever
    // account the admin's default browser already has a live session for.
    expect(url.searchParams.get("prompt")).toBe("login");
  });
});
