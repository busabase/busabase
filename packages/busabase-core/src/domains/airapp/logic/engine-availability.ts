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
   * True for the open-source single-user build, where the host *is* the user's
   * own machine and the trust model already says so. False for shared
   * infrastructure, where running an arbitrary reviewed-but-untrusted app next
   * to the server is not a defensible thing to offer.
   */
  allowHostProcesses: boolean;
  env?: NodeJS.ProcessEnv;
}

export function resolveAvailableAirAppEngines(
  options: AirAppEngineAvailabilityOptions,
): AirAppRunnerKind[] {
  // `browser` is unconditional: it runs in the viewer's own tab, so there is
  // no configuration that could make it unavailable.
  const engines: AirAppRunnerKind[] = ["browser"];
  if (options.allowHostProcesses) engines.push("local");
  if (resolveSandockConfig(options.env ?? process.env)) engines.push("remote");
  return engines;
}
