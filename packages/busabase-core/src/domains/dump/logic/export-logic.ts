import "server-only";

import { ORPCError } from "@orpc/server";
import type {
  ExportAssetTextInput,
  ExportAssetTextVO,
  ExportTablesInput,
  ExportTablesVO,
} from "busabase-contract/domains/dump/types";
import { and, asc, eq, gt } from "drizzle-orm";
import { storage } from "openlib/storage";
import { getContextSpaceId } from "../../../context";
import { getDb } from "../../../db";
import { attachments, busabaseAssets, busabaseAssetTexts } from "../../../db/schema";
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
