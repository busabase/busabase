import "server-only";

import { ORPCError } from "@orpc/server";
import { runWithEmbedContext } from "../../context";
import { resolveAssetContent } from "../assets/logic/asset-content-logic";
import { createAssetDownloadResponse } from "../assets/logic/asset-download-response";
import { isValidEmbedPublicId, isValidEmbedSecret, readEmbedCapabilityCookie } from "./capability";
import { type EmbedRequestContext, resolveEmbedRequestContext } from "./logic";

/**
 * Never kept by a shared cache, and not by the browser either: whether this
 * capability may read the asset changes the moment the link is revoked or runs
 * out, and the redirect target is cheap to ask for again.
 */
const EMBED_ASSET_HEADERS = {
  "cache-control": "private, no-store",
  "referrer-policy": "no-referrer",
} as const;

const refusal = (status: 404 | 403 | 500, error: string) =>
  Response.json({ error }, { status, headers: EMBED_ASSET_HEADERS });

export interface EmbedAssetRouteOptions {
  /** Same host context `createEmbedRouteHandler` resolves links in (Cloud checks the creator's live state). */
  withHostContext?: <T>(fn: () => Promise<T>) => Promise<T>;
  /**
   * Runs the read under the link's authority. Defaults to `runWithEmbedContext`;
   * Cloud adds its database handle, exactly as its RPC route does for an embed.
   */
  withEmbedContext?: <T>(context: EmbedRequestContext, fn: () => Promise<T>) => Promise<T>;
}

/**
 * `GET /embed/:publicId/assets/:assetId/raw` — an asset's bytes for whoever
 * holds an Embed Link, at the address the embedded Node Detail views rewrite
 * `/api/assets/:assetId/raw` to.
 *
 * Why it exists: a Doc body, a folder readme and a File's download button all
 * point at `/api/assets/:assetId/raw`, which authorizes by session (or a public
 * share). An embed visitor has neither — the link IS the credential — and an
 * `<img>` cannot send the capability header RPC calls carry. So the embed page
 * rewrites those URLs to this route, which takes the capability from `?token=`
 * (an iframe, or a sandboxed readme frame that sends no cookies) or from the
 * `/embed/:publicId`-scoped cookie a top-level visit already holds.
 *
 * It grants nothing new: the read is the same `resolveAssetContent` the raw
 * route performs, under `runWithEmbedContext` — the asset must be mounted on a
 * node the link can read (`assertAssetPermission` is usage-backed), and a
 * revoked, expired or unknown link is the same neutral 404 as a missing asset.
 */
export const createEmbedAssetRouteHandler = ({
  withHostContext = (fn) => fn(),
  withEmbedContext = (context, fn) => runWithEmbedContext(context, fn),
}: EmbedAssetRouteOptions = {}) => {
  return async (
    request: Request,
    ctx: { params: Promise<{ publicId: string; assetId: string }> },
  ): Promise<Response> => {
    const { publicId, assetId } = await ctx.params;
    if (!isValidEmbedPublicId(publicId) || !assetId) return refusal(404, "Asset not found");

    const url = new URL(request.url);
    const token = url.searchParams.get("token");
    const secret =
      token && isValidEmbedSecret(token)
        ? token
        : readEmbedCapabilityCookie(request.headers.get("cookie"), publicId)?.secret;
    if (!secret) return refusal(404, "Asset not found");

    try {
      const context = await withHostContext(() => resolveEmbedRequestContext(publicId, secret));
      if (!context) return refusal(404, "Asset not found");
      const content = await withEmbedContext(context, () => resolveAssetContent(assetId));
      if (url.searchParams.get("download") === "1") {
        const response = createAssetDownloadResponse(content, url.searchParams.get("filename"));
        for (const [name, value] of Object.entries(EMBED_ASSET_HEADERS)) {
          response.headers.set(name, value);
        }
        return response;
      }
      return new Response(null, {
        status: 302,
        headers: {
          ...EMBED_ASSET_HEADERS,
          location: content.url,
          "x-asset-content-type": content.mimeType,
        },
      });
    } catch (error) {
      if (error instanceof ORPCError) {
        // Same as the raw route: "gone", "not mounted where this link reaches"
        // and "not yours" all answer 404, so the route is no existence oracle.
        if (error.code === "NOT_FOUND") return refusal(404, "Asset not found");
        if (error.code === "FORBIDDEN") return refusal(403, "Forbidden");
      }
      console.error(`[embed-assets] failed to resolve ${assetId} for ${publicId}:`, error);
      return refusal(500, "Couldn't resolve the asset.");
    }
  };
};
