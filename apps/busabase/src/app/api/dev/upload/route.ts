import { createDevUploadRoute } from "openlib/storage/dev-routes";

export const dynamic = "force-dynamic";

/**
 * Development-only upload relay: the client sends a file, the server writes it
 * to the configured storage adapter, avoiding presigned-URL signature / CORS
 * issues.
 *
 * Thin wrapper over openlib's shared `createDevUploadRoute`, keeping its default
 * production gate — `/api/dev/*` means "development only, 404 in production" in
 * every app, no exceptions. Busabase's *production* storage relay lives at
 * `/api/storage/upload`, which is what self-hosted deployments point
 * `STORAGE_URL`'s `upload_url=` at.
 *
 * The key guard stays on even though the gate makes traversal unreachable in
 * production: the handler passes the key straight to `path.join(rootDir, key)`,
 * and a dev process is still a process worth not letting write outside its
 * storage root.
 */
export const { POST, PUT } = createDevUploadRoute();
