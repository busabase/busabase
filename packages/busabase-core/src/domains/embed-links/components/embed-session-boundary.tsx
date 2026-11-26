"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useCallback, useState } from "react";
import {
  AssetContentUrlProvider,
  type AssetContentUrlResolver,
} from "../../assets/hooks/asset-content-url-context";
import { useEmbedLifecycle } from "../hooks/use-embed-lifecycle";
import { getEmbedUiCopy } from "../utils/embed-ui-copy";

interface Props {
  publicId: string;
  secret: string;
  expiresAt: string;
  locale?: string;
  children: ReactNode;
}

/** Owns this link's lifetime, cache and resource authority for every content surface. */
export function EmbedSessionBoundary(props: Props) {
  return <EmbedSession key={`${props.publicId}:${props.secret}`} {...props} />;
}

function EmbedSession(props: Props) {
  const [queryClient] = useState(() => new QueryClient());
  const resolveAssetUrl = useCallback<AssetContentUrlResolver>(
    (assetId, options) => {
      const query = new URLSearchParams({ token: props.secret });
      if (options?.download) {
        query.set("download", "1");
        if (options.fileName) query.set("filename", options.fileName);
      }
      return `/embed/${encodeURIComponent(props.publicId)}/assets/${encodeURIComponent(assetId)}/raw?${query.toString()}`;
    },
    [props.publicId, props.secret],
  );

  const lifecycle = useEmbedLifecycle({ ...props, queryClient });
  const copy = getEmbedUiCopy(props.locale);
  if (lifecycle.terminal) {
    return (
      <main
        className="grid min-h-dvh place-items-center bg-background p-4 text-center text-foreground"
        data-testid={`embed-${lifecycle.state}`}
        role="status"
      >
        {lifecycle.state === "expired" ? copy.expired : copy.unavailable}
      </main>
    );
  }
  return (
    <QueryClientProvider client={queryClient}>
      {lifecycle.state === "disconnected" && (
        <div
          className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-3 border-border border-b bg-background p-3 text-sm"
          role="status"
        >
          <span>{copy.connectionLost}</span>
          <button className="underline" onClick={lifecycle.retry} type="button">
            {copy.retry}
          </button>
        </div>
      )}
      <AssetContentUrlProvider value={resolveAssetUrl}>{props.children}</AssetContentUrlProvider>
    </QueryClientProvider>
  );
}
