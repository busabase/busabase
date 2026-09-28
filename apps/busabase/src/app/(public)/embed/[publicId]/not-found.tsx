import { headers } from "next/headers";
import { EmbedStatus } from "~/domains/busabase-dashboard/components/embed-status";
import { getBusabaseAppLL, getBusabaseLocaleFromAcceptLanguage } from "~/lib/i18n";

/**
 * Every embed page that cannot serve its link lands here, so a revoked or
 * unknown link answers 404 with the same one-line page — never the site's own
 * 404 with its navigation.
 */
export default async function EmbedNotFound() {
  const headerStore = await headers();
  const LL = getBusabaseAppLL(
    getBusabaseLocaleFromAcceptLanguage(headerStore.get("accept-language")),
  );
  return <EmbedStatus label={LL.embedRuntime.unavailable()} />;
}
