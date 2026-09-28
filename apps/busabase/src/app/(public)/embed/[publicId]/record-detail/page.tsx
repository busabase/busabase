import { encodeEmbedCapability } from "busabase-core/domains/embed-links/capability";
import {
  embedCapabilityCookieName,
  loadEmbedDetail,
} from "busabase-core/domains/embed-links/detail-page";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { EmbedStatus } from "~/domains/busabase-dashboard/components/embed-status";
import { PublicEmbedDetailView } from "~/domains/busabase-dashboard/components/public-embed-detail-view";
import { getBusabaseAppLL, getBusabaseLocaleFromAcceptLanguage } from "~/lib/i18n";

export const dynamic = "force-dynamic";

export default async function PublicRecordEmbedPage({
  params,
  searchParams,
}: {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<{ token?: string }>;
}) {
  const [cookieStore, headerStore, { publicId }, { token }] = await Promise.all([
    cookies(),
    headers(),
    params,
    searchParams,
  ]);
  const loaded = await loadEmbedDetail({
    publicId,
    token,
    cookieValue: cookieStore.get(embedCapabilityCookieName(publicId))?.value,
    expect: "record-detail",
  });
  const locale = getBusabaseLocaleFromAcceptLanguage(headerStore.get("accept-language"));
  if (!loaded) notFound();
  if ("expired" in loaded) {
    return <EmbedStatus label={getBusabaseAppLL(locale).embedRuntime.expired()} />;
  }

  return (
    <PublicEmbedDetailView
      capability={encodeEmbedCapability(publicId, loaded.secret)}
      embed={loaded.embed}
      locale={locale}
      spaceId={loaded.embed.spaceId}
    />
  );
}
