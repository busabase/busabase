import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

interface ExpoAppConfig {
  expo: {
    ios: {
      infoPlist: {
        WKAppBoundDomains: string[];
      };
    };
  };
}

const appConfig = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../app.json", import.meta.url)), "utf8"),
) as ExpoAppConfig;

const appBoundDomains = appConfig.expo.ios.infoPlist.WKAppBoundDomains;
const requiredNavigationHosts = [
  "busabase.com",
  "book.bika.ai",
  "kellychan.im",
  "buda.im",
  "pub-5d59c786708441b3a80620d87e7dee2b.r2.dev",
  "moonrouter.dev",
  "space.bilibili.com",
] as const;

describe("iOS App-Bound Domains", () => {
  it.each(requiredNavigationHosts)("allows navigation from embedded AirApps to %s", (hostname) => {
    expect(appBoundDomains).toContain(hostname);
  });

  it("stays within WebKit's 10-domain limit without duplicate entries", () => {
    expect(appBoundDomains.length).toBeLessThanOrEqual(10);
    expect(new Set(appBoundDomains).size).toBe(appBoundDomains.length);
  });
});
