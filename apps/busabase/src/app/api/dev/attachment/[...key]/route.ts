import { createDevAttachmentRoute } from "openlib/storage/dev-routes";

export const dynamic = "force-dynamic";

/**
 * Development-only attachment download route. When `STORAGE_PUBLIC_BASE_URL` is
 * set it proxies to that origin; otherwise it reads through the configured
 * storage adapter.
 *
 * Thin wrapper over openlib's shared `createDevAttachmentRoute`, keeping its
 * default production gate — `/api/dev/*` means "development only, 404 in
 * production" in every app, no exceptions. Busabase's *production* read route
 * lives at `/api/storage/[...key]`, which is what self-hosted deployments point
 * `STORAGE_URL`'s `base_url=` at.
 *
 * The key guard stays on even though the gate makes traversal unreachable in
 * production: the handler passes the joined key straight to
 * `path.join(rootDir, key)`, and a dev process is still a process worth not
 * letting read outside its storage root.
 */
export const { GET } = createDevAttachmentRoute();
