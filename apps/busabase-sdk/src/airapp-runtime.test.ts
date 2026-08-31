import { describe, expect, it } from "vitest";
import {
  asKnownBusabaseAirAppRuntime,
  BUSABASE_AIRAPP_RUNTIME_ALIASES,
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

  it("normalises a retired engine name to the current one", () => {
    // The direction that actually occurs: an app pins an SDK, but the Busabase
    // *deployment* serving it is whatever it is. A older deployment still
    // emitting `nodepod`/`sandock`/`local-node` must classify as the engine
    // those became, not as "unknown" — otherwise an app that branches (a demo
    // printing where it runs, an embed check) loses the answer on every
    // deployment that has not caught up.
    expect(asKnownBusabaseAirAppRuntime("nodepod")).toBe("browser");
    expect(asKnownBusabaseAirAppRuntime("sandock")).toBe("remote");
    expect(asKnownBusabaseAirAppRuntime("local-node")).toBe("local");
    // Hosting never depended on any of this, and still does not.
    expect(isBusabaseAirAppHosted("local-node")).toBe(true);
  });

  it("keeps the alias table from shadowing a current name", () => {
    // An alias whose key is also a live runtime would silently rewrite a value
    // Busabase is emitting today — the lookup runs before the membership test.
    for (const [from, to] of Object.entries(BUSABASE_AIRAPP_RUNTIME_ALIASES)) {
      expect(BUSABASE_AIRAPP_RUNTIMES).not.toContain(from);
      expect(BUSABASE_AIRAPP_RUNTIMES).toContain(to);
    }
  });
});
