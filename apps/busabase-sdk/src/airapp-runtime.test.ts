import { describe, expect, it } from "vitest";
import {
  asKnownBusabaseAirAppRuntime,
  BUSABASE_AIRAPP_RUNTIME_ENV,
  BUSABASE_AIRAPP_RUNTIMES,
  isBusabaseAirAppHosted,
  readBusabaseAirAppRuntime,
} from "./airapp-node.js";

/**
 * These pin the one property that matters: naming the runtimes and deciding
 * hosting are separate, so a Busabase that adds an engine does not silently
 * un-host every app pinned to an older SDK. That exact failure has shipped
 * once already, from 66 apps each carrying their own copy of the list.
 */
describe("AirApp runtime identification", () => {
  it("treats an engine this SDK has never heard of as hosted", () => {
    // The whole reason hosting is presence and not membership.
    expect(isBusabaseAirAppHosted("some-engine-from-the-future")).toBe(true);
    expect(asKnownBusabaseAirAppRuntime("some-engine-from-the-future")).toBeNull();
  });

  it("treats absence as standalone, which is the only negative signal", () => {
    expect(isBusabaseAirAppHosted("")).toBe(false);
    expect(isBusabaseAirAppHosted("   ")).toBe(false);
  });

  it("recognises every runtime it ships with", () => {
    for (const runtime of BUSABASE_AIRAPP_RUNTIMES) {
      expect(isBusabaseAirAppHosted(runtime)).toBe(true);
      expect(asKnownBusabaseAirAppRuntime(runtime)).toBe(runtime);
    }
  });

  it("reads and trims the injected variable", () => {
    expect(readBusabaseAirAppRuntime({ [BUSABASE_AIRAPP_RUNTIME_ENV]: "  local  " })).toBe("local");
    expect(readBusabaseAirAppRuntime({})).toBe("");
  });

  it("still names the engine that was renamed, and not the old name", () => {
    // `local-node` became `local`; an app branching on the old string would be
    // branching on something Busabase no longer emits.
    expect(asKnownBusabaseAirAppRuntime("local")).toBe("local");
    expect(asKnownBusabaseAirAppRuntime("local-node")).toBeNull();
    // …but it is still hosted, which is what keeps such an app working.
    expect(isBusabaseAirAppHosted("local-node")).toBe(true);
  });
});
