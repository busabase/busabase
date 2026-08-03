import { createDevUploadRoute } from "openlib/storage/dev-routes";
import { invalidStorageKeyResponse, isSafeStorageKey } from "~/lib/storage-key";

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
const base = createDevUploadRoute();

export const POST = async (req: Request): Promise<Response> => {
  // The legacy multipart path. `useS3Uploader` uses PUT; this branch stays for
  // older callers. A body that isn't multipart is left to the shared handler,
  // which answers with its own 400.
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
