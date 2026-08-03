import { createDevUploadRoute } from "openlib/storage/dev-routes";
import { invalidStorageKeyResponse, isSafeStorageKey } from "~/lib/storage-key";

export const dynamic = "force-dynamic";

/**
 * Server-side upload relay.
 * Client sends the file, the server writes it to the configured storage adapter.
 * Avoids presigned-URL signature / CORS issues.
 *
 * Thin wrapper over openlib `createDevUploadRoute` (shared across apps), with
 * two busabase-specific behaviors:
 *
 * - **No production gate** (same as `apps/buda`). Self-hosted Busabase runs a
 *   *production* build (`busabase server`), and this relay is the only way
 *   local storage receives bytes — with the default gate on, every upload
 *   (Base file fields, Doc images, the sidebar logo) 404s outside `next dev`.
 * - **Key guard.** Because the gate is off, the storage key is validated before
 *   it ever reaches `path.join(rootDir, key)` in the local adapter, so a
 *   traversal key can't be used to write outside the storage root.
 *
 * `gateProduction: false` is the EXCEPTION, not the norm: openlib defaults it
 * to `true` and the hosted apps keep that default, because there this relay is
 * a dev convenience (production uploads go straight to S3/R2 via a presigned
 * URL). Self-hosted Busabase is the opposite case — its normal deployment is a
 * production build over local-disk storage, where this relay is the only path
 * bytes have.
 *
 * What that costs: the relay is unauthenticated, so an instance exposed to a
 * network lets anyone write objects into the storage root (bounded by the key
 * guard and the caller's own size policy, but not by any identity check). That
 * matches the app's existing posture — `/api/rpc` has no auth either — but it
 * is a deliberate trade. See the sibling `/api/dev/attachment` route.
 */
const base = createDevUploadRoute({ gateProduction: false });

export const POST = async (req: Request): Promise<Response> => {
  // The legacy multipart path. `useS3Uploader` (and therefore the logo upload)
  // uses PUT; this branch stays for older callers. A body that isn't multipart
  // is left to the shared handler, which answers with its own 400.
  try {
    const storageKey = (await req.clone().formData()).get("storageKey");
    if (typeof storageKey === "string" && !isSafeStorageKey(storageKey)) {
      return invalidStorageKeyResponse();
    }
  } catch {
    // fall through — the shared handler re-reads and reports the real error
  }
  return base.POST(req);
};

export const PUT = async (req: Request): Promise<Response> => {
  const key = new URL(req.url).searchParams.get("key");
  if (key !== null && !isSafeStorageKey(key)) {
    return invalidStorageKeyResponse();
  }
  return base.PUT(req);
};
