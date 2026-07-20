import "server-only";

import { ORPCError } from "@orpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { getContextSpaceId } from "../../../context";
import { getDb } from "../../../db";
import { busabaseNodes } from "../../../db/schema";
import { buildNodeVisibilityCondition } from "../../../logic/node-acl";

// The DB-level bound this guard mirrors: attachments.file_name is
// `varchar("file_name", { length: 255 })` (packages/open-domains/attachments/schema/attachments.ts).
// Postgres/PGLite count `varchar(n)` limits in characters, not bytes, so a
// plain JS `.length` check on the (already-decoded, UTF-16) string is the
// correct match — not `Buffer.byteLength`, which would measure UTF-8 bytes
// and reject strings that are actually within the DB's character bound.
const MAX_FILENAME_LENGTH = 255;

export const normalizeFilePath = (filePath: string) => {
  const normalized = filePath.replace(/\\/g, "/");
  // A leading "/" used to be silently stripped here, so a caller who typed
  // "/README.md" got a working "README.md" with no indication anything had
  // changed. Reject it instead: paths in a Skill/Drive tree are always
  // relative to the node's own root, never absolute, and a caller who typed a
  // leading slash out of Unix/URL habit deserves a clear signal to drop it,
  // not a silent rewrite they'd never notice.
  if (normalized.startsWith("/")) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Invalid file path: "${filePath}" — paths are relative to the node's root; do not start with "/".`,
    });
  }
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new ORPCError("BAD_REQUEST", { message: `Invalid file path: ${filePath}` });
  }
  // Only the final path segment becomes `attachments.file_name` (see
  // `displayNameForPath` in ../handlers.ts, which does the same
  // `split("/").at(-1)` extraction) — intermediate folder segments are never
  // stored in that column, so only the filename itself needs to respect the
  // DB's varchar(255) bound. Catching this here, before it ever reaches
  // upload-logic's `db.insert`, turns an uncaught "value too long for type
  // character varying(255)" 500 at merge time into a clear BAD_REQUEST at
  // propose time.
  const filename = normalized.split("/").at(-1) ?? normalized;
  if (filename.length > MAX_FILENAME_LENGTH) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Filename too long: "${filename}" (${filename.length} chars, max ${MAX_FILENAME_LENGTH})`,
    });
  }
  return normalized;
};

export const getFileTreeNode = async (type: string, nodeIdOrSlug: string) => {
  const db = await getDb();
  const spaceId = getContextSpaceId();
  // Node ACL: a node the actor can't see resolves to null here — every
  // drive/skill/airapp get/listFiles/readFile funnels through this lookup, so
  // the caller-visible outcome is the same "not found" as a nonexistent node.
  const visible = buildNodeVisibilityCondition(db);
  const [byId] = await db
    .select()
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.id, nodeIdOrSlug),
        eq(busabaseNodes.spaceId, spaceId),
        isNull(busabaseNodes.archivedAt),
        visible,
      ),
    )
    .limit(1);
  const [node] =
    byId && byId.type === type
      ? [byId]
      : await db
          .select()
          .from(busabaseNodes)
          .where(
            and(
              eq(busabaseNodes.slug, nodeIdOrSlug),
              eq(busabaseNodes.spaceId, spaceId),
              eq(busabaseNodes.type, type),
              isNull(busabaseNodes.archivedAt),
              visible,
            ),
          )
          .limit(1);
  return node ?? null;
};

export const mimeTypeForPath = (path: string) => {
  const lower = path.toLowerCase();
  if (lower.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (lower.endsWith(".html")) return "text/html; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".wasm")) return "application/wasm";
  if (
    lower.endsWith(".md") ||
    lower.endsWith(".meta") ||
    lower.endsWith(".txt") ||
    lower.endsWith(".xml") ||
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".js") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".css") ||
    lower.endsWith(".yaml") ||
    lower.endsWith(".yml")
  ) {
    return "text/plain; charset=utf-8";
  }
  return "application/octet-stream";
};
