import { createDevUploadRoute } from "openlib/storage/dev-routes";

export const dynamic = "force-dynamic";

/**
 * Development-only server-side upload.
 * Client sends the file, the server writes it to the configured storage adapter.
 * Avoids presigned-URL signature / CORS issues.
 *
 * Thin wrapper over openlib `createDevUploadRoute` (shared across apps).
 */
export const { POST, PUT } = createDevUploadRoute();
