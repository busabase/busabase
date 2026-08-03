import { createDevAttachmentRoute } from "openlib/storage/dev-routes";
import { invalidStorageKeyResponse, isSafeStorageKey } from "~/lib/storage-key";

export const dynamic = "force-dynamic";

/**
 * Local attachment download route.
 *
 * Thin wrapper over openlib `createDevAttachmentRoute` (shared across apps).
 * When `STORAGE_PUBLIC_BASE_URL` is set it proxies to that origin; otherwise it
 * reads through the configured storage adapter.
 *
 * Busabase-specific, mirroring `/api/dev/upload`:
 * - **No production gate.** Local storage's public URLs *are* this route
 *   (`local://…?base_url=/api/dev/attachment`), so with the default gate on,
 *   every stored image — Base file fields, Doc images, the sidebar logo —
 *   404s in the production build that `busabase server` actually runs.
 * - **Key guard**, since the gate is off: the joined key must be a relative,
 *   traversal-free path before it reaches `path.join(rootDir, key)`.
 *
 * `gateProduction: false` is the EXCEPTION, not the norm: openlib defaults it
 * to `true` and every hosted app in this monorepo keeps that default, because
 * there the route really is a dev convenience (production serves objects from
 * S3/R2 directly, so nothing needs this proxy). Opting out is defensible here
 * only because self-hosted Busabase is a single-user, local-first app whose
 * *normal* deployment is a production build over local-disk storage — the
 * route is load-bearing, not a convenience.
 *
 * What that costs: this route is unauthenticated, so an instance exposed to a
 * network serves any object in the storage root to anyone who can guess a key
 * (keys are sha256-addressed, so guessing is impractical, but it is not an
 * access control). That matches the app's existing posture — `/api/rpc` has no
 * auth either — but it is a deliberate trade, not an oversight. An instance
 * intended for untrusted networks should sit behind a reverse proxy that
 * authenticates, or use S3/R2 storage so this route is never reached.
 */
const base = createDevAttachmentRoute({ gateProduction: false });

export const GET = async (
  req: Request,
  ctx: { params: Promise<{ key: string[] }> },
): Promise<Response> => {
  const { key: keyParts } = await ctx.params;
  if (!keyParts || keyParts.length === 0 || !isSafeStorageKey(keyParts.join("/"))) {
    return invalidStorageKeyResponse();
  }
  return base.GET(req, ctx);
};
