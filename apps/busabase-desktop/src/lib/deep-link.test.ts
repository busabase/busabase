import { describe, expect, it } from "vitest";
import { parseCloudConnectReturn } from "./deep-link";

describe("parseCloudConnectReturn", () => {
  it("accepts the success and failure returns the OAuth callback page emits", () => {
    expect(parseCloudConnectReturn("busabase://desktop/cloud-connect?status=ok")).toBe("ok");
    expect(parseCloudConnectReturn("busabase://desktop/cloud-connect?status=error")).toBe("error");
  });

  it("tolerates a trailing slash", () => {
    expect(parseCloudConnectReturn("busabase://desktop/cloud-connect/?status=ok")).toBe("ok");
  });

  it("ignores the mobile app's OAuth redirect, which shares the scheme", () => {
    // `busabase://oauth/callback` is a real Cloud-whitelisted redirect URI for
    // apps/busabase-mobile and carries an authorization code. Treating it as a
    // Cloud Connect return would be wrong on every axis.
    expect(parseCloudConnectReturn("busabase://oauth/callback?code=abc&state=xyz")).toBeNull();
  });

  it("rejects anything that is not our scheme, path, or status", () => {
    expect(parseCloudConnectReturn("https://busabase.com/desktop/cloud-connect?status=ok")).toBe(
      null,
    );
    expect(parseCloudConnectReturn("busabase://desktop/something-else?status=ok")).toBeNull();
    expect(parseCloudConnectReturn("busabase://desktop/cloud-connect")).toBeNull();
    expect(parseCloudConnectReturn("busabase://desktop/cloud-connect?status=maybe")).toBeNull();
    expect(parseCloudConnectReturn("not a url at all")).toBeNull();
  });
});
