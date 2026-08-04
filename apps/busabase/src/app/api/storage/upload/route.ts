import { createDevUploadRoute } from "openlib/storage/dev-routes";
import { invalidStorageKeyResponse, isSafeStorageKey } from "~/lib/storage-key";

export const dynamic = "force-dynamic";

/**
 * Server-side upload relay — the write side of Busabase's local-disk storage,
 * and a real production route (unlike everything under `/api/dev/`, which 404s
 * in production by design). The client sends bytes, the server writes them to
 * the configured storage adapter, avoiding presigned-URL signature / CORS
 * issues that local storage cannot solve (it has no browser-direct PUT target).
 *
 * Self-hosted Busabase (`npx busabase server`, the Docker image, the desktop
 * app) runs a *production* build over local-disk storage, so this relay is the
 * only way bytes reach the storage root — Base file fields, Doc images, the
 * sidebar logo. `STORAGE_URL` sets `upload_url=/api/storage/upload`, which is
 * what `LocalStorage.generateUploadPresignedUrl()` hands clients in place of the
 * presigned PUT target S3 would give.
 *
 * The handler comes from openlib's `createDevUploadRoute` factory. The "Dev" in
 * the name is historical — the factory is transport-generic (plain
 * `Request`/`Response`, no dev-specific behavior), and `gateProduction: false`
 * simply declines the default dev gate because this mount is not a dev path.
 * Renaming the shared export would touch all 11 apps that consume it, so it
 * stays as-is.
 *
 * **Key guard.** Because there is no gate, the storage key is validated before
 * it reaches `path.join(rootDir, key)` in the local adapter — otherwise a
 * traversal key would be an arbitrary-file write.
 *
 * The relay is unauthenticated, so an instance exposed to a network lets anyone
 * write objects into the storage root (bounded by the key guard and the caller's
 * own size policy, but not by any identity check). This matches the app's
 * existing posture — `/api/rpc` has no auth either — but it is a deliberate
 * trade. See the sibling `/api/storage/[...key]` read route.
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
