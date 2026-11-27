import { AirAppEmbedRuntime } from "busabase-core/domains/embed-links/airapp-runtime";
import { encodeEmbedCapability } from "busabase-core/domains/embed-links/capability";
import {
  embedCapabilityCookieName,
  loadAirAppEmbedRuntime,
} from "busabase-core/domains/embed-links/detail-page";
import { buildEmbedMetadata } from "busabase-core/domains/embed-links/metadata";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { EmbedStatus } from "~/domains/busabase-dashboard/components/embed-status";
import { getBusabaseAppLL, getBusabaseLocaleFromAcceptLanguage } from "~/lib/i18n";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<{ token?: string; view?: string }>;
}

const loadRuntime = cache(
  async (publicId: string, token: string | undefined, view: string | undefined) => {
    const cookieStore = await cookies();
    return loadAirAppEmbedRuntime({
      publicId,
      token,
      view,
      cookieValue: cookieStore.get(embedCapabilityCookieName(publicId))?.value,
    });
  },
);

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const [{ publicId }, { token, view }] = await Promise.all([params, searchParams]);
  const loaded = await loadRuntime(publicId, token, view);
  return buildEmbedMetadata(loaded && "runtime" in loaded ? loaded.runtime.nodeName : null);
}

export default async function AirAppEmbedPage({ params, searchParams }: PageProps) {
  const [headerStore, { publicId }, query] = await Promise.all([headers(), params, searchParams]);
  const LL = getBusabaseAppLL(
    getBusabaseLocaleFromAcceptLanguage(headerStore.get("accept-language")),
  );
  const loaded = await loadRuntime(publicId, query.token, query.view);
  if (!loaded) notFound();
  if ("expired" in loaded) return <EmbedStatus label={LL.embedRuntime.expired()} />;

  return (
    <AirAppEmbedRuntime
      capability={encodeEmbedCapability(publicId, loaded.secret)}
      expiresAt={loaded.runtime.expiresAt}
      files={loaded.runtime.files}
      labels={{
        loading: LL.embedRuntime.loading(),
        unavailable: LL.embedRuntime.unavailable(),
        expired: LL.embedRuntime.expired(),
      }}
      nodeId={loaded.runtime.nodeId}
      title={loaded.runtime.nodeName}
    />
  );
}
