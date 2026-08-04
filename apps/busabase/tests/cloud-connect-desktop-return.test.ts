import { describe, expect, it } from "vitest";
import {
  beginCloudConnectAuthorize,
  isDesktopCloudConnectFlow,
} from "../src/domains/settings/logic/cloud-connect-oauth";
import {
  buildDesktopCloudConnectReturnUrl,
  DESKTOP_CLOUD_CONNECT_RETURNED,
  isDesktopCloudConnectReturn,
} from "../src/domains/settings/utils/desktop-shell";

const flowInput = {
  cloudUrl: "https://busabase.com",
  tunnelId: "tnl_123456789012345678901",
  redirectUri: "http://127.0.0.1:15419/api/cloud-connect/callback",
};

const stateOf = (authorizeUrl: string) => new URL(authorizeUrl).searchParams.get("state") as string;

describe("buildDesktopCloudConnectReturnUrl", () => {
  it("emits exactly the URLs apps/busabase-desktop parses", () => {
    // These two strings are the contract between this app's OAuth callback page
    // and `apps/busabase-desktop/src/lib/deep-link.ts`. If either side changes
    // shape, sign-in silently stops handing the user back to the desktop window,
    // so pin the literal here rather than rebuilding it from the same helper.
    expect(buildDesktopCloudConnectReturnUrl("ok")).toBe(
      "busabase://desktop/cloud-connect?status=ok",
    );
    expect(buildDesktopCloudConnectReturnUrl("error")).toBe(
      "busabase://desktop/cloud-connect?status=error",
    );
  });

  it("does not collide with the mobile app's OAuth redirect URI", () => {
    // `busabase://oauth/callback` is whitelisted by Cloud as a real redirect
    // target for apps/busabase-mobile and carries an authorization code.
    expect(buildDesktopCloudConnectReturnUrl("ok")).not.toContain("oauth/callback");
  });
});

describe("isDesktopCloudConnectFlow", () => {
  it("remembers a desktop-initiated flow against its state", () => {
    const { authorizeUrl } = beginCloudConnectAuthorize({ ...flowInput, returnToDesktop: true });
    expect(isDesktopCloudConnectFlow(stateOf(authorizeUrl))).toBe(true);
  });

  it("defaults to the plain browser-tab flow", () => {
    const { authorizeUrl } = beginCloudConnectAuthorize(flowInput);
    expect(isDesktopCloudConnectFlow(stateOf(authorizeUrl))).toBe(false);
  });

  it("is safe to call for an unknown, missing, or already-consumed state", () => {
    // The `?error=` callback path asks before there is anything to exchange,
    // and an expired flow must not throw on the way to the error page.
    expect(isDesktopCloudConnectFlow(null)).toBe(false);
    expect(isDesktopCloudConnectFlow("")).toBe(false);
    expect(isDesktopCloudConnectFlow("never-issued")).toBe(false);
  });
});

describe("isDesktopCloudConnectReturn", () => {
  const framed = () => {
    const parent = {} as Window;
    return { win: { parent } as Window, parent };
  };

  it("accepts the shell's report of a finished sign-in", () => {
    const { win, parent } = framed();
    const message = {
      data: { type: DESKTOP_CLOUD_CONNECT_RETURNED, status: "ok" },
      source: parent,
    };
    expect(isDesktopCloudConnectReturn(message as never, win)).toBe("ok");
  });

  it("rejects the same message from any other frame", () => {
    const { win } = framed();
    // A nested iframe (an AirApp, an embedded preview) must not be able to
    // drive the Settings tab by forging the shell's message.
    const message = {
      data: { type: DESKTOP_CLOUD_CONNECT_RETURNED, status: "ok" },
      source: {} as Window,
    };
    expect(isDesktopCloudConnectReturn(message as never, win)).toBeNull();
  });

  it("rejects it outright when we are not embedded at all", () => {
    const standalone = { parent: undefined } as unknown as Window;
    const message = { data: { type: DESKTOP_CLOUD_CONNECT_RETURNED, status: "ok" }, source: null };
    expect(isDesktopCloudConnectReturn(message as never, standalone)).toBeNull();
  });

  it("ignores unrelated or malformed payloads from the shell", () => {
    const { win, parent } = framed();
    for (const data of [
      null,
      {},
      { type: "something-else" },
      { type: DESKTOP_CLOUD_CONNECT_RETURNED },
      { type: DESKTOP_CLOUD_CONNECT_RETURNED, status: "weird" },
    ]) {
      expect(isDesktopCloudConnectReturn({ data, source: parent } as never, win)).toBeNull();
    }
  });
});
