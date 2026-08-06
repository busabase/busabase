import { createDevUploadRoute } from "openlib/storage/dev-routes";

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
 * **Key guard.** A traversal key would be an arbitrary-file write here, since
 * there is no gate in front. This route used to re-implement that check; the
 * factory now applies `openlib/storage/storage-key` on every request instead,
 * so the guarantee no longer depends on each mount remembering to.
 *
 * The relay is unauthenticated, so an instance exposed to a network lets anyone
 * write objects into the storage root (bounded by the key guard and the caller's
 * own size policy, but not by any identity check). This matches the app's
 * existing posture — `/api/rpc` has no auth either — but it is a deliberate
 * trade. See the sibling `/api/storage/[...key]` read route.
 */
export const { POST, PUT } = createDevUploadRoute({ gateProduction: false });
