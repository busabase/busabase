"use client";

import { getBusabaseAppLL } from "~/lib/i18n";
import { useSPA } from "./spa-context";

export function DashboardNotFound() {
  const { locale } = useSPA();
  const LL = getBusabaseAppLL(locale);

  return (
    <div className="grid min-h-screen place-items-center bg-[color:var(--background)] p-8 text-center text-[color:var(--foreground)]">
      <div>
        <h1 className="font-semibold text-2xl">{LL.shell.routeNotFoundTitle()}</h1>
        <p className="mt-2 text-[color:var(--muted)]">{LL.shell.routeNotFoundBody()}</p>
      </div>
    </div>
  );
}
