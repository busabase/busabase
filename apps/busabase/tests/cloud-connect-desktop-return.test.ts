import {
  buildDesktopCloudConnectReturnUrl,
  DESKTOP_CLOUD_CONNECT_RETURNED,
  isDesktopCloudConnectReturn,
} from "busabase-core/domains/settings/desktop-shell";
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { GET as cloudConnectCallback } from "../src/app/api/cloud-connect/callback/route";
import {
  beginCloudConnectAuthorize,
  getCloudConnectFlowLocale,
  isDesktopCloudConnectFlow,
} from "../src/domains/settings/logic/cloud-connect-oauth";

const flowInput = {
  cloudUrl: "https://busabase.com",
  tunnelId: "tnl_123456789012345678901",
  redirectUri: "http://127.0.0.1:15419/api/cloud-connect/callback",
};

const stateOf = (authorizeUrl: string) => new URL(authorizeUrl).searchParams.get("state") as string;

describe("buildDesktopCloudConnectReturnUrl", () => {
  it("emits exactly the URLs apps/busabase-desktop parses", () => {
    // Pin the externally registered protocol literals rather than rebuilding
    // the expectations from the shared helper.
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

describe("getCloudConnectFlowLocale", () => {
  it("retains the selected UI locale for a callback opened in another browser", () => {
    const { authorizeUrl } = beginCloudConnectAuthorize({ ...flowInput, locale: "ja" });
    expect(getCloudConnectFlowLocale(stateOf(authorizeUrl))).toBe("ja");
    expect(getCloudConnectFlowLocale("unknown-state")).toBeUndefined();
  });

  it("renders the initiating locale on an OAuth failure, regardless of the browser locale", async () => {
    const { authorizeUrl } = beginCloudConnectAuthorize({ ...flowInput, locale: "ja" });
    const state = stateOf(authorizeUrl);
    const request = new NextRequest(
      `http://127.0.0.1:15419/api/cloud-connect/callback?error=access_denied&state=${state}`,
      { headers: { "accept-language": "en" } },
    );
    const response = await cloudConnectCallback(request);
    expect(response.status).toBe(400);
    const html = await response.text();
    expect(html).toContain('<html lang="ja">');
    expect(html).toContain("サインインに失敗しました");
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
