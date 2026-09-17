import { describe, expect, it } from "vitest";
import {
  buildAirAppEmbedSource,
  buildAirAppExternalUrl,
  resolveAirAppSpaceId,
} from "./airapp-embed-url";

describe("resolveAirAppSpaceId", () => {
  it("prefers an explicitly selected workspace", () => {
    expect(
      resolveAirAppSpaceId({
        selectedSpaceId: "spc_selected",
        verifiedSpaceId: "spc_default",
      }),
    ).toBe("spc_selected");
  });

  it("uses the server-resolved workspace when none was selected locally", () => {
    expect(resolveAirAppSpaceId({ selectedSpaceId: null, verifiedSpaceId: "spc_default" })).toBe(
      "spc_default",
    );
  });

  it("returns null when neither source resolved a workspace", () => {
    expect(resolveAirAppSpaceId({ selectedSpaceId: null, verifiedSpaceId: null })).toBeNull();
  });
});

describe("buildAirAppEmbedSource", () => {
  it("keeps the token out of the native URL and sends it in a POST form", () => {
    const source = buildAirAppEmbedSource({
      serverUrl: "https://busabase.com/",
      mode: "cloud",
      bearerToken: "bso_test token",
      spaceId: "spc_test",
      nodeId: "aap_test",
    });

    expect(source).not.toBeNull();
    const parsed = new URL(source?.uri as string);
    expect(parsed.pathname).toBe("/api/auth/mobile-embed-token");
    expect(parsed.search).toBe("");
    expect(source?.method).toBe("POST");
    expect(source?.headers).toBeUndefined();
    const body = new URLSearchParams(source?.body);
    expect(body.get("token")).toBe("bso_test token");
    expect(body.get("target")).toBe("/dashboard/spc_test/airapp/aap_test?chromeless=1");
  });

  it("refuses to build a Cloud target without a selected space or bearer token", () => {
    const input = {
      serverUrl: "https://busabase.com",
      mode: "cloud" as const,
      bearerToken: "bso_test",
      spaceId: "spc_test",
      nodeId: "aap_test",
    };

    expect(buildAirAppEmbedSource({ ...input, spaceId: null })).toBeNull();
    expect(buildAirAppEmbedSource({ ...input, bearerToken: null })).toBeNull();
  });

  it("keeps self-hosted and demo targets on their compatibility route", () => {
    expect(
      buildAirAppEmbedSource({
        serverUrl: "http://127.0.0.1:15419/",
        mode: "self-hosted",
        bearerToken: null,
        spaceId: null,
        nodeId: "Air App/1",
      }),
    ).toEqual({
      uri: "http://127.0.0.1:15419/dashboard/airapp/Air%20App%2F1?chromeless=1",
    });
  });

  it("converts the POST form back to the legacy GET URL for browser-only launch", () => {
    const source = buildAirAppEmbedSource({
      serverUrl: "https://busabase.com",
      mode: "cloud",
      bearerToken: "bso_web",
      spaceId: "spc_test",
      nodeId: "aap_test",
    });

    expect(source).not.toBeNull();
    const parsed = new URL(buildAirAppExternalUrl(source as NonNullable<typeof source>));
    expect(parsed.searchParams.get("token")).toBe("bso_web");
    expect(parsed.searchParams.get("target")).toBe(
      "/dashboard/spc_test/airapp/aap_test?chromeless=1",
    );
  });
});
