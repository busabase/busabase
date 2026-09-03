import "server-only";

import { ORPCError } from "@orpc/server";
import type {
  ExportAssetTextInput,
  ExportAssetTextVO,
  ExportDocBodiesInput,
  ExportDocBodiesVO,
  ExportTablesInput,
  ExportTablesVO,
} from "busabase-contract/domains/dump/types";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { storage } from "openlib/storage";
import { getContextSpaceId } from "../../../context";
import { getDb } from "../../../db";
import { attachments, busabaseAssets, busabaseAssetTexts, busabaseNodes } from "../../../db/schema";
import { docBodyKey } from "../../doc/handlers";
import { requireSpaceManagerForDump } from "./_guard";
import { DUMP_TABLE_REGISTRY } from "./table-registry";

/**
 * Cursor-paginated raw SELECT of a dump-eligible table, scoped explicitly to
 * the caller's context space (this is a bulk table scan, not a normal
 * space-scoped logic fn that can lean on RLS/middleware alone — the `eq`
 * below is load-bearing). Ordered by `id` for a stable, gap-tolerant cursor.
 */
export const exportTableRows = async (input: ExportTablesInput): Promise<ExportTablesVO> => {
  requireSpaceManagerForDump();
  const table = DUMP_TABLE_REGISTRY[input.table];
  const spaceId = getContextSpaceId();
  const db = await getDb();

  const where = input.cursor
    ? and(eq(table.spaceId, spaceId), gt(table.id, input.cursor))
    : eq(table.spaceId, spaceId);

  const rows = await db
    .select()
    .from(table as never)
    .where(where)
    .orderBy(asc(table.id))
    .limit(input.limit);

  const typedRows = rows as Array<Record<string, unknown> & { id: string }>;
  const nextCursor = typedRows.length === input.limit ? typedRows[typedRows.length - 1].id : null;

  return { rows: typedRows, nextCursor };
};

/**
 * Read the raw markdown behind a batch of Doc nodes, straight from object
 * storage — the export-side counterpart to the `docBodies` pseudo-table on
 * `importTables`.
 *
 * Why this bypasses the Doc domain entirely: `nodes.get({ type: "doc" })`
 * deliberately 404s on an ARCHIVED node (Trash is a separate, metadata-only
 * read path), but the raw `nodes` table dump includes archived rows by design.
 * A backup driven through the ordinary read path therefore captured only the
 * live Docs and warned about the rest — on a real production space, 13 of 88
 * bodies, with the other 75 restoring back EMPTY. A dump route has to see the
 * whole table, archived rows included, exactly like `exportTableRows` above.
 *
 * The `spaceId` + `type` filter is load-bearing for the same reason it is in
 * `exportTableRows`: this reads storage by a key derived from a caller-supplied
 * id, so the node must be proven to be a Doc in the caller's own space first,
 * or a manager in space A could name a node id belonging to space B and read
 * its body back.
 */
export const exportDocBodies = async (input: ExportDocBodiesInput): Promise<ExportDocBodiesVO> => {
  requireSpaceManagerForDump();
  const spaceId = getContextSpaceId();
  const db = await getDb();

  const owned = await db
    .select({ id: busabaseNodes.id })
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.spaceId, spaceId),
        eq(busabaseNodes.type, "doc"),
        inArray(busabaseNodes.id, input.nodeIds),
      ),
    );

  const bodies = await Promise.all(
    owned.map(async (row) => ({
      nodeId: row.id,
      // A Doc with no body object yet is a legitimate state (created, never
      // written) — read it as an empty body, the same as the Doc domain's own
      // reader does, rather than failing the whole batch over it.
      markdown: (await storage.getObject(docBodyKey(row.id)).catch(() => Buffer.from(""))).toString(
        "utf8",
      ),
    })),
  );

  return { bodies };
};

/**
 * Resolve the download URL for ONE asset's extracted-text object, so a backup
 * can archive the exact bytes an `busabase_asset_texts` row points at.
 *
 * The `assetTexts` TABLE was always exported (it is in `DumpTableSchema`), but
 * the bytes its `text_storage_key` points at were not — a restored row kept
 * `status: "present"` while its object was simply absent, and grep silently
 * returned no matches for text that existed on the source. Same failure shape
 * as the `nodePrincipals` loss: the row is in the dump set, the thing it
 * depends on is not.
 *
 * `downloadUrl` is null for the two kinds of row that own no separate object:
 *  - `writtenBy: "auto"` (text-kind asset): `text_storage_key` IS the owning
 *    attachment's own key — no bytes were ever copied, and the attachment-blob
 *    pass already archives them. Re-archiving would duplicate bytes and make
 *    two archive entries race for the same key on restore. The check below is
 *    structural (key equals the attachment's key) rather than a `writtenBy`
 *    string compare or an `asset-texts/` prefix test, because "does this key
 *    already belong to the attachment pass" is the property that actually
 *    matters here.
 *  - `status: "none"` (no extractable text): key is `""`.
 *
 * Mirrors `assets.download`: returns a resolved URL rather than raw bytes, so
 * a multi-GB text streams to the caller instead of being base64'd into a JSON
 * response body.
 */
export const exportAssetTextBlob = async (
  input: ExportAssetTextInput,
): Promise<ExportAssetTextVO> => {
  requireSpaceManagerForDump();
  const spaceId = getContextSpaceId();
  const db = await getDb();

  const [row] = await db
    .select({
      assetId: busabaseAssetTexts.assetId,
      textStorageKey: busabaseAssetTexts.textStorageKey,
      textContentHash: busabaseAssetTexts.textContentHash,
      byteCount: busabaseAssetTexts.byteCount,
      attachmentStorageKey: attachments.storageKey,
    })
    .from(busabaseAssetTexts)
    .leftJoin(busabaseAssets, eq(busabaseAssetTexts.assetId, busabaseAssets.id))
    .leftJoin(attachments, eq(busabaseAssets.attachmentId, attachments.id))
    .where(
      and(eq(busabaseAssetTexts.assetId, input.assetId), eq(busabaseAssetTexts.spaceId, spaceId)),
    )
    .limit(1);
  if (!row) {
    throw new ORPCError("NOT_FOUND", { message: `Asset text not found: ${input.assetId}` });
  }

  const ownsSeparateObject =
    row.textStorageKey !== "" && row.textStorageKey !== row.attachmentStorageKey;

  return {
    assetId: row.assetId,
    textStorageKey: row.textStorageKey,
    downloadUrl: ownsSeparateObject ? storage.getPublicUrl(row.textStorageKey) : null,
    textContentHash: row.textContentHash,
    byteCount: row.byteCount,
  };
};
