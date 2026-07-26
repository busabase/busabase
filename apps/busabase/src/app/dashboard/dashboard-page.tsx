import { getLocalUserName } from "~/lib/local-user";
import { DashboardClient } from "./client";

export const renderDashboardPage = async (initialPath = "/home") => {
  return <DashboardClient initialPath={initialPath} localUserName={getLocalUserName()} />;
};
