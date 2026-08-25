import type { AirAppRunnerKind } from "busabase-contract/domains/airapp/contract";
import { resolveAvailableAirAppEngines } from "busabase-core/domains/airapp/logic/engine-availability";
import { getLocalUserName } from "~/lib/local-user";
import { DashboardClient } from "./client";

interface DashboardPageOptions {
  chromeless?: boolean;
  readOnlyChangeRequestPreview?: boolean;
}

export const renderDashboardPage = async (
  initialPath = "/home",
  options: DashboardPageOptions = {},
) => {
  // Resolved here because only the server can see whether a Sandock is
  // configured, and the browser must not guess: a picker that offers an engine
  // this deployment does not have is a failure the user discovers by clicking
  // Run. `allowHostProcesses` is true because this build's host *is* the user's
  // own machine — the trust model already says so.
  const availableAirAppEngines: AirAppRunnerKind[] = resolveAvailableAirAppEngines({
    allowHostProcesses: true,
  });
  return (
    <DashboardClient
      availableAirAppEngines={availableAirAppEngines}
      initialPath={initialPath}
      localUserName={getLocalUserName()}
      chromeless={options.chromeless}
      readOnlyChangeRequestPreview={options.readOnlyChangeRequestPreview}
    />
  );
};
