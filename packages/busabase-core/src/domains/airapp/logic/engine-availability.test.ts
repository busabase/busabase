import { describe, expect, it } from "vitest";
import { resolveAvailableAirAppEngines } from "./engine-availability";

describe("resolveAvailableAirAppEngines", () => {
  it("always offers the in-browser engine, which needs nothing configured", () => {
    expect(resolveAvailableAirAppEngines({ allowHostProcesses: false, env: {} })).toEqual([
      "browser",
    ]);
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
});
