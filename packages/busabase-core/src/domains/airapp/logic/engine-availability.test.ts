import { describe, expect, it } from "vitest";
import { resolveAvailableAirAppEngines } from "./engine-availability";

describe("resolveAvailableAirAppEngines", () => {
  it("always offers the in-browser engine, which needs nothing configured", () => {
    expect(resolveAvailableAirAppEngines({ allowHostProcesses: false, env: {} })).toEqual([
      "nodepod",
    ]);
  });

  it("offers the host engine only where host processes are permitted", () => {
    expect(resolveAvailableAirAppEngines({ allowHostProcesses: true, env: {} })).toEqual([
      "nodepod",
      "local",
    ]);
  });

  it("keys Sandock on configuration, not on edition", () => {
    // A self-hoster who would rather not run apps on their own box gets the
    // remote engine; a cloud deployment without one does not.
    const env = { SANDOCK_BASE_URL: "https://s", SANDOCK_API_KEY: "k" };
    expect(resolveAvailableAirAppEngines({ allowHostProcesses: false, env })).toEqual([
      "nodepod",
      "sandock",
    ]);
    expect(resolveAvailableAirAppEngines({ allowHostProcesses: true, env })).toEqual([
      "nodepod",
      "local",
      "sandock",
    ]);
  });

  it("never lists srt", () => {
    // It network-isolates the process, so it can run an app but never preview
    // one. Offering it in a picker whose purpose is "see your app running"
    // would be offering a dead end.
    const all = resolveAvailableAirAppEngines({
      allowHostProcesses: true,
      env: { SANDOCK_BASE_URL: "https://s", SANDOCK_API_KEY: "k" },
    });
    expect(all).not.toContain("srt");
  });

  it("treats a half-configured Sandock as absent rather than present", () => {
    expect(
      resolveAvailableAirAppEngines({
        allowHostProcesses: false,
        env: { SANDOCK_BASE_URL: "https://s" },
      }),
    ).toEqual(["nodepod"]);
  });
});
