import "server-only";

import { createHash } from "node:crypto";
import { ORPCError } from "@orpc/server";
import type {
  ImportBeginInput,
  ImportCommitVO,
  ImportTablesInput,
  ImportTablesVO,
} from "busabase-contract/domains/dump/types";
import { type DumpTable, DumpTableSchema } from "busabase-contract/domains/dump/types";
import {
  and,
  asc,
  count,
  eq,
  getTableColumns,
  gt,
  inArray,
  isNull,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getAttachmentUploadPolicy } from "open-domains/attachments/logic";
import { storage } from "openlib/storage";
import { getContextSpaceId, resolveActorId } from "../../../context";
import { getDb } from "../../../db";
import {
  attachments,
  busabaseAssets,
  busabaseAssetTexts,
  busabaseBases,
  busabaseFieldValues,
  busabaseNodes,
  busabaseRecordLinks,
  busabaseRecords,
  busabaseViews,
} from "../../../db/schema";
import { CURRENT_USER_ID, id as generateId, now, rootNodeIdForSpace } from "../../../logic/kernel";
import { assertNodeStorageId } from "../../../logic/node-storage-key";
import { ensureReady } from "../../../logic/seed";
import {
  objectIsStillReferenced,
  withStorageKeyLocks,
  withStorageKeyRegistration,
} from "../../assets/logic/storage-cleanup-logic";
import { insertDefaultGridView } from "../../base/logic/default-view";
import { writeDocBody } from "../../doc/handlers";
import { folderReadmeKeys, writeFolderBody } from "../../folder/handlers";
import { richNodeDocumentKey } from "../../rich-node/handlers";
import { requireSpaceManagerForDump } from "./_guard";
import {
  assertReplayTableCounts,
  fingerprintReplayTable,
  normalizeReplayCounts,
  ReplayIdentityFingerprint,
  type ReplayTableCounts,
} from "./import-replay-control";
import {
  assertImportReplayRowsMatch,
  coerceDateColumns,
  datePreservingColumns,
} from "./import-row-values";
import {
  assertRestoreActivity,
  assertRestoreArchiveIdentity,
  beginRestoreActivity,
  endRestoreActivity,
  markRestoreRootImported,
  restoreActivityKey,
} from "./restore-activity";
import {
  assertRestoreBlobKey,
  RESTORE_BLOB_PART_BYTES,
  RestoreBlobParts,
} from "./restore-blob-parts";
import { cleanupAbandonedRestoreBlobs } from "./restore-blob-receipts";
import { prepareWebhookBackupRow, webhookNeedsReconnect } from "./row-policy";
import {
  assertDumpChildParents,
  DUMP_IMPORT_ORDER,
  DUMP_TABLE_REGISTRY,
  dumpIdentityColumn,
  dumpIdentityKey,
  dumpSpaceScope,
  stampDumpRow,
} from "./table-registry";

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
 * SQL progress is recovered from the archive and existing rows. Multipart
 * upload ids additionally have durable scoped storage receipts: a fresh session
 * cleans abandoned provider parts before starting its own byte replay.
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
  lastActivityAt: number;
  blobParts: RestoreBlobParts;
  insertedIds: Map<string, Set<string>>;
  /**
   * Continuing an interrupted restore. Inserts become `ON CONFLICT DO
   * NOTHING`, and `importAbort` refuses to run — see both call sites.
   */
  resume: boolean;
  offeredNodes: boolean;
  originalRoot?: Record<string, unknown>;
  canInitializeRoot: boolean;
  preserveViewMetadata: boolean;
  sourceArchiveChecksum?: string;
  expectedTables?: ReplayTableCounts;
  validation: Map<
    DumpTable,
    {
      source: ReplayIdentityFingerprint;
      existing: ReplayIdentityFingerprint;
      complete: boolean;
      lastBatchHash?: string;
    }
  >;
  writtenIdentities: Map<
    DumpTable,
    { fingerprint: ReplayIdentityFingerprint; lastBatchHash?: string }
  >;
  notices: Set<string>;
  rootBodyHashes: Map<string, Set<string>>;
  /** Exact fresh-session creations only; crash/resume keeps earlier progress. */
  newPromotedObjects: Map<string, { sizeBytes: number; sha256: string }>;
  aborting: boolean;
}

const SESSION_TTL_MS = 60 * 60 * 1000; // 1h — generous for a large space import.
const sessions = new Map<string, ImportSession>();

const sweepExpiredSessions = async () => {
  const time = Date.now();
  for (const [sessionId, session] of sessions) {
    if (time - session.lastActivityAt > SESSION_TTL_MS) {
      sessions.delete(sessionId);
      await session.blobParts.cleanup();
    }
  }
};

const requireSession = async (sessionId: string): Promise<ImportSession> => {
  await sweepExpiredSessions();
  const session = sessions.get(sessionId);
  if (!session)
    throw new ORPCError("NOT_FOUND", {
      message: `Import session not found or expired: ${sessionId}`,
    });
  if (session.spaceId !== getContextSpaceId())
    throw new ORPCError("BAD_REQUEST", { message: "Import session belongs to a different space." });
  await assertRestoreActivity(session.spaceId, session.id);
  session.lastActivityAt = Date.now();
  return session;
};

export const beginImportSession = async (
  input: ImportBeginInput,
): Promise<{ sessionId: string; blobChunkProtocol: 1; exactReplayProtocol: 1 }> => {
  requireSpaceManagerForDump();
  if (input.resume && (!input.sourceArchiveChecksum || !input.expectedTables))
    throw new ORPCError("BAD_REQUEST", {
      message:
        "Exact resume requires a verified archive checksum and SQL inventory. Upgrade the CLI and replay the same archive.",
    });
  if (!!input.sourceArchiveChecksum !== !!input.expectedTables)
    throw new ORPCError("BAD_REQUEST", {
      message: "Provide the verified archive checksum and SQL inventory together",
    });
  await sweepExpiredSessions();
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
  const expectedTables = input.expectedTables
    ? normalizeReplayCounts(input.expectedTables)
    : undefined;
  const identity = {
    spaceId,
    sourceSpaceId: input.sourceSpaceId,
    resume: input.resume,
    sourceArchiveChecksum: input.sourceArchiveChecksum,
    preserveViewMetadata: input.preserveViewMetadata,
    expectedTables,
  };
  await assertRestoreArchiveIdentity(db, identity);
  if (input.resume && expectedTables)
    await assertReplayTableCounts(db, spaceId, expectedTables, false);

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
    // Singleton preferences and historical/runtime rows are durable user data
    // too. A root-only tree does not authorize overwriting an existing workspace.
    for (const table of DUMP_IMPORT_ORDER) {
      if (table === "nodes") continue;
      const [row] = await db
        .select({ id: dumpIdentityColumn(table) })
        .from(DUMP_TABLE_REGISTRY[table] as never)
        .where(dumpSpaceScope(db, table, spaceId))
        .limit(1);
      if (row)
        throw new ORPCError("BAD_REQUEST", {
          message: `Full-fidelity import requires an empty target space (table "${table}" is not empty). Use --resume only for the same interrupted archive.`,
        });
    }
  }

  if (!input.resume && !(await isPristineRootOnly(db, spaceId)))
    throw new ORPCError("BAD_REQUEST", {
      message:
        "Full-fidelity import requires an untouched seed root with no readme. Existing root data was not overwritten; use a genuinely empty target.",
    });
  const sessionId = generateId("dumpsess");
  const activity = await beginRestoreActivity(db, {
    ...identity,
    spaceId,
    sessionId,
    sourceSpaceId: input.sourceSpaceId,
    resume: input.resume,
  });
  await cleanupAbandonedRestoreBlobs(spaceId, new Set(sessions.keys()));
  // Explicit resume supersedes a previous owner. Its in-process SQL progress
  // stays, while staged multipart bytes must not remain pinned by a fenced
  // session that can no longer receive another request.
  for (const [previousId, previous] of sessions) {
    if (previous.spaceId !== spaceId) continue;
    sessions.delete(previousId);
    await previous.blobParts.cleanup();
  }
  sessions.set(sessionId, {
    id: sessionId,
    spaceId,
    sourceSpaceId: input.sourceSpaceId,
    lastActivityAt: Date.now(),
    blobParts: new RestoreBlobParts(sessionId, spaceId),
    insertedIds: new Map(),
    resume: input.resume,
    offeredNodes: false,
    notices: new Set(),
    canInitializeRoot: activity.canInitializeRoot,
    preserveViewMetadata: input.preserveViewMetadata,
    sourceArchiveChecksum: input.sourceArchiveChecksum,
    expectedTables,
    validation: new Map(),
    writtenIdentities: new Map(),
    rootBodyHashes: new Map(),
    newPromotedObjects: new Map(),
    aborting: false,
  });
  return { sessionId, blobChunkProtocol: 1, exactReplayProtocol: 1 };
};

/** A Cloud restore must never overwrite an object another tenant references. */
const validateAttachmentRestoreKey = async (
  db: Pick<Awaited<ReturnType<typeof getDb>>, "select">,
  storageKey: string,
  spaceId: string,
) => {
  if (
    typeof storageKey !== "string" ||
    !storageKey.startsWith("attachments/") ||
    storageKey.split("/").includes("..") ||
    storageKey.includes("\\") ||
    storageKey.includes("\0")
  ) {
    throw new ORPCError("BAD_REQUEST", { message: "Invalid attachment restore storage key" });
  }
  const references = await db
    .select({
      spaceId: attachments.spaceId,
      sizeBytes: attachments.sizeBytes,
      contentHash: attachments.contentHash,
    })
    .from(attachments)
    .where(eq(attachments.storageKey, storageKey));
  if (references.some((row) => row.spaceId !== spaceId)) {
    throw new ORPCError("FORBIDDEN", {
      message: "Cannot restore an attachment object referenced by another space",
    });
  }
  return references;
};

const assertAttachmentRestoreContent = (
  references: Array<{ sizeBytes: number; contentHash: string | null }>,
  sizeBytes: number,
  sha256: string,
) => {
  for (const reference of references) {
    const registeredHash = reference.contentHash
      ?.match(/^(?:sha256:)?([a-f0-9]{64})$/i)?.[1]
      .toLowerCase();
    if (registeredHash && registeredHash !== sha256)
      throw new ORPCError("BAD_REQUEST", {
        message: "Restored object hash conflicts with its existing attachment registry",
      });
    // Some original images have a stale size statistic. Preserve that PO
    // exactly only when its explicit SHA proves the incoming content matches.
    if (reference.sizeBytes !== sizeBytes && registeredHash !== sha256)
      throw new ORPCError("BAD_REQUEST", {
        message: "Restored object size conflicts with its existing attachment registry",
      });
  }
};

const verifiedExistingObject = async (
  key: string,
  sizeBytes: number,
  sha256: string,
): Promise<boolean> => {
  const metadata = await storage.getObjectMetadata(key);
  if (!metadata || metadata.size !== sizeBytes) return false;
  const hash = createHash("sha256");
  for (let start = 0; start < sizeBytes; start += RESTORE_BLOB_PART_BYTES) {
    const end = Math.min(start + RESTORE_BLOB_PART_BYTES, sizeBytes) - 1;
    const bytes = await storage.getObjectRange(key, start, end);
    if (bytes.length !== end - start + 1) return false;
    hash.update(bytes);
  }
  return hash.digest("hex") === sha256;
};

/** Inspect SQL only: uploaded but unregistered bytes are not workspace rows. */
const isSqlRootOnly = async (
  db: Awaited<ReturnType<typeof getDb>>,
  spaceId: string,
): Promise<boolean> => {
  for (const tableName of DUMP_IMPORT_ORDER) {
    const table = DUMP_TABLE_REGISTRY[tableName];
    const [row] = await db
      .select({ id: dumpIdentityColumn(tableName) })
      .from(table as never)
      .where(
        and(
          dumpSpaceScope(db, tableName, spaceId),
          tableName === "nodes" ? ne(busabaseNodes.id, rootNodeIdForSpace(spaceId)) : undefined,
        ),
      )
      .limit(1);
    if (row) return false;
  }
  return true;
};

const isPristineRootOnly = async (
  db: Awaited<ReturnType<typeof getDb>>,
  spaceId: string,
): Promise<boolean> => {
  if (!(await isSqlRootOnly(db, spaceId))) return false;
  for (const key of folderReadmeKeys(rootNodeIdForSpace(spaceId)))
    if (await storage.getObjectMetadata(key)) return false;
  const expected = {
    id: rootNodeIdForSpace(spaceId),
    spaceId,
    parentId: null,
    type: "folder",
    slug: "root",
    name: "Workspace",
    description: "Workspace root.",
    position: 0,
    metadata: {},
    settings: {},
    agentPrompts: null,
    icon: null,
    explicitVisibility: null,
    effectiveVisibility: null,
    effectivePublicScope: null,
    effectivePublicRequiresPassword: false,
    createdBy: null,
    archivedAt: null,
    deletedAt: null,
  };
  const columns = Object.keys(getTableColumns(busabaseNodes));
  if (columns.length !== Object.keys(expected).length + 2) return false;
  const [sameSeedTime] = await db
    .select({ id: busabaseNodes.id })
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.id, expected.id),
        eq(busabaseNodes.spaceId, spaceId),
        sql`${busabaseNodes.createdAt} = ${busabaseNodes.updatedAt}`,
      ),
    );
  if (!sameSeedTime) return false;
  try {
    await assertImportReplayRowsMatch(db, "nodes", spaceId, [expected]);
    return true;
  } catch (error) {
    if (error instanceof ORPCError && error.code === "CONFLICT") return false;
    throw error;
  }
};

const validateAssetTextRestoreKey = async (
  db: Pick<Awaited<ReturnType<typeof getDb>>, "select">,
  key: string,
  spaceId: string,
): Promise<void> => {
  assertRestoreBlobKey(key, "assetTextBlobs");
  const textReferences = await db
    .select({ spaceId: busabaseAssetTexts.spaceId })
    .from(busabaseAssetTexts)
    .where(eq(busabaseAssetTexts.textStorageKey, key));
  const attachmentReferences = await db
    .select({ spaceId: attachments.spaceId })
    .from(attachments)
    .where(eq(attachments.storageKey, key));
  if (
    [...textReferences, ...attachmentReferences].some((reference) => reference.spaceId !== spaceId)
  )
    throw new ORPCError("FORBIDDEN", {
      message: "Cannot restore a text object referenced by another space",
    });
};

const validateImportedAssetTexts = async (
  db: Pick<Awaited<ReturnType<typeof getDb>>, "select">,
  spaceId: string,
  rows: Record<string, unknown>[],
  validateOnly: boolean,
): Promise<void> => {
  for (const row of rows) {
    if (typeof row.assetId !== "string" || typeof row.textStorageKey !== "string")
      throw new ORPCError("BAD_REQUEST", { message: "Invalid asset text import reference" });
    const [asset] = await db
      .select({ spaceId: busabaseAssets.spaceId, attachmentId: busabaseAssets.attachmentId })
      .from(busabaseAssets)
      .where(eq(busabaseAssets.id, row.assetId));
    if ((asset && asset.spaceId !== spaceId) || (!asset && !validateOnly))
      throw new ORPCError("FORBIDDEN", {
        message: "Asset text import requires an Asset in this target space",
      });
    if (row.textStorageKey === "" && row.status === "none") continue;
    if (
      row.writtenBy === undefined ||
      row.writtenBy === "auto" ||
      row.textStorageKey.startsWith("attachments/")
    ) {
      assertRestoreBlobKey(row.textStorageKey, "attachmentBlobs");
      await validateAttachmentRestoreKey(db, row.textStorageKey, spaceId);
      if (!asset) continue;
      const [registration] = await db
        .select({ spaceId: attachments.spaceId, storageKey: attachments.storageKey })
        .from(attachments)
        .where(eq(attachments.id, asset.attachmentId));
      if (!registration && validateOnly) continue;
      if (
        !registration ||
        registration.spaceId !== spaceId ||
        registration.storageKey !== row.textStorageKey
      )
        throw new ORPCError("FORBIDDEN", {
          message: "Automatic asset text must use its own Asset attachment bytes",
        });
    } else await validateAssetTextRestoreKey(db, row.textStorageKey, spaceId);
  }
};

const validationState = (session: ImportSession, table: DumpTable) => {
  let state = session.validation.get(table);
  if (!state) {
    state = {
      source: new ReplayIdentityFingerprint(),
      existing: new ReplayIdentityFingerprint(),
      complete: false,
    };
    session.validation.set(table, state);
  }
  return state;
};
const allTablesValidated = (session: ImportSession): boolean =>
  DumpTableSchema.options.every((table) => session.validation.get(table)?.complete === true);
const batchIdentity = (rows: Record<string, unknown>[]): string =>
  createHash("sha256").update(JSON.stringify(rows)).digest("hex");
const rememberWrittenIdentities = (
  session: ImportSession,
  table: DumpTable,
  ids: string[],
  hash: string,
) => {
  let state = session.writtenIdentities.get(table);
  if (!state) {
    state = { fingerprint: new ReplayIdentityFingerprint() };
    session.writtenIdentities.set(table, state);
  }
  if (state.lastBatchHash === hash) return;
  for (const id of ids) state.fingerprint.add(id);
  state.lastBatchHash = hash;
};

export const importTableRows = async (input: ImportTablesInput): Promise<ImportTablesVO> => {
  requireSpaceManagerForDump();
  const session = await requireSession(input.sessionId);
  if (session.aborting)
    throw new ORPCError("CONFLICT", {
      message: "This import is aborting; finish its cleanup or resume in a new session",
    });
  const spaceId = getContextSpaceId();
  if (spaceId !== session.spaceId) {
    throw new ORPCError("BAD_REQUEST", { message: "Import session belongs to a different space." });
  }
  if (input.rowsJson !== undefined) {
    if (input.rows.length || !DumpTableSchema.safeParse(input.table).success)
      throw new ORPCError("BAD_REQUEST", {
        message: "Opaque rowsJson is only for SQL rows and cannot be combined with rows",
      });
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.rowsJson);
    } catch {
      throw new ORPCError("BAD_REQUEST", {
        message: "SQL replay JSON must contain an array of plain row objects",
      });
    }
    if (
      !Array.isArray(parsed) ||
      parsed.some(
        (row) =>
          !row ||
          typeof row !== "object" ||
          Array.isArray(row) ||
          Object.getPrototypeOf(row) !== Object.prototype,
      )
    )
      throw new ORPCError("BAD_REQUEST", {
        message: "SQL replay JSON must contain an array of plain row objects",
      });
    input = { ...input, rows: parsed as Record<string, unknown>[] };
  }
  if (input.validationComplete && !input.validateOnly)
    throw new ORPCError("BAD_REQUEST", { message: "validationComplete requires validateOnly" });
  if (input.validateOnly) {
    const parsed = DumpTableSchema.safeParse(input.table);
    if (!parsed.success || !session.expectedTables)
      throw new ORPCError("BAD_REQUEST", {
        message: "Read-only preflight requires a SQL table and archive inventory",
      });
    const state = validationState(session, parsed.data);
    if (input.validationComplete) {
      if (input.rows.length || state.source.count !== session.expectedTables[parsed.data])
        throw new ORPCError("CONFLICT", { message: `Incomplete SQL preflight for ${parsed.data}` });
      const actual = await fingerprintReplayTable(await getDb(), parsed.data, spaceId);
      if (!actual.equals(state.existing))
        throw new ORPCError("CONFLICT", {
          message: `Target ${parsed.data} contains an extra or unvalidated row; no replay objects were written`,
        });
      state.complete = true;
      return {
        inserted: 0,
        validated: true,
        validationComplete: true,
        validatedRows: state.source.count,
      };
    }
    if (state.complete)
      throw new ORPCError("BAD_REQUEST", { message: "SQL table preflight is already complete" });
    if (!input.rows.length)
      return {
        inserted: 0,
        validated: true,
        validationComplete: false,
        validatedRows: state.source.count,
      };
  } else if (session.resume && !allTablesValidated(session)) {
    throw new ORPCError("PRECONDITION_FAILED", {
      message: "Complete read-only SQL preflight for all tables before replaying any row or object",
    });
  }
  if (input.rows.length === 0) return { inserted: 0 };

  if (input.table === "docBodies") {
    // Doc bodies AND folder readmes (`dump.exportDocBodies` serves both), so
    // the node's restored type decides the key — and, for a folder, the row's
    // `bodyFormat` picks `readme.md` or `readme.html`. Imported after every
    // table, so the `nodes` rows already exist here.
    //
    // The lookup is scoped to this space on purpose: the key is derived from
    // a caller-supplied id, and without it the manager of one space could
    // overwrite another space's Doc body by naming its node id. Same rule
    // `validateAttachmentRestoreKey` enforces for attachment bytes.
    //
    // The source workspace root is never re-inserted (see the `nodes` remap
    // below), so a readme on it lands on this space's own root.
    const rootId = rootNodeIdForSpace(spaceId);
    const sourceRootId = rootNodeIdForSpace(session.sourceSpaceId);
    for (const row of input.rows) assertNodeStorageId(row.nodeId);
    const rows = input.rows.map((row) => ({
      nodeId: row.nodeId === sourceRootId ? rootId : (row.nodeId as string),
      markdown: row.markdown as string,
      nodeType: row.nodeType,
      // Only an HTML folder readme carries a format; everything else is Markdown.
      bodyFormat: row.bodyFormat === "html" ? ("html" as const) : ("markdown" as const),
    }));
    const db = await getDb();
    const targets = await db
      .select({ id: busabaseNodes.id, type: busabaseNodes.type })
      .from(busabaseNodes)
      .where(
        and(
          eq(busabaseNodes.spaceId, spaceId),
          inArray(
            busabaseNodes.id,
            rows.map((row) => row.nodeId),
          ),
        ),
      );
    const typeById = new Map(targets.map((target) => [target.id, target.type]));
    const stray = rows.find((row) => {
      const type = typeById.get(row.nodeId);
      const richType = type === "html" || type === "whiteboard" || type === "workflow";
      return (
        (type !== "doc" && type !== "folder" && !richType) ||
        (richType && row.nodeType !== type) ||
        (!richType && row.nodeType !== undefined) ||
        typeof row.markdown !== "string"
      );
    });
    if (stray) {
      throw new ORPCError("BAD_REQUEST", {
        message: `docBodies row names node ${stray.nodeId}, which is not a matching document node in this space`,
      });
    }
    const htmlDoc = rows.find(
      (row) => row.bodyFormat === "html" && typeById.get(row.nodeId) === "doc",
    );
    if (htmlDoc) {
      throw new ORPCError("BAD_REQUEST", {
        message: `docBodies row for node ${htmlDoc.nodeId} is HTML, but only a folder readme can be HTML`,
      });
    }
    for (const row of rows) {
      const type = typeById.get(row.nodeId);
      if (type === "html" || type === "whiteboard" || type === "workflow") {
        // Restore the exact raw object, including JSON whitespace. Parsing and
        // reserializing would change bytes and can discard older document keys.
        await storage.uploadFileToKey(
          Buffer.from(row.markdown, "utf8"),
          richNodeDocumentKey(row.nodeId, type),
          type === "html" ? "text/html; charset=utf-8" : "application/json",
        );
      } else if (type === "folder") {
        if (!session.resume && row.nodeId === rootNodeIdForSpace(spaceId)) {
          const key = folderReadmeKeys(row.nodeId)[row.bodyFormat === "html" ? 1 : 0];
          const hashes = session.rootBodyHashes.get(key) ?? new Set<string>();
          hashes.add(createHash("sha256").update(row.markdown, "utf8").digest("hex"));
          session.rootBodyHashes.set(key, hashes);
        }
        await writeFolderBody(row.nodeId, row.markdown, row.bodyFormat);
      } else await writeDocBody(row.nodeId, row.markdown);
    }
    return { inserted: rows.length };
  }

  if (input.table === "attachmentBlobs" || input.table === "assetTextBlobs") {
    const table = input.table;
    const chunked = input.rows.some((row) => row.chunk !== undefined);
    if (chunked && (input.rows.length !== 1 || input.rows[0].chunk === undefined))
      throw new ORPCError("BAD_REQUEST", {
        message: "A restore blob chunk request must contain exactly one part",
      });
    const db = await getDb();
    let inserted = 0;
    for (const row of input.rows) {
      const key = assertRestoreBlobKey(
        table === "attachmentBlobs" ? row.storageKey : row.textStorageKey,
        table,
      );
      const mimeType =
        table === "attachmentBlobs"
          ? typeof row.mimeType === "string"
            ? row.mimeType
            : "application/octet-stream"
          : "text/plain; charset=utf-8";
      const validate = async (sizeBytes: number, sha256: string) => {
        if (session.aborting)
          throw new ORPCError("CONFLICT", {
            message: "This import is aborting; no further objects may be published",
          });
        if (table === "assetTextBlobs") {
          await validateAssetTextRestoreKey(db, key, spaceId);
          return;
        }
        const references = await validateAttachmentRestoreKey(db, key, spaceId);
        const knownHash = (value: string | null) =>
          value?.match(/^(?:sha256:)?([a-f0-9]{64})$/i)?.[1].toLowerCase();
        const unknownSize = references.some(
          (reference) => reference.sizeBytes !== sizeBytes && !knownHash(reference.contentHash),
        );
        const conflict = references.some((reference) => {
          const hash = knownHash(reference.contentHash);
          return hash && hash !== sha256;
        });
        if (unknownSize && !conflict && (await verifiedExistingObject(key, sizeBytes, sha256)))
          return true; // Already correct: never rewrite an unknown-hash/stale-statistic object.
        assertAttachmentRestoreContent(references, sizeBytes, sha256);
        const policy = getAttachmentUploadPolicy();
        if (policy && references.length === 0)
          await policy.checkUpload({
            input: {
              spaceId,
              fileName: key.split("/").at(-1) || "restored-file",
              mimeType,
              sizeBytes,
            },
            userId: resolveActorId(CURRENT_USER_ID),
            db,
            attachmentsTable: attachments,
          });
      };
      const promote = async (stagingKey: string, sizeBytes: number, sha256: string) => {
        await withStorageKeyRegistration(
          db,
          key,
          async (tx) => {
            await assertRestoreActivity(spaceId, session.id);
            if (session.aborting)
              throw new ORPCError("CONFLICT", {
                message: "This import is aborting; no further objects may be published",
              });
            if (table === "attachmentBlobs") {
              assertAttachmentRestoreContent(
                await validateAttachmentRestoreKey(tx, key, spaceId),
                sizeBytes,
                sha256,
              );
            } else {
              await validateAssetTextRestoreKey(tx, key, spaceId);
            }
            // A strict metadata read distinguishes absent from provider errors.
            // Record before copying so a copy that publishes then throws can
            // still be cleaned by an explicit abort. Never claim an old key.
            if (!session.resume && !(await storage.getObjectMetadata(key))) {
              session.newPromotedObjects.set(key, { sizeBytes, sha256 });
            }
            await storage.copyObject(stagingKey, key);
          },
          { additionalLockKeys: [restoreActivityKey(spaceId)] },
        );
      };
      const common = { key, mimeType, base64: row.base64, validate, promote };
      // Older inline requests use the same private staging and final fence as
      // current chunked uploads. Neither route overwrites before validation.
      const complete = chunked
        ? await session.blobParts.accept({ ...common, chunk: row.chunk })
        : await session.blobParts.acceptInline(common);
      if (complete) inserted++;
    }
    return { inserted };
  }

  const tableName = input.table;
  if (tableName === "nodes") for (const row of input.rows) assertNodeStorageId(row.id);
  const identityKeyForInput = dumpIdentityKey(tableName);
  const offeredIds = input.rows.map((row) => {
    let id = row[identityKeyForInput];
    if (identityKeyForInput === "spaceId") id = spaceId;
    if (
      tableName === "nodes" &&
      (id === rootNodeIdForSpace(session.sourceSpaceId) || id === rootNodeIdForSpace(spaceId))
    )
      id = rootNodeIdForSpace(spaceId);
    if (typeof id !== "string" || !id)
      throw new ORPCError("BAD_REQUEST", { message: "Invalid archive row identity" });
    return id;
  });
  if (new Set(offeredIds).size !== offeredIds.length)
    throw new ORPCError("BAD_REQUEST", { message: "Archive batch has duplicate row identities" });
  const replayBatchHash = batchIdentity(input.rows);
  const preflight = input.validateOnly ? validationState(session, tableName) : undefined;
  const preflightRetry = preflight?.lastBatchHash === replayBatchHash;
  const declaredRows = session.expectedTables?.[tableName];
  if (
    preflight &&
    !preflightRetry &&
    (declaredRows === undefined || preflight.source.count + offeredIds.length > declaredRows)
  )
    throw new ORPCError("CONFLICT", {
      message: `SQL preflight exceeds archive inventory for ${tableName}`,
    });
  let validatedRootId: string | undefined;
  const table = DUMP_TABLE_REGISTRY[tableName];
  const columns = getTableColumns(table as never);
  // Drizzle ignores extra properties. Validate the entire raw batch before
  // root-row filtering or remapping can hide an unsupported archive column.
  // Values inside a known JSONB column remain opaque and are never filtered.
  for (const row of input.rows) {
    const unknown = Object.keys(row).filter((key) => !Object.hasOwn(columns, key));
    if (unknown.length > 0)
      throw new ORPCError("BAD_REQUEST", {
        message: `Cannot restore ${input.table} row ${String(row.id)}: unknown archive column(s) ${unknown.join(", ")}. The archive schema is newer or different; update the target server before retrying.`,
      });
  }
  const db = await getDb();

  // Rows come straight from an export archive: they already carry `spaceId`
  // from the *source* space. Re-stamp with the *target* (current context)
  // space so a restore into a different space id stays self-consistent.
  let rows = input.rows;
  const revokedByRestore = new Set<string>();
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
    const sourceRoot = rows.find((row) => row.id === sourceRootId);
    const legacyRoot = !sourceRoot ? rows.find((row) => row.id === rootId) : undefined;
    if (sourceRoot && sourceRootId !== rootId && rows.some((row) => row.id === rootId))
      throw new ORPCError("CONFLICT", {
        message:
          "Archive contains an additional node using the target root id; it cannot be restored without losing a node",
      });
    const archivedRoot = sourceRoot ?? legacyRoot;
    if (archivedRoot) {
      if (
        archivedRoot.type !== "folder" ||
        (archivedRoot.parentId !== null && archivedRoot.parentId !== undefined)
      )
        throw new ORPCError("BAD_REQUEST", {
          message: "Archive node collides with the workspace root identity",
        });
      const mappedRoot = { ...archivedRoot, id: rootId, spaceId };
      let needsCopy = !session.resume;
      if (session.resume) {
        try {
          await assertImportReplayRowsMatch(db, "nodes", spaceId, [mappedRoot]);
        } catch (error) {
          if (!(error instanceof ORPCError) || error.code !== "CONFLICT") throw error;
          if (!session.canInitializeRoot || !(await isPristineRootOnly(db, spaceId)))
            throw new ORPCError("CONFLICT", {
              message:
                "Cannot resume: the workspace root differs from the archive. It was not overwritten. " +
                "If only an untouched seed root remains, abort this session and run a fresh restore; " +
                "otherwise use an empty target or the same unchanged archive.",
            });
          needsCopy = true;
        }
      }
      if (needsCopy && !input.validateOnly && !session.originalRoot) {
        const [original] = await db
          .select(datePreservingColumns(busabaseNodes))
          .from(busabaseNodes)
          .where(and(eq(busabaseNodes.id, rootId), eq(busabaseNodes.spaceId, spaceId)));
        session.originalRoot = original;
      }
      if (!input.validateOnly)
        await markRestoreRootImported(db, { spaceId, sessionId: session.id });
      const {
        id: _id,
        spaceId: _space,
        ...content
      } = coerceDateColumns(busabaseNodes, archivedRoot);
      if (needsCopy && !input.validateOnly)
        await db
          .update(busabaseNodes)
          .set(content)
          .where(and(eq(busabaseNodes.id, rootId), eq(busabaseNodes.spaceId, spaceId)));
      if (input.validateOnly) validatedRootId = rootId;
      else {
        session.canInitializeRoot = false;
        session.offeredNodes = true;
      }
    }
    rows = rows
      .filter((row) => row.id !== sourceRootId && row.id !== rootId)
      .map((row) => (row.parentId === sourceRootId ? { ...row, parentId: rootId } : row));
  }
  const sourceRootId = rootNodeIdForSpace(session.sourceSpaceId);
  const targetRootId = rootNodeIdForSpace(spaceId);
  rows = rows.map((row) => {
    const mapped = { ...row };
    // Actual node references, never arbitrary user JSON or free-form text.
    for (const key of ["nodeId", "sourceNodeId"])
      if (Object.hasOwn(columns, key) && mapped[key] === sourceRootId) mapped[key] = targetRootId;
    if (input.table === "embedLinks" && mapped.type === "node" && mapped.typeId === sourceRootId)
      mapped.typeId = targetRootId;
    return mapped;
  });
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
  if (input.table === "webhookRules")
    rows = rows.map((row) => {
      const safe = prepareWebhookBackupRow(row);
      if (webhookNeedsReconnect(safe))
        session.notices.add(
          `Webhook rule ${String(row.id)} was restored disabled because its dedicated signing credential is excluded; reconnect it before enabling.`,
        );
      return safe;
    });
  if (input.table === "routerGrants")
    rows = rows.map((row) => {
      if (row.revokedAt != null) return row;
      if (row.revokedAt === null) revokedByRestore.add(String(row.id));
      session.notices.add(
        `Router grant ${String(row.id)} was restored revoked because Vault credentials are excluded; reconnect the external agent.`,
      );
      return { ...row, revokedAt: new Date() };
    });
  if (input.table === "embedLinks")
    rows = rows.map((row) => {
      if (
        row.revokedAt != null ||
        new Date(row.expiresAt as string | number | Date).getTime() <= Date.now()
      )
        return row;
      if (row.revokedAt === null) revokedByRestore.add(String(row.id));
      session.notices.add(
        `Embed link ${String(row.id)} was restored revoked because source authentication credentials are excluded; create a new capability link.`,
      );
      return { ...row, revokedAt: new Date() };
    });
  const identityKey = dumpIdentityKey(input.table);
  const identityColumn = dumpIdentityColumn(input.table);
  const stampedRows = rows.map((row) =>
    coerceDateColumns(table, stampDumpRow(tableName, row, spaceId)),
  );
  if (tableName === "assets") {
    const attachmentIds = [...new Set(stampedRows.map((row) => row.attachmentId))];
    if (attachmentIds.some((id) => typeof id !== "string" || !id))
      throw new ORPCError("BAD_REQUEST", {
        message: "Asset import has an invalid attachment reference",
      });
    const registrations = await queryInChunks(attachmentIds as string[], (ids) =>
      db
        .select({ spaceId: attachments.spaceId })
        .from(attachments)
        .where(inArray(attachments.id, ids)),
    );
    if (registrations.some((row) => row.spaceId !== spaceId))
      throw new ORPCError("FORBIDDEN", {
        message:
          "Asset import cannot adopt an existing foreign or unassigned attachment registration; import its owned content-copy registration first",
      });
  }

  if (tableName === "attachments")
    for (const row of stampedRows)
      await validateAttachmentRestoreKey(db, row.storageKey as string, spaceId);
  if (tableName === "assetTexts")
    await validateImportedAssetTexts(db, spaceId, stampedRows, input.validateOnly);
  if (stampedRows.length === 0) {
    if (preflight) {
      if (preflight.lastBatchHash !== replayBatchHash) {
        for (const id of offeredIds) preflight.source.add(id);
        if (validatedRootId) preflight.existing.add(validatedRootId);
      }
      preflight.lastBatchHash = replayBatchHash;
      return {
        inserted: 0,
        validated: true,
        validationComplete: false,
        validatedRows: preflight.source.count,
      };
    }
    rememberWrittenIdentities(session, tableName, offeredIds, replayBatchHash);
    return { inserted: 0 };
  }
  if (!input.validateOnly) await assertDumpChildParents(db, tableName, stampedRows, spaceId);

  let rowsToInsert = stampedRows;
  if (session.resume || input.validateOnly) {
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
    const ids = stampedRows.map((row) => row[identityKey] as string);
    const existing = await queryInChunks<{ id: string }>(
      ids,
      (chunk) =>
        db
          .select({ id: identityColumn })
          .from(table as never)
          .where(inArray(identityColumn, chunk)) as unknown as Promise<Array<{ id: string }>>,
    );
    const mine = await queryInChunks<{ id: string }>(
      ids,
      (chunk) =>
        db
          .select({ id: identityColumn })
          .from(table as never)
          .where(
            and(inArray(identityColumn, chunk), dumpSpaceScope(db, tableName, spaceId)),
          ) as unknown as Promise<Array<{ id: string }>>,
    );
    const mineIds = new Set(mine.map((row) => row.id));
    const foreign = existing.filter((row) => !mineIds.has(row.id));
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
    await assertImportReplayRowsMatch(
      db,
      tableName,
      spaceId,
      stampedRows.filter((row) => alreadyMine.has(row[identityKey] as string)),
      { revokedByRestore },
    );
    if (preflight) {
      if (preflight.lastBatchHash !== replayBatchHash) {
        for (const id of offeredIds) preflight.source.add(id);
        for (const id of alreadyMine) preflight.existing.add(id);
        if (validatedRootId) preflight.existing.add(validatedRootId);
      }
      preflight.lastBatchHash = replayBatchHash;
      return {
        inserted: 0,
        validated: true,
        validationComplete: false,
        validatedRows: preflight.source.count,
      };
    }
    rowsToInsert = stampedRows.filter((row) => !alreadyMine.has(row[identityKey] as string));
    if (rowsToInsert.length === 0) {
      rememberWrittenIdentities(session, tableName, offeredIds, replayBatchHash);
      return { inserted: 0 };
    }
  }

  try {
    const policy = input.table === "attachments" ? getAttachmentUploadPolicy() : undefined;
    if (policy) {
      // Preserve archive ids/metadata, but apply the host's actual-object check
      // and serialized quota transaction to every registry row. One outer
      // transaction makes a rejected batch atomic, including its earlier rows.
      const confirmations = rowsToInsert.map((row) => ({
        storageKey: row.storageKey as string,
        fileName: row.fileName as string,
        mimeType: row.mimeType as string,
        sizeBytes: row.sizeBytes as number,
        spaceId,
      }));
      // That transaction keeps each confirmed row's space and key locks until
      // commit, so the per-row object HEADs and plan check run here, before it
      // opens. Keys are validated first so no HEAD is issued for a bad key.
      if (policy.prepareConfirmations) {
        for (const confirmation of confirmations) {
          await validateAttachmentRestoreKey(db, confirmation.storageKey, spaceId);
        }
        await policy.prepareConfirmations(confirmations);
      }
      await db.transaction(async (tx) => {
        for (const [index, row] of rowsToInsert.entries()) {
          const confirmation = confirmations[index];
          const storageKey = confirmation.storageKey;
          await validateAttachmentRestoreKey(tx, storageKey, spaceId);
          await policy.confirmUpload(
            {
              input: confirmation,
              userId: resolveActorId(CURRENT_USER_ID),
              db: tx,
              attachmentsTable: attachments,
            },
            async (database) => {
              await database.insert(attachments).values(row);
              return {
                success: true,
                attachmentId: row.id as string,
                storageKey,
                publicUrl: storage.getPublicUrl(storageKey),
              };
            },
          );
        }
      });
    } else if (input.table === "attachments") {
      await db.transaction(async (tx) => {
        for (const row of [...rowsToInsert].sort((a, b) =>
          String(a.storageKey).localeCompare(String(b.storageKey)),
        )) {
          await withStorageKeyRegistration(tx, row.storageKey as string, async (guarded) => {
            await validateAttachmentRestoreKey(guarded, row.storageKey as string, spaceId);
            await guarded.insert(attachments).values(row as typeof attachments.$inferInsert);
          });
        }
      });
    } else if (input.table === "assetTexts") {
      await db.transaction(async (tx) => {
        for (const row of rowsToInsert) {
          const persist = async (guarded: typeof tx) => {
            await validateImportedAssetTexts(guarded, spaceId, [row], false);
            await guarded
              .insert(busabaseAssetTexts)
              .values(row as typeof busabaseAssetTexts.$inferInsert);
          };
          if (row.textStorageKey === "" && row.status === "none") await persist(tx);
          else
            await withStorageKeyRegistration(tx, row.textStorageKey as string, (guarded) =>
              persist(guarded as typeof tx),
            );
        }
      });
    } else {
      await db.insert(table as never).values(rowsToInsert as never[]);
    }
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
  for (const row of rowsToInsert) seen.add(row[identityKey] as string);
  session.insertedIds.set(input.table, seen);
  rememberWrittenIdentities(session, tableName, offeredIds, replayBatchHash);

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
 * Findings keep the session recoverable and automation blocked. The CLI treats
 * a failed integrity commit as an error and either rolls back a new restore or
 * leaves interrupted/resumed progress available for a subsequent --resume.
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
    db
      .select({ id: attachments.id })
      .from(attachments)
      .where(and(inArray(attachments.id, idsChunk), dumpSpaceScope(db, "attachments", spaceId))),
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

/**
 * A resume owns all earlier progress, including rows this process did not
 * insert. Aggregate relational checks in SQL and page object keys so neither
 * millions of field values nor a whole storage inventory stay in memory.
 */
const checkResumedSpaceIntegrity = async (
  db: Awaited<ReturnType<typeof getDb>>,
  spaceId: string,
): Promise<string[]> => {
  const warnings: string[] = [];
  const [fields] = await db
    .select({ missing: count() })
    .from(busabaseFieldValues)
    .where(
      and(
        eq(busabaseFieldValues.spaceId, spaceId),
        or(isNull(busabaseFieldValues.fieldId), eq(busabaseFieldValues.fieldId, "")),
      ),
    );
  if (fields.missing > 0)
    warnings.push(
      `${fields.missing} fieldValues row(s) reference a field that was not imported (fieldId is unset).`,
    );
  const recordExists = (column: AnyPgColumn) =>
    db
      .select({ id: busabaseRecords.id })
      .from(busabaseRecords)
      .where(and(eq(busabaseRecords.spaceId, spaceId), eq(busabaseRecords.id, column)));
  const [links] = await db
    .select({ missing: count() })
    .from(busabaseRecordLinks)
    .where(
      and(
        eq(busabaseRecordLinks.spaceId, spaceId),
        or(
          notExists(recordExists(busabaseRecordLinks.sourceRecordId)),
          notExists(recordExists(busabaseRecordLinks.targetRecordId)),
        ),
      ),
    );
  if (links.missing > 0)
    warnings.push(
      `${links.missing} recordLinks row(s) reference a source/target record that does not exist.`,
    );
  const [assets] = await db
    .select({ missing: count() })
    .from(busabaseAssets)
    .where(
      and(
        eq(busabaseAssets.spaceId, spaceId),
        notExists(
          db
            .select({ id: attachments.id })
            .from(attachments)
            .where(
              and(
                eq(attachments.id, busabaseAssets.attachmentId),
                or(eq(attachments.spaceId, spaceId), isNull(attachments.spaceId)),
              ),
            ),
        ),
      ),
    );
  if (assets.missing > 0)
    warnings.push(
      `${assets.missing} asset row(s) reference an attachmentId that was not imported.`,
    );

  const scanMissingObjects = async (table: "attachments" | "assetTexts"): Promise<number> => {
    const source = DUMP_TABLE_REGISTRY[table];
    const id = source.id;
    const key =
      table === "attachments" ? attachments.storageKey : busabaseAssetTexts.textStorageKey;
    let cursor: string | undefined;
    let missing = 0;
    const pageSize = 500;
    for (;;) {
      const rows: Array<{ id: string; key: string }> = await db
        .select({ id, key })
        .from(source)
        .where(
          and(
            dumpSpaceScope(db, table, spaceId),
            cursor ? gt(id, cursor) : undefined,
            table === "assetTexts"
              ? and(
                  ne(busabaseAssetTexts.status, "none"),
                  ne(busabaseAssetTexts.textStorageKey, ""),
                )
              : undefined,
          ),
        )
        .orderBy(asc(id))
        .limit(pageSize);
      const absent = new Set(await findMissingObjects([...new Set(rows.map((row) => row.key))]));
      missing += rows.filter((row) => absent.has(row.key)).length;
      if (rows.length < pageSize) return missing;
      cursor = rows[rows.length - 1].id;
    }
  };
  const missingAttachments = await scanMissingObjects("attachments");
  if (missingAttachments > 0)
    warnings.push(
      `${missingAttachments} attachment(s) have no bytes in storage for their storageKey.`,
    );
  const missingTexts = await scanMissingObjects("assetTexts");
  if (missingTexts > 0)
    warnings.push(
      `${missingTexts} assetTexts row(s) have no bytes in storage for their textStorageKey — the extracted text they claim to hold is not searchable (grep will silently return no matches for it).`,
    );
  return warnings;
};

/**
 * Bring a restored space up to the view invariants archives may predate:
 *
 * - An archive written before views had a `position` restores every view at
 *   the column default 0, so a Base's tab order would fall back to the
 *   creation-time tie-break by accident. Renumber those Bases explicitly, by
 *   creation time — the order they always showed in.
 * - A Base that comes back with no active view gets the default Grid view, so
 *   it opens on a real view like every other Base. Except an archived Base
 *   whose views were archived along with it (same archive timestamp): restoring
 *   the Base brings those back, so adding one now would only duplicate them.
 *
 * Scoped to the whole target space, not just this session's inserts: the
 * space was validated empty at `importBegin`, so every Base in it came from a
 * restore — including ones a killed run landed before a `--resume`.
 */
const normalizeRestoredViews = async (
  db: Awaited<ReturnType<typeof getDb>>,
  spaceId: string,
): Promise<void> => {
  const bases = await db
    .select({ id: busabaseBases.id, archivedAt: busabaseBases.archivedAt })
    .from(busabaseBases)
    .where(eq(busabaseBases.spaceId, spaceId));
  if (bases.length === 0) return;
  const views = await db
    .select({
      id: busabaseViews.id,
      baseId: busabaseViews.baseId,
      status: busabaseViews.status,
      position: busabaseViews.position,
      archivedAt: busabaseViews.archivedAt,
      createdAt: busabaseViews.createdAt,
    })
    .from(busabaseViews)
    .where(eq(busabaseViews.spaceId, spaceId));
  const viewsByBase = new Map<string, typeof views>();
  for (const view of views) {
    const list = viewsByBase.get(view.baseId) ?? [];
    list.push(view);
    viewsByBase.set(view.baseId, list);
  }
  const timestamp = now();
  for (const base of bases) {
    const baseViews = viewsByBase.get(base.id) ?? [];
    if (baseViews.length > 1 && baseViews.every((view) => view.position === 0)) {
      const ordered = [...baseViews].sort(
        (left, right) =>
          left.createdAt.getTime() - right.createdAt.getTime() ||
          (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
      );
      for (const [position, view] of ordered.entries()) {
        if (position === 0) continue;
        await db.update(busabaseViews).set({ position }).where(eq(busabaseViews.id, view.id));
      }
    }
    if (baseViews.some((view) => view.status === "active")) continue;
    const archivedWithBase =
      base.archivedAt !== null &&
      baseViews.some((view) => view.archivedAt?.getTime() === base.archivedAt?.getTime());
    if (archivedWithBase) continue;
    await insertDefaultGridView(db, {
      spaceId,
      baseId: base.id,
      createdBy: resolveActorId(CURRENT_USER_ID),
      timestamp,
    });
  }
};

export const commitImportSession = async (sessionId: string): Promise<ImportCommitVO> => {
  requireSpaceManagerForDump();
  const session = await requireSession(sessionId);
  if (session.aborting)
    throw new ORPCError("CONFLICT", { message: "This import is aborting; completion was refused" });
  if (session.blobParts.hasIncomplete())
    throw new ORPCError("BAD_REQUEST", {
      message: "Cannot commit an import with incomplete multipart blob uploads",
    });
  const warnings: string[] = [];
  const db = await getDb();
  const spaceId = session.spaceId;
  if (session.resume && !allTablesValidated(session))
    throw new ORPCError("PRECONDITION_FAILED", {
      message: "Complete read-only SQL preflight before committing a resume",
    });
  if (session.expectedTables) {
    await assertReplayTableCounts(db, spaceId, session.expectedTables, true);
    for (const table of DumpTableSchema.options) {
      const expected = session.resume
        ? session.validation.get(table)?.source
        : (session.writtenIdentities.get(table)?.fingerprint ?? new ReplayIdentityFingerprint());
      if (!expected || !(await fingerprintReplayTable(db, table, spaceId)).equals(expected))
        throw new ORPCError("CONFLICT", {
          message: `Restored ${table} identities differ from the archive; completion was refused`,
        });
    }
  }

  if (!session.insertedIds.has("nodes") && !session.offeredNodes) {
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

  if (session.resume) {
    warnings.push(...(await checkResumedSpaceIntegrity(db, spaceId)));
  } else {
    warnings.push(
      ...(await checkFieldValueOrphans(db, spaceId, fieldValueIds)),
      ...(await checkRecordLinkOrphans(db, spaceId, linkIds)),
      ...(await checkAssetAttachmentOrphans(db, spaceId, assetIds)),
      ...(await checkBlobCompleteness(db, attachmentIds)),
      ...(await checkAssetTextBlobCompleteness(db, spaceId, assetTextIds)),
    );
  }
  if (warnings.length > 0) return { ok: false, warnings };
  if (!session.preserveViewMetadata) await normalizeRestoredViews(db, spaceId);
  // Keep recovery ownership and automation held until every fallible cleanup
  // step succeeds. A failed finalization must remain retryable/abortable.
  await session.blobParts.cleanup();
  await endRestoreActivity(db, {
    spaceId,
    sessionId,
    completed: {
      sourceArchiveChecksum: session.sourceArchiveChecksum ?? null,
      preserveViewMetadata: session.preserveViewMetadata,
      expectedTables: session.expectedTables,
    },
  });
  sessions.delete(sessionId);
  return {
    ok: true,
    warnings,
    ...(session.notices.size > 0 ? { notices: [...session.notices] } : {}),
  };
};

export const abortImportSession = async (sessionId: string): Promise<{ ok: boolean }> => {
  requireSpaceManagerForDump();
  const session = await requireSession(sessionId);
  session.aborting = true;
  const db = await getDb();
  await session.blobParts.cleanup();

  // Cleanup can wait for old uploads while a new owner takes over. Fence the
  // actual mutation phase against beginRestoreActivity and re-check ownership
  // inside that same transaction; never hold this lock while waiting above.
  const rollback = await withStorageKeyLocks(
    db,
    [restoreActivityKey(session.spaceId)],
    async (transaction) => {
      const db = transaction as Awaited<ReturnType<typeof getDb>>;
      await assertRestoreActivity(session.spaceId, sessionId);

      // A resumed restore must never roll back. Its whole purpose is to build on
      // rows a previous, killed attempt already landed, and this session only
      // knows about the ones IT inserted — so rolling back would delete the newly
      // recovered progress while leaving the older rows, moving the restore
      // backwards and stranding it in a state neither run can finish. The CLI
      // already skips calling this under `--resume`; refuse here too so a direct
      // API caller cannot do it either.
      if (session.resume) {
        // An explicitly aborted root-only target has no workflow/session progress
        // to protect. Preserve all bytes/rows, but allow a fresh empty-target retry.
        return {
          preserveProgress: true,
          releaseActivity: await isSqlRootOnly(db, session.spaceId),
        };
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
          await db
            .delete(drizzleTable as never)
            .where(
              and(
                inArray(dumpIdentityColumn(table), chunk),
                dumpSpaceScope(db, table, session.spaceId),
              ),
            );
        }
      }

      if (session.originalRoot) {
        await db
          .update(busabaseNodes)
          .set(coerceDateColumns(busabaseNodes, session.originalRoot))
          .where(
            and(
              eq(busabaseNodes.id, rootNodeIdForSpace(session.spaceId)),
              eq(busabaseNodes.spaceId, session.spaceId),
            ),
          );
      }
      for (const [key, hashes] of session.rootBodyHashes) {
        if (!(await storage.getObjectMetadata(key))) continue;
        const current = createHash("sha256")
          .update(await storage.getObject(key))
          .digest("hex");
        if (!hashes.has(current))
          throw new ORPCError("CONFLICT", {
            message:
              "The root readme changed outside this import; it was preserved and recovery remains held",
          });
        await storage.deleteObject(key);
      }
      return { preserveProgress: false, releaseActivity: true };
    },
  );
  if (!rollback.preserveProgress) {
    // Each exact key and the activity owner use the same lexical lock order as
    // promotion. Do not hold the activity lock then acquire a key in reverse.
    // Another space may have adopted the bytes after promotion: all-space
    // references and the actual content decide whether they are still ours.
    for (const [key, expected] of session.newPromotedObjects) {
      await withStorageKeyLocks(
        db,
        [key, restoreActivityKey(session.spaceId)],
        async (transaction) => {
          await assertRestoreActivity(session.spaceId, sessionId);
          if (await objectIsStillReferenced(transaction, key)) return;
          if (await verifiedExistingObject(key, expected.sizeBytes, expected.sha256))
            await storage.deleteObject(key);
        },
      );
      session.newPromotedObjects.delete(key);
    }
  }
  if (rollback.releaseActivity)
    await endRestoreActivity(db, { spaceId: session.spaceId, sessionId });
  sessions.delete(sessionId);
  return { ok: true };
};
