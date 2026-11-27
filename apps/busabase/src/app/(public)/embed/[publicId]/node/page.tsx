import {
  embedCapabilityCookieName,
  loadEmbedDetail,
} from "busabase-core/domains/embed-links/detail-page";
import { buildEmbedMetadata } from "busabase-core/domains/embed-links/metadata";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { EmbedStatus } from "~/domains/busabase-dashboard/components/embed-status";
import { PublicEmbedNodeView } from "~/domains/busabase-dashboard/components/public-embed-node-view";
import { getBusabaseAppLL, getBusabaseLocaleFromAcceptLanguage } from "~/lib/i18n";

export const dynamic = "force-dynamic";

/**
 * An Embed Link to an ordinary node (Base, Doc, File, Drive, Skill, Folder),
 * rendered with the workbench's own Node Detail view. `/embed/:publicId` hands
 * off here; AirApps, Change Requests and records have their own pages.
 */
interface PageProps {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<{ token?: string }>;
}

// One link resolution per request, shared by the title and the page.
const loadNodeEmbed = cache(async (publicId: string, token: string | undefined) => {
  const cookieStore = await cookies();
  return loadEmbedDetail({
    publicId,
    token,
    cookieValue: cookieStore.get(embedCapabilityCookieName(publicId))?.value,
    expect: "node",
  });
});

/**
 * Content-only, like the embed itself: the node's own name with no product
 * suffix, no product icon in the host's tab or WebView, never indexed.
 */
export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const [{ publicId }, { token }] = await Promise.all([params, searchParams]);
  const loaded = await loadNodeEmbed(publicId, token);
  return buildEmbedMetadata(loaded && "embed" in loaded ? loaded.embed.node.name : null);
}

export default async function PublicNodeEmbedPage({ params, searchParams }: PageProps) {
  const [headerStore, { publicId }, { token }] = await Promise.all([
    headers(),
    params,
    searchParams,
  ]);
  const loaded = await loadNodeEmbed(publicId, token);
  const locale = getBusabaseLocaleFromAcceptLanguage(headerStore.get("accept-language"));
  if (!loaded) notFound();
  if ("expired" in loaded) {
    return <EmbedStatus label={getBusabaseAppLL(locale).embedRuntime.expired()} />;
  }

  return (
    <PublicEmbedNodeView
      expiresAt={loaded.embed.expiresAt}
      locale={locale}
      node={loaded.embed.node}
      publicId={publicId}
      secret={loaded.secret}
      spaceId={loaded.embed.spaceId}
    />
  );
}
