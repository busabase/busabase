import { headers } from "next/headers";
import Link from "next/link";
import { buildDashboardUrl } from "~/lib/dashboard-routes";
import { getBusabaseAppLL, getBusabaseLocaleFromRequestHeaders } from "~/lib/i18n";

export default async function NotFound() {
  const LL = getBusabaseAppLL(getBusabaseLocaleFromRequestHeaders(await headers()));

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-semibold text-2xl text-foreground">{LL.shell.pageNotFoundTitle()}</h1>
      <p className="text-muted-foreground">{LL.shell.pageNotFoundBody()}</p>
      <Link
        className="text-primary underline-offset-4 hover:underline"
        href={buildDashboardUrl("/home")}
      >
        {LL.shell.pageNotFoundHome()}
      </Link>
    </main>
  );
}
