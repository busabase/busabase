import { createLocalMultipartPartRoute } from "openlib/storage/dev-routes";

export const dynamic = "force-dynamic";

/**
 * Development-only multipart part relay, next to `/api/dev/upload` (404 in
 * production, like everything under `/api/dev/`). See
 * `createLocalMultipartPartRoute` for why it is not an arbitrary-key write.
 */
export const { PUT } = createLocalMultipartPartRoute();
