"use client";

import { createContext, useCallback, useContext, useMemo } from "react";
import { buildAssetDownloadUrl, rewriteAssetContentUrls } from "../utils/asset-content-url";

/**
 * Where this surface reads an asset's bytes. `download` asks for the
 * attachment response (`?download=1`) instead of the preview redirect.
 */
export type AssetContentUrlResolver = (
  assetId: string,
  options?: { download?: boolean; fileName?: string | null },
) => string;

const AssetContentUrlContext = createContext<AssetContentUrlResolver | null>(null);

/**
 * Lets a host send asset reads somewhere other than `/api/assets/:id/raw`.
 *
 * Nothing provides it inside the workbench, where the session-backed raw route
 * is right. An Embed Link page does: its visitor has no session, so it points
 * Doc images, folder readmes and download buttons at the link-authorized
 * `/embed/:publicId/assets/:assetId/raw`.
 */
export const AssetContentUrlProvider = AssetContentUrlContext.Provider;

/** Null in the workbench; an Embed host supplies its capability-backed route. */
export const useAssetContentUrlResolver = (): AssetContentUrlResolver | null =>
  useContext(AssetContentUrlContext);

/** A body with its asset references pointed at this surface's asset route. */
export const useResolvedAssetBody = (body: string): string => {
  const resolve = useContext(AssetContentUrlContext);
  return useMemo(
    () => (resolve ? rewriteAssetContentUrls(body, (assetId) => resolve(assetId)) : body),
    [body, resolve],
  );
};

/** Builds the download URL for an asset on this surface. */
export const useAssetDownloadUrlBuilder = (): ((
  assetId: string,
  fileName?: string | null,
) => string) => {
  const resolve = useContext(AssetContentUrlContext);
  return useCallback(
    (assetId, fileName) =>
      resolve
        ? resolve(assetId, { download: true, fileName })
        : buildAssetDownloadUrl(assetId, fileName),
    [resolve],
  );
};
