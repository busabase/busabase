import type { AirAppRunnerKind } from "busabase-contract/domains/airapp/contract";
import { resolveAvailableAirAppEngines } from "busabase-core/domains/airapp/logic/engine-availability";

/**
 * Which engines this build offers — derived, not declared here.
 *
 * This used to hardcode the answer, and the hardcoding is what let it drift:
 * it said `true`, then `false`, and the `runLocal` handler never saw either,
 * because a boolean in a page component is not something a request handler in
 * another package can read. Both now resolve it from `APP_ENV`, so the picker
 * and the handler cannot disagree.
 *
 * A self-hosted server declares `SELF-HOSTED` for itself at boot
 * (`instrumentation.node.ts`), so the host engine is offered with no
 * configuration — running your own AirApp on your own machine is what a
 * self-hosted install is for.
 */
export const resolveBusabaseAirAppEngines = (
  env: NodeJS.ProcessEnv = process.env,
): AirAppRunnerKind[] => resolveAvailableAirAppEngines({ env });
