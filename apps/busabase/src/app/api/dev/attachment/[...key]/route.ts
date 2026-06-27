import { createDevAttachmentRoute } from "openlib/storage/dev-routes";

export const dynamic = "force-dynamic";

/**
 * Development-only download proxy.
 *
 * Thin wrapper over openlib `createDevAttachmentRoute` (shared across apps).
 * When `STORAGE_PUBLIC_BASE_URL` is set it proxies to that origin; otherwise it
 * reads through the configured storage adapter.
 */
export const { GET } = createDevAttachmentRoute();
