import { ORPCError } from "@orpc/client";
import { describe, expect, it } from "vitest";
import {
  AIRAPP_ENGINE_PLAN_REQUIRED,
  preferredEngineFallbackLogLine,
  readAirAppEnginePlanRefusal,
  resolveAirAppEngineOffer,
  resolveEngineWithPlan,
  resolvePreferredEngineFallback,
} from "./engine-plan-gate";

/** Busabase Cloud with Sandock configured — what busabase.com runs. */
const CLOUD = ["browser", "remote"] as const;
/** What a Free space's plan leaves out on Cloud. */
const FREE_LOCK = ["remote"] as const;

describe("resolveAirAppEngineOffer", () => {
  it("leaves a Free space on Cloud with the browser engine, and remote visibly locked", () => {
    expect(resolveAirAppEngineOffer(CLOUD, FREE_LOCK)).toEqual({
      available: ["browser"],
      locked: ["remote"],
    });
  });

  it("gives a space whose plan includes hosted engines everything the deployment has", () => {
    // Plus, Pro and Enterprise: the host reports no lock.
    expect(resolveAirAppEngineOffer(CLOUD, [])).toEqual({
      available: ["browser", "remote"],
      locked: [],
    });
    expect(resolveAirAppEngineOffer(CLOUD)).toEqual({
      available: ["browser", "remote"],
      locked: [],
    });
  });

  it("never sells an engine the deployment does not have, whatever the plan", () => {
    // No Sandock configured: there is no remote to run on, so it must not be
    // offered as an upgrade either — upgrading would not make it work.
    expect(resolveAirAppEngineOffer(["browser"], FREE_LOCK)).toEqual({
      available: ["browser"],
      locked: [],
    });
    expect(resolveAirAppEngineOffer(["browser"], [])).toEqual({
      available: ["browser"],
      locked: [],
    });
  });

  it("leaves a host without a plan gate exactly as configured", () => {
    // Self-hosted / Desktop / open source pass no lock at all.
    expect(resolveAirAppEngineOffer(["browser", "local", "remote"])).toEqual({
      available: ["browser", "local", "remote"],
      locked: [],
    });
  });
});

describe("resolveEngineWithPlan", () => {
  const free = resolveAirAppEngineOffer(CLOUD, FREE_LOCK);
  const plus = resolveAirAppEngineOffer(CLOUD, []);

  it("quietly runs a browser-capable app in the browser when its saved engine is a locked remote", () => {
    // The node's `settings.airappEngine` still says `remote` from when the
    // space was on Plus. A Node app runs fine in the tab, so that is where it
    // goes — no upgrade prompt for something that works.
    expect(resolveEngineWithPlan("node", "remote", free)).toEqual({
      kind: "run",
      engine: "browser",
    });
  });

  it("reports a Python app on a Free space as locked, not as unrunnable", () => {
    expect(resolveEngineWithPlan("python", "browser", free)).toEqual({
      kind: "locked",
      engine: "remote",
    });
    expect(resolveEngineWithPlan("python", "remote", free)).toEqual({
      kind: "locked",
      engine: "remote",
    });
  });

  it("reports an app that requires remote as locked even though it could run in the browser", () => {
    // `requiredEngine` never falls back, so the browser being eligible does not help.
    expect(resolveEngineWithPlan("node", "browser", free, "remote")).toEqual({
      kind: "locked",
      engine: "remote",
    });
  });

  it("runs the same apps on remote once the plan includes it", () => {
    expect(resolveEngineWithPlan("python", "browser", plus)).toEqual({
      kind: "run",
      engine: "remote",
    });
    expect(resolveEngineWithPlan("node", "browser", plus, "remote")).toEqual({
      kind: "run",
      engine: "remote",
    });
    expect(resolveEngineWithPlan("node", "remote", plus)).toEqual({
      kind: "run",
      engine: "remote",
    });
  });

  it("keeps 'this deployment can't run this app' for a deployment with nothing to sell", () => {
    const noSandock = resolveAirAppEngineOffer(["browser"], FREE_LOCK);
    expect(resolveEngineWithPlan("python", "browser", noSandock)).toEqual({ kind: "unavailable" });
    expect(resolveEngineWithPlan("node", "browser", noSandock, "remote")).toEqual({
      kind: "unavailable",
    });
  });

  it("does not turn a missing host engine into an upgrade", () => {
    // `local` is never part of the lock; an app requiring it stays unavailable.
    expect(resolveEngineWithPlan("node", "browser", free, "local")).toEqual({
      kind: "unavailable",
    });
  });
});

describe("readAirAppEnginePlanRefusal", () => {
  it("reads the server's refusal off the error the oRPC client throws", () => {
    const error = new ORPCError("FORBIDDEN", {
      message: "not included",
      data: { reason: AIRAPP_ENGINE_PLAN_REQUIRED, engine: "remote", planLabel: "Plus" },
    });
    expect(readAirAppEnginePlanRefusal(error)).toEqual({ engine: "remote", planLabel: "Plus" });
  });

  it.each([
    ["a plain error", new Error("boom")],
    ["the deployment refusal", new ORPCError("FORBIDDEN", { message: "not offered" })],
    [
      "another reason",
      new ORPCError("FORBIDDEN", {
        data: { reason: "OTHER", engine: "remote", planLabel: "Plus" },
      }),
    ],
    [
      "an unknown engine",
      new ORPCError("FORBIDDEN", {
        data: { reason: AIRAPP_ENGINE_PLAN_REQUIRED, engine: "mainframe", planLabel: "Plus" },
      }),
    ],
    [
      "a missing plan label",
      new ORPCError("FORBIDDEN", {
        data: { reason: AIRAPP_ENGINE_PLAN_REQUIRED, engine: "remote" },
      }),
    ],
    ["nothing", undefined],
  ])("ignores %s", (_label, error) => {
    expect(readAirAppEnginePlanRefusal(error)).toBeNull();
  });
});

describe("a required site on a plan that leaves it out", () => {
  it("is the upgrade state, not an unavailable engine", () => {
    expect(
      resolveEngineWithPlan(
        "node",
        "browser",
        { available: ["browser"], locked: ["remote", "site"] },
        "site",
      ),
    ).toEqual({ kind: "locked", engine: "site" });
  });

  it("runs on a plan that includes it", () => {
    expect(
      resolveEngineWithPlan(
        "node",
        "browser",
        { available: ["browser", "site"], locked: [] },
        "site",
      ),
    ).toEqual({ kind: "run", engine: "site" });
  });
});

describe("a preferred engine the run set aside", () => {
  const must = <T>(value: T | null): T => {
    if (value === null) throw new Error("expected a fallback");
    return value;
  };
  /** A Free space on Busabase Cloud with the site host configured. */
  const FREE = { available: ["browser"], locked: ["remote", "site"] } as const;
  /** The same deployment on Plus. */
  const PLUS = { available: ["browser", "remote", "site"], locked: [] } as const;
  const offer = (o: typeof FREE | typeof PLUS) => ({
    available: [...o.available],
    locked: [...o.locked],
  });

  it("names the plan when a Free space runs a Website-preferring app in the browser", () => {
    const fallback = resolvePreferredEngineFallback({
      preferred: "site",
      engine: "browser",
      offer: offer(FREE),
    });
    expect(fallback).toEqual({ preferred: "site", engine: "browser", reason: "plan" });
    expect(preferredEngineFallbackLogLine(must(fallback), "node")).toBe(
      '[busabase] airapp.json prefers engine "site", but this space\'s plan does not include it; running on engine "browser" instead\n',
    );
  });

  it("says nothing on Plus, where the app runs on the Website it asked for", () => {
    expect(
      resolvePreferredEngineFallback({ preferred: "site", engine: "site", offer: offer(PLUS) }),
    ).toBeNull();
  });

  it("says nothing when the app prefers nothing", () => {
    expect(
      resolvePreferredEngineFallback({
        preferred: undefined,
        engine: "browser",
        offer: offer(FREE),
      }),
    ).toBeNull();
  });

  it("tells a missing engine apart from a locked one", () => {
    const fallback = resolvePreferredEngineFallback({
      preferred: "remote",
      engine: "browser",
      offer: { available: ["browser"], locked: [] },
    });
    expect(fallback?.reason).toBe("deployment");
    expect(preferredEngineFallbackLogLine(must(fallback), "node")).toContain(
      "this deployment does not offer it",
    );
  });

  it("names the runtime when the preferred engine is offered but cannot run the app", () => {
    const fallback = resolvePreferredEngineFallback({
      preferred: "browser",
      engine: "remote",
      offer: { available: ["browser", "remote"], locked: [] },
    });
    expect(fallback?.reason).toBe("runtime");
    expect(preferredEngineFallbackLogLine(must(fallback), "python")).toContain(
      'it cannot run a "python" app',
    );
  });
});
