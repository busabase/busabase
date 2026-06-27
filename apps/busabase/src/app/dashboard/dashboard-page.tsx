import { DashboardClient } from "./client";

export const renderDashboardPage = async (initialPath = "/inbox") => {
  return <DashboardClient initialPath={initialPath} />;
};
