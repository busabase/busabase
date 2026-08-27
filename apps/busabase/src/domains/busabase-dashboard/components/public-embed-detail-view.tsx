"use client";

import { EMBED_RUNTIME_CAPABILITY_HEADER } from "busabase-core/domains/embed-links/capability";
import type { PublicEmbedDetailHostProps } from "busabase-core/domains/embed-links/public-detail-view";
import dynamic from "next/dynamic";
import { useMemo } from "react";

const CorePublicEmbedDetailView = dynamic(
  () =>
    import("busabase-core/domains/embed-links/public-detail-view").then(
      (m) => m.PublicEmbedDetailView,
    ),
  { ssr: false },
);

interface Props extends PublicEmbedDetailHostProps {
  capability: string;
  locale: string;
}

export function PublicEmbedDetailView({ capability, embed, locale, spaceId }: Props) {
  const apiClientOptions = useMemo(
    () => ({ headers: { [EMBED_RUNTIME_CAPABILITY_HEADER]: capability } }),
    [capability],
  );
  return (
    <CorePublicEmbedDetailView
      apiBasePath="/api/rpc"
      apiClientOptions={apiClientOptions}
      embed={embed}
      locale={locale}
      provideQueryClient
      spaceId={spaceId}
    />
  );
}
