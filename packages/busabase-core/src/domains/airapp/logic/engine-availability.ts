import "server-only";

import type { AirAppRunnerKind } from "busabase-contract/domains/airapp/contract";
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

export function resolveAvailableAirAppEngines(
  options: AirAppEngineAvailabilityOptions = {},
): AirAppRunnerKind[] {
  // `browser` is unconditional: it runs in the viewer's own tab, so there is
  // no configuration that could make it unavailable.
  const env = options.env ?? process.env;
  const engines: AirAppRunnerKind[] = ["browser"];
  if (options.allowHostProcesses ?? resolveHostProcessPolicy(env)) engines.push("local");
  if (resolveSandockConfig(env)) engines.push("remote");
  return engines;
}
