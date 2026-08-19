import { parseDesktopCloudConnectReturnUrl } from "busabase-core/domains/settings/desktop-shell";
import { describe, expect, it } from "vitest";

describe("parseDesktopCloudConnectReturnUrl", () => {
  it("accepts the success and failure returns the OAuth callback page emits", () => {
    expect(parseDesktopCloudConnectReturnUrl("busabase://desktop/cloud-connect?status=ok")).toBe(
      "ok",
    );
    expect(parseDesktopCloudConnectReturnUrl("busabase://desktop/cloud-connect?status=error")).toBe(
      "error",
    );
  });

  it("tolerates a trailing slash", () => {
    expect(parseDesktopCloudConnectReturnUrl("busabase://desktop/cloud-connect/?status=ok")).toBe(
      "ok",
    );
  });

  it("ignores the mobile app's OAuth redirect, which shares the scheme", () => {
    // `busabase://oauth/callback` is a real Cloud-whitelisted redirect URI for
    // apps/busabase-mobile and carries an authorization code. Treating it as a
    // Cloud Connect return would be wrong on every axis.
    expect(
      parseDesktopCloudConnectReturnUrl("busabase://oauth/callback?code=abc&state=xyz"),
    ).toBeNull();
  });

  it("rejects anything that is not our scheme, path, or status", () => {
    expect(
      parseDesktopCloudConnectReturnUrl("https://busabase.com/desktop/cloud-connect?status=ok"),
    ).toBeNull();
    expect(
      parseDesktopCloudConnectReturnUrl("busabase://desktop/something-else?status=ok"),
    ).toBeNull();
    expect(parseDesktopCloudConnectReturnUrl("busabase://desktop/cloud-connect")).toBeNull();
    expect(
      parseDesktopCloudConnectReturnUrl("busabase://desktop/cloud-connect?status=maybe"),
    ).toBeNull();
    expect(parseDesktopCloudConnectReturnUrl("not a url at all")).toBeNull();
  });
});
