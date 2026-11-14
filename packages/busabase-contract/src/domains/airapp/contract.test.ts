import { describe, expect, it } from "vitest";
import { resolveProcedurePermissionPolicy } from "../../access-control/api-key-level";
import { airAppSiteDomainInputSchema, airAppSitePrimaryDomainInputSchema } from "./contract";

describe("custom website domain inputs", () => {
  it("normalizes the hostname without accepting URLs or other routing syntax", () => {
    expect(
      airAppSiteDomainInputSchema.parse({ nodeId: "app", hostname: " Shop.Company.COM " }),
    ).toEqual({ nodeId: "app", hostname: "shop.company.com" });
    for (const hostname of [
      "https://shop.company.com",
      "shop.company.com/path",
      "shop.company.com:443",
      "*.company.com",
      "127.0.0.1",
      "[::1]",
      "localhost",
      "-shop.company.com",
      "shop-.company.com",
      `shop.${"a".repeat(64)}.com`,
    ]) {
      expect(airAppSiteDomainInputSchema.safeParse({ nodeId: "app", hostname }).success).toBe(
        false,
      );
    }
  });

  it("accepts a normalized primary hostname or null to clear it", () => {
    expect(
      airAppSitePrimaryDomainInputSchema.parse({ nodeId: "app", hostname: " WWW.Company.com " }),
    ).toEqual({ nodeId: "app", hostname: "www.company.com" });
    expect(airAppSitePrimaryDomainInputSchema.parse({ nodeId: "app", hostname: null })).toEqual({
      nodeId: "app",
      hostname: null,
    });
    expect(
      airAppSitePrimaryDomainInputSchema.safeParse({ nodeId: "app", hostname: "https://a.com" })
        .success,
    ).toBe(false);
  });

  it("requires node write permission for every domain procedure", () => {
    for (const name of [
      "siteDomains",
      "siteBindDomain",
      "siteUnbindDomain",
      "siteSetPrimaryDomain",
    ]) {
      expect(resolveProcedurePermissionPolicy(["airapps", name])).toEqual({
        level: "write",
        scope: "node",
      });
    }
  });
});
