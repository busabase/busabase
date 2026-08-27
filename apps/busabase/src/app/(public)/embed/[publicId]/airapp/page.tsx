import { AirAppEmbedRuntime } from "busabase-core/domains/embed-links/airapp-runtime";
import { encodeEmbedCapability } from "busabase-core/domains/embed-links/capability";
import {
  embedCapabilityCookieName,
  loadAirAppEmbedRuntime,
} from "busabase-core/domains/embed-links/detail-page";
import { cookies, headers } from "next/headers";
import { getBusabaseAppLL, getBusabaseLocaleFromAcceptLanguage } from "~/lib/i18n";

export const dynamic = "force-dynamic";

const Unavailable = ({ label }: { label: string }) => (
  <main className="grid min-h-dvh place-items-center bg-background text-foreground">{label}</main>
);

export default async function AirAppEmbedPage({
  params,
  searchParams,
}: {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<{ token?: string; view?: string }>;
}) {
  const [cookieStore, headerStore, { publicId }, query] = await Promise.all([
    cookies(),
    headers(),
    params,
    searchParams,
  ]);
  const LL = getBusabaseAppLL(
    getBusabaseLocaleFromAcceptLanguage(headerStore.get("accept-language")),
  );
  const loaded = await loadAirAppEmbedRuntime({
    publicId,
    token: query.token,
    view: query.view,
    cookieValue: cookieStore.get(embedCapabilityCookieName(publicId))?.value,
  });
  if (!loaded) return <Unavailable label={LL.embedRuntime.unavailable()} />;

  return (
    <AirAppEmbedRuntime
      capability={encodeEmbedCapability(publicId, loaded.secret)}
      expiresAt={loaded.runtime.expiresAt}
      files={loaded.runtime.files}
      labels={{
        loading: LL.embedRuntime.loading(),
        unavailable: LL.embedRuntime.unavailable(),
      }}
      nodeId={loaded.runtime.nodeId}
      title={loaded.runtime.nodeName}
    />
  );
}
