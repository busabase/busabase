import { afterEach, describe, expect, it, vi } from "vitest";
import { readRouterOauthOrigin } from "./router-oauth-origin";

const fallbackOrigin = "https://workspace.example.test";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Router authorization public origin", () => {
  it("uses the host's runtime public configuration before the build-time value", () => {
    vi.stubGlobal("__SHARELIB_PUBLIC_ENV__", { appUrl: "https://busabase.com/path?query=1#hash" });
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://build.example.test");
    expect(readRouterOauthOrigin(fallbackOrigin)).toBe("https://busabase.com");
  });

  it.each([undefined, {}, { appUrl: null }, { appUrl: "" }, "invalid injection"])(
    "uses the standalone build configuration with injection %j",
    (injected) => {
      vi.stubGlobal("__SHARELIB_PUBLIC_ENV__", injected);
      vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3060/some/path");
      expect(readRouterOauthOrigin(fallbackOrigin)).toBe("http://localhost:3060");
    },
  );

  it("uses the current origin when neither deployment configuration is present", () => {
    vi.stubGlobal("__SHARELIB_PUBLIC_ENV__", undefined);
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");
    expect(readRouterOauthOrigin(fallbackOrigin)).toBe(fallbackOrigin);
  });

  it.each([
    "javascript:alert(1)",
    "file:///tmp/config",
    "https://user:password@busabase.com",
    "https://user@busabase.com",
    "//busabase.com",
    "not a URL",
    42,
  ])("uses the current origin for unsafe or malformed runtime configuration %j", (appUrl) => {
    vi.stubGlobal("__SHARELIB_PUBLIC_ENV__", { appUrl });
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://build.example.test");
    expect(readRouterOauthOrigin(fallbackOrigin)).toBe(fallbackOrigin);
  });
});
