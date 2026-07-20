import { redirect } from "next/navigation";
import { buildDashboardUrl } from "~/lib/dashboard-routes";

export default function HomePage() {
  redirect(buildDashboardUrl("/inbox"));
}
