import { encodeEmbedCapability } from "busabase-core/domains/embed-links/capability";
import {
  embedCapabilityCookieName,
  loadEmbedDetail,
} from "busabase-core/domains/embed-links/detail-page";
import { buildEmbedMetadata, recordEmbedTitle } from "busabase-core/domains/embed-links/metadata";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { EmbedStatus } from "~/domains/busabase-dashboard/components/embed-status";
import { PublicEmbedDetailView } from "~/domains/busabase-dashboard/components/public-embed-detail-view";
import { getBusabaseAppLL, getBusabaseLocaleFromAcceptLanguage } from "~/lib/i18n";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<{ token?: string }>;
}

const loadDetail = cache(async (publicId: string, token: string | undefined) => {
  const cookieStore = await cookies();
  return loadEmbedDetail({
    publicId,
    token,
    cookieValue: cookieStore.get(embedCapabilityCookieName(publicId))?.value,
    expect: "record-detail",
  });
});

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const [{ publicId }, { token }] = await Promise.all([params, searchParams]);
  const loaded = await loadDetail(publicId, token);
  return buildEmbedMetadata(
    loaded && "embed" in loaded ? recordEmbedTitle(loaded.embed.record) : null,
  );
}

export default async function PublicRecordEmbedPage({ params, searchParams }: PageProps) {
  const [headerStore, { publicId }, { token }] = await Promise.all([
    headers(),
    params,
    searchParams,
  ]);
  const loaded = await loadDetail(publicId, token);
  const locale = getBusabaseLocaleFromAcceptLanguage(headerStore.get("accept-language"));
  if (!loaded) notFound();
  if ("expired" in loaded) {
    return <EmbedStatus label={getBusabaseAppLL(locale).embedRuntime.expired()} />;
  }

  return (
    <PublicEmbedDetailView
      capability={encodeEmbedCapability(publicId, loaded.secret)}
      embed={loaded.embed}
      expiresAt={loaded.embed.expiresAt}
      publicId={publicId}
      secret={loaded.secret}
      locale={locale}
      spaceId={loaded.embed.spaceId}
    />
  );
}
