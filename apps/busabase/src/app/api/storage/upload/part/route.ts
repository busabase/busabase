import { createLocalMultipartPartRoute } from "openlib/storage/dev-routes";

export const dynamic = "force-dynamic";

/**
 * Part relay for multipart uploads over local-disk storage — the production
 * sibling of `/api/storage/upload` (`LocalStorage.getUploadPartPresignedUrl`
 * returns `<upload_url>/part`). Large Base files and Drive uploads are split
 * into parts that each stay far below this app's `proxyClientMaxBodySize`.
 *
 * Writes only into a multipart upload the server already created for an
 * authorized caller: the `uploadId` is a server-minted random capability, the
 * `key` must match the one recorded at creation, and the destination object is
 * assembled by the server at completion. See `createLocalMultipartPartRoute`.
 */
export const { PUT } = createLocalMultipartPartRoute({ gateProduction: false });
