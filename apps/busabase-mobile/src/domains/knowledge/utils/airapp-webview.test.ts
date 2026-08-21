import { describe, expect, it } from "vitest";
import { canEmbedAirAppInWebView } from "./airapp-webview";

describe("canEmbedAirAppInWebView", () => {
  it.each(["https://busabase.com", "https://demo.busabase.com", "https://space.busabase.com"])(
    "embeds an iOS App-Bound Domain: %s",
    (serverUrl) => {
      expect(canEmbedAirAppInWebView({ platform: "ios", serverUrl })).toBe(true);
    },
  );

  it.each(["https://self-hosted.example.com", "http://busabase.com", "not a URL"])(
    "rejects a non-App-Bound iOS host: %s",
    (serverUrl) => {
      expect(canEmbedAirAppInWebView({ platform: "ios", serverUrl })).toBe(false);
    },
  );

  it("keeps AirApps embedded on Android", () => {
    expect(
      canEmbedAirAppInWebView({
        platform: "android",
        serverUrl: "https://self-hosted.example.com",
      }),
    ).toBe(true);
  });
});
