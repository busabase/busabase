import { describe, expect, it } from "vitest";
import { resolveAvailableAirAppEngines, resolveHostProcessPolicy } from "./engine-availability";

describe("resolveAvailableAirAppEngines", () => {
  it("always offers the in-browser engine, which needs nothing configured", () => {
    expect(resolveAvailableAirAppEngines({ env: {} })).toEqual(["browser"]);
  });

  it("offers the host engine to a self-hosted server, with nothing configured", () => {
    // The premise of a self-hosted install: the host IS the user's machine, so
    // running their own AirApp on it is the point, not a risk to gate behind
    // an environment variable they have to discover.
    expect(resolveAvailableAirAppEngines({ env: { APP_ENV: "SELF-HOSTED" } })).toEqual([
      "browser",
      "local",
    ]);
  });

  it("never offers it on shared infrastructure", () => {
    for (const APP_ENV of ["PRODUCTION", "STAGING", "INTEGRATION"]) {
      expect(resolveAvailableAirAppEngines({ env: { APP_ENV } })).toEqual(["browser"]);
    }
  });

  it("offers the host engine only where host processes are permitted", () => {
    expect(resolveAvailableAirAppEngines({ allowHostProcesses: true, env: {} })).toEqual([
      "browser",
      "local",
    ]);
  });

  it("keys the remote engine on configuration, not on edition", () => {
    // A self-hoster who would rather not run apps on their own box gets the
    // remote engine; a cloud deployment without one does not.
    const env = { SANDOCK_BASE_URL: "https://s", SANDOCK_API_KEY: "k" };
    expect(resolveAvailableAirAppEngines({ allowHostProcesses: false, env })).toEqual([
      "browser",
      "remote",
    ]);
    expect(resolveAvailableAirAppEngines({ allowHostProcesses: true, env })).toEqual([
      "browser",
      "local",
      "remote",
    ]);
  });

  it("treats a half-configured remote provider as absent rather than present", () => {
    expect(
      resolveAvailableAirAppEngines({
        allowHostProcesses: false,
        env: { SANDOCK_BASE_URL: "https://s" },
      }),
    ).toEqual(["browser"]);
  });

  it("does not advertise Sandock when the configured base URL is invalid", () => {
    expect(
      resolveAvailableAirAppEngines({
        allowHostProcesses: false,
        env: {
          SANDOCK_BASE_URL: "https://sandock.example/api/v1",
          SANDOCK_API_KEY: "k",
        },
      }),
    ).toEqual(["browser"]);
  });
});

describe("resolveHostProcessPolicy", () => {
  it("says yes only where the host is somebody's own machine", () => {
    for (const APP_ENV of ["SELF-HOSTED", "DESKTOP", "LOCAL"]) {
      expect(resolveHostProcessPolicy({ APP_ENV })).toBe(true);
    }
    for (const APP_ENV of ["PRODUCTION", "STAGING", "INTEGRATION"]) {
      expect(resolveHostProcessPolicy({ APP_ENV })).toBe(false);
    }
  });

  it("treats absence as shared, because that is the deployment most likely to be", () => {
    // A deployment that never configured this is exactly the one that must not
    // be handed the permissive answer.
    expect(resolveHostProcessPolicy({})).toBe(false);
    expect(resolveHostProcessPolicy({ APP_ENV: "" })).toBe(false);
    expect(resolveHostProcessPolicy({ APP_ENV: "  " })).toBe(false);
    expect(resolveHostProcessPolicy({ APP_ENV: "something-new" })).toBe(false);
  });

  it("does not turn on which case convention a deployment picked", () => {
    // The tree already reads APP_ENV as both "production" and "PRODUCTION".
    expect(resolveHostProcessPolicy({ APP_ENV: "self-hosted" })).toBe(true);
    expect(resolveHostProcessPolicy({ APP_ENV: "Desktop" })).toBe(true);
    expect(resolveHostProcessPolicy({ APP_ENV: "production" })).toBe(false);
  });
});
