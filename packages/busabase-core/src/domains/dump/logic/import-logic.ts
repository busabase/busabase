import "server-only";

import { ORPCError } from "@orpc/server";
import type {
  ImportBeginInput,
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
 * This does mean a session cannot survive a server restart, and `--resume`
 * deliberately does not try to. It starts a BRAND NEW session with
 * `resume: true` against the (now non-empty) space and replays the whole
 * archive, letting `ON CONFLICT DO NOTHING` skip whatever already landed.
 * Nothing about the dead session is recovered, so nothing has to be persisted
 * to recover it — the archive on disk is the only state a resume needs.
 *
 * (An earlier version of this comment described an "idMap + step markers on
 * disk" scheme at the CLI level. No such thing was ever built; `--resume`
 * simply threw "not implemented yet" until it was replaced by the above.)
 */
interface ImportSession {
  id: string;
  spaceId: string;
  /**
   * The archive's ORIGINAL space id (`manifest.spaceId`) — needed to compute
   * the source's root-node id deterministically (`rootNodeIdForSpace`) when
   * remapping `nodes` rows, instead of scanning each batch for "the row with
   * a null `parentId`". See the matching comment on `ImportBeginInputSchema`
   * for why that scan is unsound once a space has more nodes than one page.
   */
  sourceSpaceId: string;
  createdAt: number;
  insertedIds: Map<string, Set<string>>;
  /**
   * Continuing an interrupted restore. Inserts become `ON CONFLICT DO
   * NOTHING`, and `importAbort` refuses to run — see both call sites.
   */
  resume: boolean;
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

export const beginImportSession = async (
  input: ImportBeginInput,
): Promise<{ sessionId: string }> => {
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
  // `resume` deliberately skips this: continuing an interrupted restore means
  // the space is expected to be non-empty. See the flag's own doc comment on
  // `ImportBeginInputSchema` for why a failed restore does not need this but a
  // KILLED one does.
  if (!input.resume) {
    const [existing] = await db
      .select({ id: busabaseNodes.id })
      .from(busabaseNodes)
      .where(
        and(eq(busabaseNodes.spaceId, spaceId), ne(busabaseNodes.id, rootNodeIdForSpace(spaceId))),
      )
      .limit(1);
    if (existing) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          "Full-fidelity import requires an empty target space (node tree is not empty). " +
          "If a previous restore of THIS archive into THIS space was interrupted, re-run with " +
          "`--resume` to continue it.",
      });
    }
  }

  const sessionId = generateId("dumpsess");
  sessions.set(sessionId, {
    id: sessionId,
    spaceId,
    sourceSpaceId: input.sourceSpaceId,
    createdAt: Date.now(),
    insertedIds: new Map(),
    resume: input.resume,
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
    // re-inserted source root id), which fails the `parentId` FK. Drop it
    // unconditionally, and remap any child that pointed at it to the
    // target's own (already-existing) root id.
    //
    // The source root id is computed DETERMINISTICALLY from
    // `session.sourceSpaceId` (`rootNodeIdForSpace`), not by scanning THIS
    // batch's rows for "the one with a null `parentId`" — `dump.exportTables`
    // pages are id-ordered, not tree-ordered, so for any space with more
    // nodes than one page, the root row and its direct children can land in
    // DIFFERENT `importTables` calls. A per-batch scan only finds the root
    // when it happens to share a batch with the children pointing at it;
    // every other batch's top-level children silently kept their stale
    // source-root parentId and failed the FK constraint on insert — a real
    // crash reproduced restoring a 225-node production space (2 pages) into
    // an empty one. A deterministic id has no such luck-of-the-cursor gap.
    const rootId = rootNodeIdForSpace(spaceId);
    const sourceRootId = rootNodeIdForSpace(session.sourceSpaceId);
    rows = rows
      .filter((row) => row.id !== sourceRootId && row.id !== rootId)
      .map((row) => (row.parentId === sourceRootId ? { ...row, parentId: rootId } : row));
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

  let rowsToInsert = stampedRows;
  if (session.resume) {
    // Resuming a killed restore replays the whole archive, so rows that
    // already landed must be skipped rather than collide.
    //
    // NOT `onConflictDoNothing()`: dump ids are a single GLOBAL primary key,
    // not scoped per space. If the SOURCE space is still live in this same
    // database, every replayed row collides with its own original — so a
    // blanket "do nothing" silently skips the entire archive and reports
    // success over a space that stayed empty. Reproduced exactly that way
    // before this check existed.
    //
    // Look the ids up instead: a collision inside THIS space is our own
    // earlier progress (skip it), while a collision belonging to any other
    // space means the caller is resuming into the wrong place and must be
    // told, not silently ignored.
    const ids = stampedRows.map((row) => row.id as string);
    const existing = await queryInChunks<{ id: string; spaceId: string | null }>(
      ids,
      (idsChunk) =>
        db
          .select({ id: table.id, spaceId: table.spaceId })
          .from(table as never)
          .where(inArray(table.id, idsChunk)) as unknown as Promise<
          Array<{ id: string; spaceId: string | null }>
        >,
    );
    const foreign = existing.filter((row) => row.spaceId !== spaceId);
    if (foreign.length > 0) {
      throw new ORPCError("CONFLICT", {
        message:
          `Cannot resume: ${foreign.length} row(s) in table "${input.table}" already exist in a ` +
          `DIFFERENT space (e.g. id ${foreign[0]?.id}). A full-fidelity restore replays original ` +
          "ids, which are unique across the whole database — so this archive's rows are already " +
          "in use elsewhere here, and continuing would be restoring into the wrong place. " +
          "`--resume` is only for continuing the SAME archive into the SAME space.",
      });
    }
    const alreadyMine = new Set(existing.map((row) => row.id));
    rowsToInsert = stampedRows.filter((row) => !alreadyMine.has(row.id as string));
    if (rowsToInsert.length === 0) return { inserted: 0 };
  }

  try {
    await db.insert(table as never).values(rowsToInsert as never[]);
  } catch (error) {
    const cause = (
      error as { cause?: { code?: string; detail?: string; constraint?: string } } | undefined
    )?.cause;
    const pgCode = cause?.code;
    if (pgCode === "23503") {
      // Real FK violation (fieldValues.recordId/.changeRequestId/.operationId/
      // .baseId/.commitId all reference other dump tables) — reproduced live:
      // a backup of an actively-used space took over an hour, and content
      // created live partway through was captured by a LATER table
      // (fieldValues, itself id-paged rather than creation-time-ordered) but
      // missed by an EARLIER one (records) whose snapshot had already been
      // taken. `full-exporter.ts` now cross-checks and drops what it can
      // catch at export time, but an archive from before that fix — or any
      // FK this check doesn't cover — still reaches here as a raw Postgres
      // "insert or update on table ... violates foreign key constraint" with
      // no indication of WHICH row or WHY. Spell it out instead.
      //
      // Two different causes land here and the message must not presume one:
      // (a) drift — the source space changed under a long backup; (b) the
      // archive deliberately omits a whole referenced table, which is what a
      // `--no-history` backup does (`records.headCommitId` is a NOT NULL FK
      // into `commits`, so such an archive can never restore). Naming only (a)
      // sent a real `--no-history` restore chasing a phantom race.
      throw new ORPCError("CONFLICT", {
        message:
          `Restore failed: table "${input.table}" has a row referencing something this archive ` +
          `does not carry (constraint ${cause?.constraint ?? "unknown"}). Either the archive omits ` +
          "a whole table it depends on (a history-less backup cannot be restored — every record " +
          "points at the commit that produced it), or the source space kept changing while a long " +
          "backup was still running, so a later-exported table captured content an earlier one had " +
          "already missed. Re-run the backup with history included, and against a quiet space." +
          (cause?.detail ? ` (${cause.detail})` : ""),
      });
    }
    if (pgCode === "23505") {
      // Every dump table's `id` is a bare, database-wide primary key (not
      // scoped per space — see table-registry.ts). A restore replays the
      // archive's original ids verbatim, so it can only ever succeed against
      // ids that have never been used before anywhere in this database. That
      // holds for disaster recovery (the source space is gone) or a truly
      // fresh database, but NOT for cloning a still-live space into a second
      // one on the same server — the source's own rows still hold those ids.
      // Postgres's raw "duplicate key" 500 gave no hint of this; spell it out.
      throw new ORPCError("CONFLICT", {
        message:
          `Restore failed: table "${input.table}" has rows whose id already exists somewhere in ` +
          "this database. A full-fidelity restore replays the archive's original ids, so the target " +
          "database must never have used those ids before — this works for disaster recovery (restoring " +
          "into a fresh database, or back into the space it came from after that space's data was " +
          "removed) but NOT for cloning a space that is still live elsewhere in the same database. To " +
          "copy this space's current content into another space, use `busabase-cli export` (writes a " +
          "readable package) followed by `busabase-cli install` (installs it as reviewable Change " +
          "Requests) instead.",
      });
    }
    throw error;
  }

  const seen = session.insertedIds.get(input.table) ?? new Set<string>();
  for (const row of rowsToInsert) seen.add((row as Record<string, unknown>).id as string);
  session.insertedIds.set(input.table, seen);

  // Report what was actually written, not what was offered. Under `--resume`
  // these differ, and a count that always echoed the request size is how a
  // restore that inserted nothing still printed a full-looking summary.
  return { inserted: rowsToInsert.length };
};

/**
 * `inArray(column, ids)` with `ids` in the hundreds of thousands blows the
 * SQL query builder's own call stack (`RangeError: Maximum call stack size
 * exceeded`, reproduced live committing a real production restore with
 * 1,080,685 `fieldValues` rows — every check below queries by exactly the
 * full set of ids a session just inserted). Chunk the id list and run one
 * query per chunk instead of one query for everything; a bounded loop, not
 * a query builder that has to be stack-safe for arbitrary input.
 */
const ORPHAN_CHECK_CHUNK_SIZE = 2000;

// Exported for `dump-logic.test.ts` only.
export const queryInChunks = async <Row>(
  ids: string[],
  runQuery: (idsChunk: string[]) => Promise<Row[]>,
): Promise<Row[]> => {
  const rows: Row[] = [];
  for (let i = 0; i < ids.length; i += ORPHAN_CHECK_CHUNK_SIZE) {
    rows.push(...(await runQuery(ids.slice(i, i + ORPHAN_CHECK_CHUNK_SIZE))));
  }
  return rows;
};

/**
 * How many storage existence checks may be in flight at once.
 *
 * These are HEAD requests against object storage, one per imported attachment
 * — 10,486 of them on a real production restore, previously issued strictly
 * one at a time inside the single `importCommit` request. Serialized, that is
 * the slowest part of finalizing a large restore by a wide margin, and it is
 * pure latency: nothing about the check depends on the previous one.
 */
const STORAGE_CHECK_CONCURRENCY = 16;

/**
 * Which of `keys` have no bytes in storage. Order of the result does not
 * matter (it is only counted), so this fans out in fixed-size waves rather
 * than preserving input order.
 */
export const findMissingObjects = async (keys: string[]): Promise<string[]> => {
  const missing: string[] = [];
  for (let i = 0; i < keys.length; i += STORAGE_CHECK_CONCURRENCY) {
    const wave = keys.slice(i, i + STORAGE_CHECK_CONCURRENCY);
    const present = await Promise.all(wave.map((key) => storage.objectExists(key)));
    wave.forEach((key, index) => {
      if (!present[index]) missing.push(key);
    });
  }
  return missing;
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
  const rows = await queryInChunks([...fieldValueIds], (idsChunk) =>
    db
      .select({ id: busabaseFieldValues.id, fieldId: busabaseFieldValues.fieldId })
      .from(busabaseFieldValues)
      .where(
        and(eq(busabaseFieldValues.spaceId, spaceId), inArray(busabaseFieldValues.id, idsChunk)),
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
  const links = await queryInChunks([...linkIds], (idsChunk) =>
    db
      .select({
        id: busabaseRecordLinks.id,
        sourceRecordId: busabaseRecordLinks.sourceRecordId,
        targetRecordId: busabaseRecordLinks.targetRecordId,
      })
      .from(busabaseRecordLinks)
      .where(
        and(eq(busabaseRecordLinks.spaceId, spaceId), inArray(busabaseRecordLinks.id, idsChunk)),
      ),
  );
  if (links.length === 0) return [];
  const recordIds = new Set<string>();
  for (const link of links) {
    recordIds.add(link.sourceRecordId);
    recordIds.add(link.targetRecordId);
  }
  const existing = await queryInChunks([...recordIds], (idsChunk) =>
    db
      .select({ id: busabaseRecords.id })
      .from(busabaseRecords)
      .where(and(eq(busabaseRecords.spaceId, spaceId), inArray(busabaseRecords.id, idsChunk))),
  );
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
  const assets = await queryInChunks([...assetIds], (idsChunk) =>
    db
      .select({ id: busabaseAssets.id, attachmentId: busabaseAssets.attachmentId })
      .from(busabaseAssets)
      .where(and(eq(busabaseAssets.spaceId, spaceId), inArray(busabaseAssets.id, idsChunk))),
  );
  if (assets.length === 0) return [];
  const attachmentIds = [...new Set(assets.map((asset) => asset.attachmentId))];
  const existing = await queryInChunks(attachmentIds, (idsChunk) =>
    db.select({ id: attachments.id }).from(attachments).where(inArray(attachments.id, idsChunk)),
  );
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
  const rows = await queryInChunks([...attachmentIds], (idsChunk) =>
    db
      .select({ id: attachments.id, storageKey: attachments.storageKey })
      .from(attachments)
      .where(inArray(attachments.id, idsChunk)),
  );
  const missing = await findMissingObjects(rows.map((row) => row.storageKey));
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
  const rows = await queryInChunks([...assetTextIds], (idsChunk) =>
    db
      .select({
        id: busabaseAssetTexts.id,
        status: busabaseAssetTexts.status,
        textStorageKey: busabaseAssetTexts.textStorageKey,
      })
      .from(busabaseAssetTexts)
      .where(
        and(eq(busabaseAssetTexts.spaceId, spaceId), inArray(busabaseAssetTexts.id, idsChunk)),
      ),
  );
  const missing = await findMissingObjects(
    rows
      .filter((row) => row.status !== "none" && row.textStorageKey !== "")
      .map((row) => row.textStorageKey),
  );
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
  const db = await getDb();
  const spaceId = session.spaceId;

  if (!session.insertedIds.has("nodes")) {
    // Under `--resume` this session legitimately adds no nodes — the killed
    // run already landed them, and re-offering the same rows inserts nothing.
    // Asking the session alone then produced "the space will remain empty" on
    // a resume that had just restored the space completely. Ask the SPACE.
    const [anyNode] = session.resume
      ? await db
          .select({ id: busabaseNodes.id })
          .from(busabaseNodes)
          .where(
            and(
              eq(busabaseNodes.spaceId, spaceId),
              ne(busabaseNodes.id, rootNodeIdForSpace(spaceId)),
            ),
          )
          .limit(1)
      : [];
    if (!anyNode) {
      warnings.push("No nodes were imported in this session — the space will remain empty.");
    }
  }
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

  // A resumed restore must never roll back. Its whole purpose is to build on
  // rows a previous, killed attempt already landed, and this session only
  // knows about the ones IT inserted — so rolling back would delete the newly
  // recovered progress while leaving the older rows, moving the restore
  // backwards and stranding it in a state neither run can finish. The CLI
  // already skips calling this under `--resume`; refuse here too so a direct
  // API caller cannot do it either.
  if (session.resume) {
    sessions.delete(sessionId);
    return { ok: true };
  }

  // Best-effort cleanup, children before parents (reverse of import order).
  // Only ever touches rows this session itself inserted, in the space that
  // was validated empty at `importBegin` — never a blanket space wipe.
  for (const table of [...DUMP_IMPORT_ORDER].reverse()) {
    const ids = session.insertedIds.get(table);
    if (!ids || ids.size === 0) continue;
    const drizzleTable = DUMP_TABLE_REGISTRY[table];
    // Chunked `inArray`, not one DELETE per id. A restore of the validated
    // production space inserts 1,473,822 rows, so the old per-row loop meant
    // that many sequential round trips to undo it — hours, on the error path
    // that runs precisely when a restore has already gone wrong. Reuses the
    // same chunk size as the integrity queries so a single statement can never
    // grow an unbounded parameter list.
    const idList = [...ids];
    for (let i = 0; i < idList.length; i += ORPHAN_CHECK_CHUNK_SIZE) {
      const chunk = idList.slice(i, i + ORPHAN_CHECK_CHUNK_SIZE);
      await db.delete(drizzleTable as never).where(inArray(drizzleTable.id, chunk));
    }
  }

  sessions.delete(sessionId);
  return { ok: true };
};
