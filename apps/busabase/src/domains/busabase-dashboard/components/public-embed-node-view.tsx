"use client";

import {
  EMBED_RUNTIME_CAPABILITY_HEADER,
  encodeEmbedCapability,
} from "busabase-core/domains/embed-links/capability";
import type { PublicEmbedNodeHostProps } from "busabase-core/domains/embed-links/public-node-view";
import dynamic from "next/dynamic";
import { useMemo } from "react";

const CorePublicEmbedNodeView = dynamic(
  () =>
    import("busabase-core/domains/embed-links/public-node-view").then((m) => m.PublicEmbedNodeView),
  { ssr: false },
);

interface Props extends PublicEmbedNodeHostProps {
  locale: string;
  secret: string;
}

export function PublicEmbedNodeView({ expiresAt, locale, node, publicId, secret, spaceId }: Props) {
  const apiClientOptions = useMemo(
    () => ({
      headers: { [EMBED_RUNTIME_CAPABILITY_HEADER]: encodeEmbedCapability(publicId, secret) },
    }),
    [publicId, secret],
  );
  return (
    <CorePublicEmbedNodeView
      apiBasePath="/api/rpc"
      apiClientOptions={apiClientOptions}
      expiresAt={expiresAt}
      locale={locale}
      node={node}
      publicId={publicId}
      secret={secret}
      spaceId={spaceId}
    />
  );
}
