import "server-only";

import { ORPCError } from "@orpc/server";
import { runWithBusabaseContext } from "busabase-core/context";
import { resolveAssetContent } from "busabase-core/domains/assets/asset-content-logic";
import { getLocalUserName } from "~/lib/local-user";
import { resolveRelayPermissionContext } from "~/lib/relay-permission";

export const dynamic = "force-dynamic";

/**
 * `GET /api/assets/{assetId}/raw` — an asset's bytes at a STABLE address.
 *
 * **Why the route exists.** Doc bodies used to embed the resolved storage URL
 * of an uploaded image, which pinned durable user content to whichever storage
 * route and backend happened to be configured at write time (a body written in
 * dev over the S3 adapter carries `/api/dev/attachment/…` and 404s in a
 * production build). Bodies now reference the ASSET; this route is where that
 * reference is resolved. See `busabase-core`'s `assets/utils/asset-content-url.ts`.
 *
 * **Why this path.** `/api/assets/…` sits with the app's other real production
 * routes (`/api/storage/[...key]`, `/api/branding/logo`) rather than under
 * `/api/dev/`, which 404s in production by design — self-hosted Busabase runs a
 * production build, so this is a first-class data path. The `raw` suffix keeps
 * it distinct from the contract's `GET /api/v1/assets/{assetId}/content`, which
 * is the JSON *description* of the same bytes (`{ downloadUrl, mimeType, … }`);
 * both go through the same `resolveAssetContent` gate.
 *
 * **Redirect, not proxy.** A 302 to the resolved location keeps bytes off the
 * app server (no buffering, no streaming bugs, no double egress) and is the
 * only shape that works when the backend hands out presigned S3 URLs. The
 * `Location` may be root-relative (`/api/storage/…` on local disk) — RFC 7231
 * resolves it against the request URI, which is exactly the same-origin fetch
 * the browser would have made before.
 *
 * **Access control.** `resolveAssetContent` applies the standard asset ACL
 * first: a read requires one usage the caller can see, and a Doc-embedded image
 * gets an `ownerType: "doc"` usage from `syncDocAssetUsages`, so an image is
 * exactly as reachable as the Doc that shows it. `apps/busabase` itself injects
 * no auth (single-user open-source host — see `/api/rpc`), so locally every
 * asset resolves; the gate is what makes the route correct for a host that
 * DOES inject an actor (an API-key ceiling relayed from Cloud, an anonymous
 * public-share visitor).
 *
 * **Caching.** The bytes keep coming from wherever they came from before — the
 * redirect target IS the CDN/S3/local URL — so the only new cost this route adds
 * is one small round-trip per image to learn that target. Cache policy exists to
 * make that cost approach zero on repeat views.
 *
 * `private`, because the target is per-caller authorized: two callers can
 * legitimately get different answers (or no answer) for the same id, so a shared
 * cache must not hold one caller's result. The browser's own cache is unshared,
 * which is where the win is anyway — a Doc with twenty images pays twenty
 * redirects once, then none.
 *
 * The TTL is bounded by staleness, NOT by expiry: `resolveAssetContent` resolves
 * through `storage.getPublicUrl()`, and every branch of it (CDN base,
 * `STORAGE_PUBLIC_BASE_URL`, MinIO endpoint, S3 direct) returns a STATIC URL —
 * this path never mints a presigned, expiring one. So the question is only how
 * long a client may keep pointing at a location that `editContent` could have
 * replaced under it; five minutes keeps that window small while still collapsing
 * the burst.
 *
 * Two things a future host can tighten here, both deliberately not done yet:
 * - For an asset that resolves for an ANONYMOUS caller (a public-share Doc), the
 *   answer is the same for everyone, so `public` would let the CDN edge cache
 *   the redirect too and drop the extra hop entirely. That needs a host that
 *   actually injects an anonymous actor — `apps/busabase` injects none.
 * - The ACL runs on every request precisely so this address can grow teeth
 *   later: per-asset grants, expiring share links, or handing back a presigned
 *   URL instead of a static one. Callers hold the id, not the location, so any
 *   of that lands without touching a single stored Doc body. If a presigned URL
 *   ever does become the target, this TTL must drop inside its lifetime.
 */
const CACHE_CONTROL = "private, max-age=300";

export const GET = async (
  request: Request,
  ctx: { params: Promise<{ assetId: string }> },
): Promise<Response> => {
  const { assetId } = await ctx.params;
  if (!assetId) {
    return Response.json({ error: "Missing asset id" }, { status: 404 });
  }

  try {
    const content = await runWithBusabaseContext(
      {
        localUserName: getLocalUserName(),
        ...resolveRelayPermissionContext(request.headers),
      },
      () => resolveAssetContent(assetId),
    );
    return new Response(null, {
      status: 302,
      headers: {
        location: content.url,
        "cache-control": CACHE_CONTROL,
        // Not authoritative (the redirect carries no body) but it lets a client
        // decide whether to follow before paying for the bytes.
        "x-asset-content-type": content.mimeType,
      },
    });
  } catch (error) {
    if (error instanceof ORPCError) {
      // The asset ACL answers NOT_FOUND for "gone" and "not yours" alike, on
      // purpose — a 404 must not become an existence oracle. FORBIDDEN is
      // reserved for a caller who can see the asset but lacks the level.
      if (error.code === "NOT_FOUND") {
        return Response.json({ error: "Asset not found" }, { status: 404 });
      }
      if (error.code === "FORBIDDEN") {
        return Response.json({ error: "Forbidden" }, { status: 403 });
      }
    }
    console.error(`[assets] failed to resolve content for ${assetId}:`, error);
    return Response.json({ error: "Couldn't resolve the asset." }, { status: 500 });
  }
};
