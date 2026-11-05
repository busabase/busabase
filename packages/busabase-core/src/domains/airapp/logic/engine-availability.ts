import "server-only";

import { ORPCError } from "@orpc/server";
import type { AirAppRunnerKind } from "busabase-contract/domains/airapp/contract";
import { resolveContextAirAppEngineLock } from "../../../context";
import {
  AIRAPP_ENGINE_PLAN_REQUIRED,
  type AirAppEnginePlanRefusalData,
} from "../utils/engine-plan-gate";
import { resolveSandockConfig } from "./sandock-runtime";

/**
 * Which engines a deployment can actually offer.
 *
 * Keyed on **capability, not edition**. "Is this the cloud build?" is the wrong
 * question in both directions: a self-hoster who would rather not run app
 * processes on their own box can configure a Sandock and should get that engine,
 * and a cloud deployment without one should not be offered it. So availability
 * is derived from what is configured and what the host permits.
 *
 * Resolved server-side and handed to the client, because the browser cannot see
 * an API key and must not guess. Guessing is what produced the failure this
 * whole area keeps circling back to: the picker offering something that cannot
 * possibly work, and the user finding out only after clicking Run.
 *
 * Capability is the whole answer only where nobody sells engines. A hosted
 * deployment can also put an engine behind a space's plan; that is a separate,
 * host-owned layer applied on top of this list (`utils/engine-plan-gate.ts`,
 * `BusabaseContext.resolveAirAppEngineLock`), and it can only narrow it.
 */
export interface AirAppEngineAvailabilityOptions {
  /**
   * Whether this host is willing to spawn app processes on itself.
   *
   * Omit it. Derived from {@link resolveHostProcessPolicy} when absent, which
   * is what keeps the engine picker and the `runLocal` handler answering the
   * same question — they used to be two hardcoded opinions in two page
   * components, and the handler had no opinion at all.
   *
   * An explicit value is an override for a deployment that knows better than
   * its environment name, and for tests.
   */
  allowHostProcesses?: boolean;
  env?: NodeJS.ProcessEnv;
  /**
   * Whether this host's site provider has what it needs. Omitted means the host
   * has no provider (open source, Desktop): configuring something cannot give it
   * one, so `site` is hidden rather than shown as disabled.
   */
  siteConfigured?: boolean;
}

/**
 * What a picker needs to know about this deployment.
 *
 * `notConfigured` is an engine an operator could turn on by configuring the
 * deployment. It is shown disabled with that reason, so a person can tell "ask
 * an administrator" from "does not exist". An engine this deployment can never
 * offer (`local` on Cloud) is in neither list and stays hidden.
 */
export interface AirAppEngineAvailability {
  available: AirAppRunnerKind[];
  notConfigured: AirAppRunnerKind[];
}

/**
 * `APP_ENV` values meaning the host is somebody's own machine.
 *
 * The rule this answers is not "is this the cloud build" — the module doc above
 * says why that question is wrong in both directions — but "is this host shared
 * with other people". `SELF-HOSTED` is a user running the server for themselves,
 * `DESKTOP` is that same server inside the desktop app, and `LOCAL` is a
 * developer's laptop. In all three the host IS the operator, and running their
 * own reviewed app on it is the whole point of the engine.
 *
 * Everything else — `PRODUCTION`, `STAGING`, `INTEGRATION`, an unrecognised
 * value, or nothing at all — is treated as shared. Absence has to land on the
 * restrictive side: a deployment that never configured this is exactly the one
 * that must not be handed the permissive answer.
 */
const OWN_MACHINE_APP_ENVS = new Set(["SELF-HOSTED", "DESKTOP", "LOCAL"]);

/**
 * May this host spawn AirApp processes on itself?
 *
 * Read from `APP_ENV` rather than from a build flag so that one value answers
 * it everywhere — the page that renders the picker and the handler that honours
 * it are in different packages and cannot share a hardcoded boolean.
 *
 * Case-insensitive on purpose: `APP_ENV` is already read as both `"production"`
 * and `"PRODUCTION"` elsewhere in the tree, and a security decision must not
 * turn on which convention a deployment happened to pick.
 */
export const resolveHostProcessPolicy = (env: NodeJS.ProcessEnv = process.env): boolean =>
  OWN_MACHINE_APP_ENVS.has((env.APP_ENV ?? "").trim().toUpperCase());

export function resolveAirAppEngineAvailability(
  options: AirAppEngineAvailabilityOptions = {},
): AirAppEngineAvailability {
  // `browser` is unconditional: it runs in the viewer's own tab, so there is
  // no configuration that could make it unavailable.
  const env = options.env ?? process.env;
  const available: AirAppRunnerKind[] = ["browser"];
  const notConfigured: AirAppRunnerKind[] = [];
  if (options.allowHostProcesses ?? resolveHostProcessPolicy(env)) available.push("local");
  (resolveSandockConfig(env) ? available : notConfigured).push("remote");
  if (options.siteConfigured !== undefined) {
    (options.siteConfigured ? available : notConfigured).push("site");
  }
  return { available, notConfigured };
}

export function resolveAvailableAirAppEngines(
  options: AirAppEngineAvailabilityOptions = {},
): AirAppRunnerKind[] {
  return resolveAirAppEngineAvailability(options).available;
}

/**
 * Refuse an engine the deployment has but this space's plan does not include.
 *
 * The client already shows such an engine as locked and never asks for it, but
 * that is a UI courtesy: a modified client, a stale tab, or a plain API call
 * could still ask, and the engine in question is something somebody pays for.
 * So the server asks the host again, here, on every call.
 *
 * Unlike "not offered here", this one IS a denial with a way out, so it says
 * which plan unlocks the engine, and carries a machine-readable reason so the
 * dashboard can turn it into the same upgrade state the picker shows. No host
 * hook (open source, Desktop, self-hosted) means no plan gate at all.
 */
export const assertEngineIncludedInPlan = async (engine: AirAppRunnerKind): Promise<void> => {
  const lock = await resolveContextAirAppEngineLock();
  if (!lock?.lockedEngines.includes(engine)) return;
  const data: AirAppEnginePlanRefusalData = {
    reason: AIRAPP_ENGINE_PLAN_REQUIRED,
    engine,
    planLabel: lock.planLabel,
  };
  throw new ORPCError("FORBIDDEN", {
    message: `AirApp engine "${engine}" is not included in this space's plan. Upgrade to ${lock.planLabel} to run apps on it.`,
    data,
  });
};
