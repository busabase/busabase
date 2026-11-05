/**
 * A host's plan gate on AirApp engines — the second question after capability.
 *
 * `logic/engine-availability.ts` answers "which engines can this deployment
 * run at all?", and answers it from configuration, never from edition. That
 * stays true. What it cannot answer is "may THIS space use one?": an engine
 * that runs on infrastructure the operator pays for (a provisioned Sandock
 * machine today) is something a hosted deployment sells, and on Busabase Cloud
 * a Free space would otherwise be handed a paid machine for nothing.
 *
 * So the gate is a separate, host-owned layer on top of capability:
 *
 *  - Core never names a plan and never decides who is entitled. The host says
 *    which engines this space's plan leaves out and what the plan that unlocks
 *    them is called. Open source, Desktop and self-hosted hosts supply nothing,
 *    so their availability stays exactly what is configured.
 *  - A lock only ever narrows capability. A deployment with no Sandock has no
 *    `remote` to sell, so a locked `remote` there is dropped rather than shown
 *    as an upgrade — upgrading would not make it work.
 *  - A locked engine is SHOWN, not hidden. Silently removing it from the
 *    picker leaves a person unable to tell "this app can't run here" apart
 *    from "this app can run here if the space upgrades".
 *
 * PURITY: isomorphic. The picker and the Run panel resolve it in the browser,
 * the run handler resolves it on the server, and both must agree.
 */

import type { AirAppRunnerKind } from "busabase-contract/domains/airapp/contract";
import {
  type AirAppRuntimeKind,
  ENGINE_EXECUTION_MODEL,
  resolveEngine,
} from "./airapp-runtime-descriptor";

/** What a host's server-side gate reports for the current space. */
export interface AirAppEnginePlanLock {
  /** Engines the deployment runs that this space's plan does not include. */
  lockedEngines: readonly AirAppRunnerKind[];
  /** The host's own name for the plan that unlocks them (Cloud: "Plus"). */
  planLabel: string;
}

/**
 * What a host hands the dashboard: the lock plus the way out of it.
 *
 * A host that sells engines passes this even when nothing is locked (empty
 * `lockedEngines`), so a run the server refuses anyway — a plan that lapsed
 * after the page loaded — can still land on the upgrade state instead of a raw
 * error.
 */
export interface AirAppEnginePlanGate extends AirAppEnginePlanLock {
  /** Opens the host's upgrade surface. Without it the locked state explains but offers no action. */
  onUpgrade?: () => void;
}

/** What one space can do with what one deployment has. */
export interface AirAppEngineOffer {
  /** Engines this space can run right now. */
  available: AirAppRunnerKind[];
  /** Engines the deployment has but this space's plan leaves out. */
  locked: AirAppRunnerKind[];
}

/** Apply a plan lock to a deployment's capability list. A lock never adds an engine. */
export const resolveAirAppEngineOffer = (
  deploymentEngines: readonly AirAppRunnerKind[],
  lockedEngines: readonly AirAppRunnerKind[] = [],
): AirAppEngineOffer => ({
  available: deploymentEngines.filter((engine) => !lockedEngines.includes(engine)),
  locked: deploymentEngines.filter((engine) => lockedEngines.includes(engine)),
});

/** A run that cannot start because the engine it needs is outside the space's plan. */
export interface AirAppEngineLockState {
  engine: AirAppRunnerKind;
  planLabel: string;
}

export type AirAppEngineResolution =
  | { kind: "run"; engine: AirAppRunnerKind }
  /** The app would run on `engine`, and only the space's plan stands in the way. */
  | { kind: "locked"; engine: AirAppRunnerKind }
  /** Nothing this deployment has can run it, whatever the plan. */
  | { kind: "unavailable" };

/**
 * `resolveEngine`, with the plan's locked engines told apart from missing ones.
 *
 * The order matters. An app that CAN run on an unlocked engine runs there —
 * a Node app whose saved choice is `remote` falls back to the browser, which is
 * the quiet outcome the person barely notices. Only when nothing unlocked can
 * run it is the locked list consulted, and then the answer is "upgrade", not
 * "this deployment can't run this app": a Python app, or one whose
 * `airapp.json` requires `remote`, would run the moment the space upgrades.
 */
export const resolveEngineWithPlan = (
  runtime: AirAppRuntimeKind,
  wanted: AirAppRunnerKind,
  offer: AirAppEngineOffer,
  required?: AirAppRunnerKind,
): AirAppEngineResolution => {
  const engine = resolveEngine(runtime, wanted, offer.available, required);
  if (engine) return { kind: "run", engine };
  if (offer.locked.length > 0) {
    const unlocked = resolveEngine(
      runtime,
      wanted,
      [...offer.available, ...offer.locked],
      required,
    );
    if (unlocked && offer.locked.includes(unlocked)) return { kind: "locked", engine: unlocked };
  }
  return { kind: "unavailable" };
};

/** `data.reason` on the server's refusal, so a client can tell it apart from any other failure. */
export const AIRAPP_ENGINE_PLAN_REQUIRED = "AIRAPP_ENGINE_PLAN_REQUIRED" as const;

export interface AirAppEnginePlanRefusalData {
  reason: typeof AIRAPP_ENGINE_PLAN_REQUIRED;
  engine: AirAppRunnerKind;
  planLabel: string;
}

/**
 * Read the server's plan refusal off a thrown error, if that is what it is.
 *
 * Needed for the case the client cannot see coming: its view of the plan said
 * the engine was included (the plan lapsed after the page loaded, or the page
 * is simply stale), the server checked again and said no. That has to reach
 * the person as the same upgrade state, not as a red line of server text.
 */
export const readAirAppEnginePlanRefusal = (error: unknown): AirAppEngineLockState | null => {
  if (!error || typeof error !== "object") return null;
  const data = (error as { data?: unknown }).data;
  if (!data || typeof data !== "object") return null;
  const candidate = data as Partial<Record<keyof AirAppEnginePlanRefusalData, unknown>>;
  if (candidate.reason !== AIRAPP_ENGINE_PLAN_REQUIRED) return null;
  if (
    typeof candidate.engine !== "string" ||
    !Object.hasOwn(ENGINE_EXECUTION_MODEL, candidate.engine)
  ) {
    return null;
  }
  if (typeof candidate.planLabel !== "string" || candidate.planLabel.length === 0) return null;
  return { engine: candidate.engine as AirAppRunnerKind, planLabel: candidate.planLabel };
};
