import { createDevAttachmentRoute } from "openlib/storage/dev-routes";
import { invalidStorageKeyResponse, isSafeStorageKey } from "~/lib/storage-key";

export const dynamic = "force-dynamic";

/**
 * Object download route — the read side of Busabase's local-disk storage, and a
 * real production route (unlike everything under `/api/dev/`, which 404s in
 * production by design).
 *
 * Self-hosted Busabase (`npx busabase server`, the Docker image, the desktop
 * app) runs a *production* build over local-disk storage, so serving stored
 * objects is a first-class data path, not a dev convenience. `STORAGE_URL` sets
 * `base_url=/api/storage`, which is what `LocalStorage.getPublicUrl()` puts in
 * front of every key — so this route is where Base file fields, Doc images and
 * the sidebar logo are actually fetched from.
 *
 * The handler comes from openlib's `createDevAttachmentRoute` factory. The
 * "Dev" in the name is historical — the factory is transport-generic (plain
 * `Request`/`Response`, no dev-specific behavior), and `gateProduction: false`
 * simply declines the default dev gate because this mount is not a dev path.
 * Renaming the shared export would touch all 11 apps that consume it, so it
 * stays as-is. When `STORAGE_PUBLIC_BASE_URL` is set the factory proxies to
 * that origin; otherwise it reads through the configured storage adapter.
 *
 * **Key guard.** Because there is no gate, the joined key is validated before it
 * reaches `path.join(rootDir, key)` in the local adapter — otherwise a traversal
 * key would be an arbitrary-file read.
 *
 * The route is unauthenticated: an instance exposed to a network serves any
 * object in the storage root to anyone who can guess a key (keys are
 * sha256-addressed, so guessing is impractical, but that is not access
 * control). This matches the app's existing posture — `/api/rpc` has no auth
 * either. An instance on an untrusted network should sit behind an
 * authenticating reverse proxy, or use S3/R2 so this route is never reached.
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
