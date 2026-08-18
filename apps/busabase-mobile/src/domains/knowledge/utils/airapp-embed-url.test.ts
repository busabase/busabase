import { describe, expect, it } from "vitest";
import { buildAirAppEmbedUrl } from "./airapp-embed-url";

describe("buildAirAppEmbedUrl", () => {
  it("includes the selected space in a Cloud AirApp target", () => {
    const url = buildAirAppEmbedUrl({
      serverUrl: "https://busabase.com/",
      mode: "cloud",
      bearerToken: "bso_test token",
      spaceId: "spc_test",
      nodeId: "aap_test",
    });

    expect(url).not.toBeNull();
    const parsed = new URL(url as string);
    expect(parsed.pathname).toBe("/api/auth/mobile-embed-token");
    expect(parsed.searchParams.get("token")).toBe("bso_test token");
    expect(parsed.searchParams.get("target")).toBe(
      "/dashboard/spc_test/airapp/aap_test?chromeless=1",
    );
  });

  it("refuses to build a Cloud target without a selected space or bearer token", () => {
    const input = {
      serverUrl: "https://busabase.com",
      mode: "cloud" as const,
      bearerToken: "bso_test",
      spaceId: "spc_test",
      nodeId: "aap_test",
    };

    expect(buildAirAppEmbedUrl({ ...input, spaceId: null })).toBeNull();
    expect(buildAirAppEmbedUrl({ ...input, bearerToken: null })).toBeNull();
  });

  it("keeps self-hosted and demo targets on their compatibility route", () => {
    expect(
      buildAirAppEmbedUrl({
        serverUrl: "http://127.0.0.1:15419/",
        mode: "self-hosted",
        bearerToken: null,
        spaceId: null,
        nodeId: "Air App/1",
      }),
    ).toBe("http://127.0.0.1:15419/dashboard/airapp/Air%20App%2F1?chromeless=1");
  });
});
