import "server-only";

import { ORPCError } from "@orpc/server";
import type {
  ImportCommitVO,
  ImportTablesInput,
  ImportTablesVO,
} from "busabase-contract/domains/dump/types";
import { and, eq, getTableColumns, inArray, ne } from "drizzle-orm";
import { storage } from "openlib/storage";
import { getContextSpaceId } from "../../../context";
import { getDb } from "../../../db";
import {
  attachments,
  busabaseAssets,
  busabaseAssetTexts,
  busabaseFieldValues,
  busabaseNodes,
  busabaseRecordLinks,
  busabaseRecords,
} from "../../../db/schema";
import { id as generateId, rootNodeIdForSpace } from "../../../logic/kernel";
import { ensureReady } from "../../../logic/seed";
import { writeDocBody } from "../../doc/handlers";
import { requireSpaceManagerForDump } from "./_guard";
import { DUMP_IMPORT_ORDER, DUMP_TABLE_REGISTRY } from "./table-registry";

/**
 * Import sessions are tracked in-process (a `Map`, not a DB table). Import is
 * a synchronous, operator-driven admin flow — one CLI process holds the
 * session for its own lifetime (minutes, not days) — so a lightweight
 * in-memory record with a TTL sweep is simpler than a `busabase_dump_sessions`
 * table and avoids adding a persistent table for a purely transient concept.
 * This does mean a session cannot survive a server restart — `--resume` in
 * `busabase-dump` is implemented at the CLI/archive level (idMap + step
 * markers on disk), not by resuming a dead server-side session; a resumed
 * full-fidelity import calls `importBegin` again against the still-empty
 * space and replays whichever table batches were not yet marked done.
 */
interface ImportSession {
  id: string;
  spaceId: string;
  createdAt: number;
  insertedIds: Map<string, Set<string>>;
}

const SESSION_TTL_MS = 60 * 60 * 1000; // 1h — generous for a large space import.
const sessions = new Map<string, ImportSession>();

const sweepExpiredSessions = () => {
  const now = Date.now();
  for (const [sessionId, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) sessions.delete(sessionId);
  }
};

const requireSession = (sessionId: string): ImportSession => {
  sweepExpiredSessions();
  const session = sessions.get(sessionId);
  if (!session) {
    throw new ORPCError("NOT_FOUND", {
      message: `Import session not found or expired: ${sessionId}`,
    });
  }
  return session;
};

export const beginImportSession = async (): Promise<{ sessionId: string }> => {
  requireSpaceManagerForDump();
  sweepExpiredSessions();
  // A target space reached only through the dump routes (never touched by any
  // other domain route first) has never had `ensureReady()` run against it —
  // the workspace-root node genuinely does not exist yet. Every other domain
  // handler calls `ensureReady()` itself before touching `nodes`; the dump
  // domain must too, or `importTables("nodes", ...)`'s root-remap (below)
  // would point every top-level child's `parentId` at a root row that was
  // never created, failing the FK constraint on the very first import.
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();

  // `ensureReady()` auto-seeds a workspace-root folder node (id
  // `rootNodeIdForSpace(spaceId)`) into every space before it can be used at
  // all — so a *truly* empty space still has exactly that one node row. Treat
  // that specific row as not counting toward "empty" (see `importTableRows`'s
  // matching skip for the `nodes` table below, so re-importing the source's
  // own root node row doesn't collide with it on insert).
  const [existing] = await db
    .select({ id: busabaseNodes.id })
    .from(busabaseNodes)
    .where(
      and(eq(busabaseNodes.spaceId, spaceId), ne(busabaseNodes.id, rootNodeIdForSpace(spaceId))),
    )
    .limit(1);
  if (existing) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Full-fidelity import requires an empty target space (node tree is not empty).",
    });
  }

  const sessionId = generateId("dumpsess");
  sessions.set(sessionId, {
    id: sessionId,
    spaceId,
    createdAt: Date.now(),
    insertedIds: new Map(),
  });
  return { sessionId };
};

/**
 * `dump.exportTables` rows travel through JSON (the oRPC contract, then the
 * `.bbdump` archive's NDJSON entries), which turns every `timestamp("...",
 * { mode: "date" })` column into an ISO string. Drizzle's pg driver expects
 * an actual `Date` for those columns on insert — passing the string through
 * as-is fails with an opaque 500 from the pg client. Walk the target table's
 * column metadata and coerce every `dataType: "date"` column back to `Date`
 * before the insert.
 */
const coerceDateColumns = <T extends Record<string, unknown>>(
  table: (typeof DUMP_TABLE_REGISTRY)[keyof typeof DUMP_TABLE_REGISTRY],
  row: T,
): T => {
  const columns = getTableColumns(table as never) as Record<string, { dataType: string }>;
  const coerced: Record<string, unknown> = { ...row };
  for (const [key, column] of Object.entries(columns)) {
    const value = coerced[key];
    if (column.dataType === "date" && typeof value === "string") {
      coerced[key] = new Date(value);
    }
  }
  return coerced as T;
};

export const importTableRows = async (input: ImportTablesInput): Promise<ImportTablesVO> => {
  requireSpaceManagerForDump();
  const session = requireSession(input.sessionId);
  const spaceId = getContextSpaceId();
  if (spaceId !== session.spaceId) {
    throw new ORPCError("BAD_REQUEST", { message: "Import session belongs to a different space." });
  }
  if (input.rows.length === 0) return { inserted: 0 };

  if (input.table === "docBodies") {
    for (const row of input.rows) {
      const nodeId = row.nodeId as string;
      const markdown = row.markdown as string;
      await writeDocBody(nodeId, markdown);
    }
    return { inserted: input.rows.length };
  }

  // Attachment bytes (content-addressed object storage, not a DB row): write
  // each blob directly at its original `storageKey` via `storage.uploadFileToKey`
  // BEFORE the `attachments` table row that points at it is inserted (import
  // order in table-registry.ts puts `attachmentBlobs` ahead of `attachments`
  // — see `full-importer.ts`), so no `busabase_attachments` row ever
  // momentarily dangles without its bytes.
  if (input.table === "attachmentBlobs") {
    for (const row of input.rows) {
      const storageKey = row.storageKey as string;
      const mimeType = (row.mimeType as string) ?? "application/octet-stream";
      const base64 = row.base64 as string;
      await storage.uploadFileToKey(Buffer.from(base64, "base64"), storageKey, mimeType);
    }
    return { inserted: input.rows.length };
  }

  // Extracted-text bytes (Drive Grep Retrieval). Same treatment as
  // `attachmentBlobs`, and for the same reason: the `busabase_asset_texts` ROW
  // travels as an ordinary dump table, but the object its `text_storage_key`
  // points at lives in storage, so without this the restored row claims
  // `status: "present"` over bytes that were never captured and grep silently
  // finds nothing. Only DERIVED text arrives here (`asset-texts/blobs/sha256/…`)
  // — auto-registered rows point at the attachment's own key, already written
  // by `attachmentBlobs` above. Written before the `assetTexts` rows that
  // reference these keys (see `full-importer.ts`).
  if (input.table === "assetTextBlobs") {
    for (const row of input.rows) {
      const textStorageKey = row.textStorageKey as string;
      const base64 = row.base64 as string;
      await storage.uploadFileToKey(
        Buffer.from(base64, "base64"),
        textStorageKey,
        "text/plain; charset=utf-8",
      );
    }
    return { inserted: input.rows.length };
  }

  const table = DUMP_TABLE_REGISTRY[input.table];
  const db = await getDb();

  // Rows come straight from an export archive: they already carry `spaceId`
  // from the *source* space. Re-stamp with the *target* (current context)
  // space so a restore into a different space id stays self-consistent.
  let rows = input.rows;
  if (input.table === "nodes") {
    // The target space's workspace-root node was already auto-seeded by
    // `ensureReady()` before `importBegin` even ran (see the matching skip
    // there) — re-inserting the source's own root row would collide on its
    // fixed id. When source and target are the *same* spaceId (disaster
    // recovery restore) `rootNodeIdForSpace` is deterministic, so the
    // source's root row id equals the target's — the old `row.id !== rootId`
    // check alone worked. But when restoring into a *different* target
    // spaceId (e.g. two-spaceId cross-space test/migration on one server),
    // the source root's id differs from the target's, so that check let the
    // source's root row straight through — it would then either collide with
    // an unrelated pre-existing row sharing that literal id (ids are a global
    // PK, not scoped per space) or, once genuinely fresh, leave every
    // top-level child's `parentId` dangling (still pointing at the never
    // re-inserted source root id), which fails the `parentId` FK. Detect the
    // root row structurally instead (the one node with `parentId === null` —
    // true for exactly one row per space by construction), drop it
    // unconditionally, and remap any child that pointed at it to the
    // target's own (already-existing) root id.
    const rootId = rootNodeIdForSpace(spaceId);
    const sourceRoot = rows.find((row) => row.parentId == null);
    const sourceRootId = sourceRoot?.id as string | undefined;
    rows = rows
      .filter((row) => row.id !== sourceRootId && row.id !== rootId)
      .map((row) =>
        sourceRootId && row.parentId === sourceRootId ? { ...row, parentId: rootId } : row,
      );
  }
  if (input.table === "nodePrincipals") {
    // A `principalType: "space"` grant means "everyone in this space", and
    // encodes that by storing the space's own id in `principalId` (see
    // busabase_node_principals schema). On a cross-space restore the row's
    // `spaceId` is re-stamped to the target below, so its `principalId` must
    // move with it — otherwise the restored grant would still name the SOURCE
    // space ("everyone in a space that isn't this one"), an orphaned grant.
    // User/team principals carry an opaque id that is space-independent and is
    // left untouched. (Same-id DR restore: this is a harmless no-op.)
    rows = rows.map((row) =>
      row.principalType === "space" ? { ...row, principalId: spaceId } : row,
    );
  }
  const stampedRows = rows.map((row) =>
    coerceDateColumns(table, { ...row, spaceId } as Record<string, unknown>),
  );
  if (stampedRows.length === 0) return { inserted: 0 };

  await db.insert(table as never).values(stampedRows as never[]);

  const seen = session.insertedIds.get(input.table) ?? new Set<string>();
  for (const row of stampedRows) seen.add((row as Record<string, unknown>).id as string);
  session.insertedIds.set(input.table, seen);

  return { inserted: stampedRows.length };
};

/**
 * Deep post-import integrity pass. Most FK relationships in this domain are
 * enforced at the DB level (`.references()` with cascade/restrict), so a bad
 * import order or a genuinely missing parent row already fails hard as a
 * Postgres FK violation during `importTableRows` — it never reaches here.
 * This function only needs to cover the relationships that are deliberately
 * *not* real FKs (documented as "loose text ref" in their schema — usually
 * because the referenced table is soft-deletable or auth-agnostic), which is
 * exactly where an import CAN silently produce an orphan:
 *  - `fieldValues.fieldId` — no FK (fields can be hard-deleted while historical
 *    values remain); orphan means the field itself was never re-created.
 *  - `assets.attachmentId` — no FK by design (loose ref into the shared,
 *    auth-agnostic `attachments` table); orphan means the Asset's physical
 *    file registry row never got imported.
 *  - attachment blob completeness — every imported `attachments.storageKey`
 *    must have actual bytes in object storage (the `attachmentBlobs`
 *    pseudo-table write happens before the `attachments` row in import order,
 *    but a partial archive or a storage write failure could still leave a
 *    dangling key).
 *  - asset-text blob completeness — same class of dangling reference for every
 *    imported `assetTexts.textStorageKey`. This one was NOT covered until an
 *    end-to-end restore proved it silently lost extracted text: the row said
 *    `status: "present"`, the object did not exist, and grep returned zero
 *    matches for content the source could find. An archive predating the
 *    `assetTextBlobs` pseudo-table restores exactly that way, so the warning
 *    here is what makes the loss visible instead of silent.
 * All findings are reported as non-fatal `warnings` (the import already
 * committed real rows the operator likely wants to keep and re-run to fix
 * incrementally, rather than a hard rollback of a large space import).
 */
const checkFieldValueOrphans = async (
  db: Awaited<ReturnType<typeof getDb>>,
  spaceId: string,
  fieldValueIds: Set<string>,
): Promise<string[]> => {
  if (fieldValueIds.size === 0) return [];
  const rows = await db
    .select({ id: busabaseFieldValues.id, fieldId: busabaseFieldValues.fieldId })
    .from(busabaseFieldValues)
    .where(
      and(
        eq(busabaseFieldValues.spaceId, spaceId),
        inArray(busabaseFieldValues.id, [...fieldValueIds]),
      ),
    );
  const orphanCount = rows.filter((row) => !row.fieldId).length;
  return orphanCount > 0
    ? [
        `${orphanCount} fieldValues row(s) reference a field that was not imported (fieldId is unset).`,
      ]
    : [];
};

const checkRecordLinkOrphans = async (
  db: Awaited<ReturnType<typeof getDb>>,
  spaceId: string,
  linkIds: Set<string>,
): Promise<string[]> => {
  if (linkIds.size === 0) return [];
  const links = await db
    .select({
      id: busabaseRecordLinks.id,
      sourceRecordId: busabaseRecordLinks.sourceRecordId,
      targetRecordId: busabaseRecordLinks.targetRecordId,
    })
    .from(busabaseRecordLinks)
    .where(
      and(eq(busabaseRecordLinks.spaceId, spaceId), inArray(busabaseRecordLinks.id, [...linkIds])),
    );
  if (links.length === 0) return [];
  const recordIds = new Set<string>();
  for (const link of links) {
    recordIds.add(link.sourceRecordId);
    recordIds.add(link.targetRecordId);
  }
  const existing = await db
    .select({ id: busabaseRecords.id })
    .from(busabaseRecords)
    .where(and(eq(busabaseRecords.spaceId, spaceId), inArray(busabaseRecords.id, [...recordIds])));
  const existingIds = new Set(existing.map((row) => row.id));
  const orphanCount = links.filter(
    (link) => !existingIds.has(link.sourceRecordId) || !existingIds.has(link.targetRecordId),
  ).length;
  return orphanCount > 0
    ? [`${orphanCount} recordLinks row(s) reference a source/target record that does not exist.`]
    : [];
};

const checkAssetAttachmentOrphans = async (
  db: Awaited<ReturnType<typeof getDb>>,
  spaceId: string,
  assetIds: Set<string>,
): Promise<string[]> => {
  if (assetIds.size === 0) return [];
  const assets = await db
    .select({ id: busabaseAssets.id, attachmentId: busabaseAssets.attachmentId })
    .from(busabaseAssets)
    .where(and(eq(busabaseAssets.spaceId, spaceId), inArray(busabaseAssets.id, [...assetIds])));
  if (assets.length === 0) return [];
  const attachmentIds = [...new Set(assets.map((asset) => asset.attachmentId))];
  const existing = await db
    .select({ id: attachments.id })
    .from(attachments)
    .where(inArray(attachments.id, attachmentIds));
  const existingIds = new Set(existing.map((row) => row.id));
  const orphanCount = assets.filter((asset) => !existingIds.has(asset.attachmentId)).length;
  return orphanCount > 0
    ? [`${orphanCount} asset row(s) reference an attachmentId that was not imported.`]
    : [];
};

const checkBlobCompleteness = async (
  db: Awaited<ReturnType<typeof getDb>>,
  attachmentIds: Set<string>,
): Promise<string[]> => {
  if (attachmentIds.size === 0) return [];
  const rows = await db
    .select({ id: attachments.id, storageKey: attachments.storageKey })
    .from(attachments)
    .where(inArray(attachments.id, [...attachmentIds]));
  const missing: string[] = [];
  for (const row of rows) {
    const exists = await storage.objectExists(row.storageKey);
    if (!exists) missing.push(row.storageKey);
  }
  return missing.length > 0
    ? [`${missing.length} attachment(s) have no bytes in storage for their storageKey.`]
    : [];
};

/**
 * Every imported `busabase_asset_texts` row whose `status` is not `none` must
 * have real bytes at its `text_storage_key`. Rows marked `none` legitimately
 * carry an empty key and are skipped. Auto-registered rows point at the
 * attachment's own key, so this also transitively re-checks that the
 * attachment blob landed — a text-kind asset whose bytes went missing is just
 * as unsearchable as a missing derived text.
 */
const checkAssetTextBlobCompleteness = async (
  db: Awaited<ReturnType<typeof getDb>>,
  spaceId: string,
  assetTextIds: Set<string>,
): Promise<string[]> => {
  if (assetTextIds.size === 0) return [];
  const rows = await db
    .select({
      id: busabaseAssetTexts.id,
      status: busabaseAssetTexts.status,
      textStorageKey: busabaseAssetTexts.textStorageKey,
    })
    .from(busabaseAssetTexts)
    .where(
      and(
        eq(busabaseAssetTexts.spaceId, spaceId),
        inArray(busabaseAssetTexts.id, [...assetTextIds]),
      ),
    );
  const missing: string[] = [];
  for (const row of rows) {
    if (row.status === "none" || row.textStorageKey === "") continue;
    const exists = await storage.objectExists(row.textStorageKey);
    if (!exists) missing.push(row.textStorageKey);
  }
  return missing.length > 0
    ? [
        `${missing.length} assetTexts row(s) have no bytes in storage for their textStorageKey — the extracted text they claim to hold is not searchable (grep will silently return no matches for it).`,
      ]
    : [];
};

export const commitImportSession = async (sessionId: string): Promise<ImportCommitVO> => {
  requireSpaceManagerForDump();
  const session = requireSession(sessionId);
  const warnings: string[] = [];

  if (!session.insertedIds.has("nodes")) {
    warnings.push("No nodes were imported in this session — the space will remain empty.");
  }

  const db = await getDb();
  const spaceId = session.spaceId;
  const fieldValueIds = session.insertedIds.get("fieldValues") ?? new Set<string>();
  const linkIds = session.insertedIds.get("recordLinks") ?? new Set<string>();
  const assetIds = session.insertedIds.get("assets") ?? new Set<string>();
  const attachmentIds = session.insertedIds.get("attachments") ?? new Set<string>();
  const assetTextIds = session.insertedIds.get("assetTexts") ?? new Set<string>();

  warnings.push(
    ...(await checkFieldValueOrphans(db, spaceId, fieldValueIds)),
    ...(await checkRecordLinkOrphans(db, spaceId, linkIds)),
    ...(await checkAssetAttachmentOrphans(db, spaceId, assetIds)),
    ...(await checkBlobCompleteness(db, attachmentIds)),
    ...(await checkAssetTextBlobCompleteness(db, spaceId, assetTextIds)),
  );

  sessions.delete(sessionId);
  return { ok: true, warnings };
};

export const abortImportSession = async (sessionId: string): Promise<{ ok: boolean }> => {
  requireSpaceManagerForDump();
  const session = requireSession(sessionId);
  const db = await getDb();

  // Best-effort cleanup, children before parents (reverse of import order).
  // Only ever touches rows this session itself inserted, in the space that
  // was validated empty at `importBegin` — never a blanket space wipe.
  for (const table of [...DUMP_IMPORT_ORDER].reverse()) {
    const ids = session.insertedIds.get(table);
    if (!ids || ids.size === 0) continue;
    const drizzleTable = DUMP_TABLE_REGISTRY[table];
    for (const rowId of ids) {
      await db.delete(drizzleTable as never).where(eq(drizzleTable.id, rowId));
    }
  }

  sessions.delete(sessionId);
  return { ok: true };
};
