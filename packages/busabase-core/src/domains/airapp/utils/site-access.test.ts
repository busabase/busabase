import { ORPCError } from "@orpc/client";
import { describe, expect, it } from "vitest";
import { siteEnvironmentMessages } from "../../../i18n/site-environment";
import { AirAppSiteAccessError, readSiteAccessDenial, siteAccessMessage } from "./site-access";

describe("website permission refusals", () => {
  it("classifies exact transport codes without exposing provider text", () => {
    expect(
      readSiteAccessDenial(
        new ORPCError("FORBIDDEN", {
          data: { reason: "SPACE_VAULT_MANAGE_REQUIRED" },
          message: "opaque diagnostic",
        }),
      ),
    ).toBe("space-vault-manage");
    expect(readSiteAccessDenial(new ORPCError("FORBIDDEN"))).toBe("forbidden");
    expect(readSiteAccessDenial(new ORPCError("UNAUTHORIZED"))).toBe("unauthorized");
    expect(readSiteAccessDenial(new AirAppSiteAccessError("space-vault-manage"))).toBe(
      "space-vault-manage",
    );
    expect(
      siteAccessMessage(
        { manageRequired: "Ask an admin", forbidden: "No access", unauthorized: "Sign in" },
        "space-vault-manage",
      ),
    ).toBe("Ask an admin");
  });
  it("preserves plan upgrades and transient failure recovery", () => {
    expect(
      readSiteAccessDenial(
        new ORPCError("FORBIDDEN", { data: { reason: "AIRAPP_ENGINE_PLAN_REQUIRED" } }),
      ),
    ).toBeNull();
    expect(
      readSiteAccessDenial(
        new ORPCError("FORBIDDEN", { data: { reason: "AIRAPP_SITE_PUBLISH_PLAN_REQUIRED" } }),
      ),
    ).toBeNull();
    expect(readSiteAccessDenial(new ORPCError("BAD_GATEWAY"))).toBeNull();
    expect(readSiteAccessDenial(new Error("FORBIDDEN-looking network text"))).toBeNull();
  });
  it("explains both the workspace role and API key manage-access requirement", () => {
    const message = siteAccessMessage(siteEnvironmentMessages.en, "space-vault-manage");
    expect(message).toContain("workspace owner or admin");
    expect(message).toContain("API keys also need manage access");
    for (const copy of Object.values(siteEnvironmentMessages))
      expect(copy.manageRequired).toMatch(/API/);
  });
});
