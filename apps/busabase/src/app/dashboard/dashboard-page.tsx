import { getLocalUserName } from "~/lib/local-user";
import { resolveBusabaseAirAppEngines } from "./airapp-engine-availability";
import { DashboardClient } from "./client";

interface DashboardPageOptions {
  chromeless?: boolean;
  readOnlyChangeRequestPreview?: boolean;
}

export const renderDashboardPage = async (
  initialPath = "/home",
  options: DashboardPageOptions = {},
) => {
  // Resolved server-side because only the server may inspect Sandock secrets.
  // OSS AirApp execution offers the browser engine plus remote only when
  // Sandock is configured. Python without Sandock therefore reaches the
  // RunPanel guidance instead of silently spawning a local host process.
  const availableAirAppEngines = resolveBusabaseAirAppEngines();
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
