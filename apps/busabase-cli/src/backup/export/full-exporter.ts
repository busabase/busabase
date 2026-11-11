import { mkdtemp, rename, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import {
  type DumpTable,
  DumpTableSchema,
  EXPORT_DOC_BODIES_MAX_BATCH,
  type ExportAttachmentVO,
  type ExportDocBodiesVO,
} from "busabase-contract/domains/dump/types";
import type { BusabaseClient } from "busabase-sdk";
import { isTransientError } from "../../retry.js";
import { ArchiveWriter } from "../format/archive-writer.js";
import { FORMAT_VERSION, type Manifest } from "../format/manifest.js";
import { IMPORT_ORDER } from "../import/full-importer.js";
import { BackupContentIntegrityError, canonicalHash, RawBlobSpool } from "./raw-blob-spool.js";
import { SpooledTable } from "./spooled-table.js";

/**
 * The CLI's shared `withRetry` (retry.ts) wraps `fetch` and only inspects the
 * HTTP status — a response that comes back `200` but whose body was
 * truncated or corrupted in transit (observed live against a real,
 * large production space: a many-thousand-page `dump.exportTables` pull threw
 * `Cannot parse response body` partway through, at a different table on each
 * attempt) already looks "successful" to that wrapper and is never retried.
 * A single flaky page must not fail an entire multi-hour backup, so retry
 * the one page here, close to the failure, rather than widening the shared
 * fetch-level wrapper (which would change retry behavior for every command).
 */
const DEFAULT_PAGE_FETCH_RETRIES = 3;
const PAGE_FETCH_RETRY_DELAY_MS = 1000;

const fetchPageWithRetry = async <T>(
  fetchPage: () => Promise<T>,
  onRetry?: (attempt: number, error: unknown) => void,
  /**
   * Which failures are worth another attempt. Stated positively, and per call
   * site, because the right answer differs: the table pull retries ANYTHING
   * (its motivating failure — a truncated body that fails to parse — is
   * neither an HTTP status nor a socket error), while the per-item loops retry
   * only transient failures. Retrying a deterministic error in a loop that
   * runs once per attachment costs ~6s each on a space with tens of thousands
   * of them, and changes nothing.
   */
  shouldRetryError: (error: unknown) => boolean = () => true,
  retries: number = DEFAULT_PAGE_FETCH_RETRIES,
): Promise<T> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await fetchPage();
    } catch (error) {
      if (!shouldRetryError(error)) throw error;
      if (attempt >= retries) throw error;
      onRetry?.(attempt + 1, error);
      await new Promise((resolve) =>
        setTimeout(resolve, PAGE_FETCH_RETRY_DELAY_MS * (attempt + 1)),
      );
    }
  }
};

/**
 * A per-item loop (one doc body, one attachment blob, one asset-text blob —
 * always exactly one request each, no server-side batching available) can run
 * for many minutes on a real space with no output between its start and its
 * own final summary line, which reads exactly like a hang. Call this once per
 * iteration; it logs `message()` only every `PROGRESS_INTERVAL_MS`, not on
 * every single item.
 */
const PROGRESS_INTERVAL_MS = 5000;
const throttledProgress = (log: (message: string) => void, message: () => string) => {
  let lastAt = Date.now();
  return (): void => {
    const now = Date.now();
    if (now - lastAt < PROGRESS_INTERVAL_MS) return;
    lastAt = now;
    log(message());
  };
};

/**
 * How many blob downloads may be in flight at once.
 *
 * The export used to be strictly one-request-at-a-time. On the real Vika Team
 * space that is 10,486 attachments x 2 sequential round trips each (resolve a
 * download URL, then fetch the bytes) — ~21k serialized requests, which is
 * where the bulk of a multi-HOUR backup went. Latency, not bandwidth, was the
 * limit: a single in-flight download never comes close to saturating the link.
 *
 * 8 is deliberately modest. These run against a live production server that is
 * also serving real users, and each in-flight download holds its whole body in
 * memory (see the buffer in the attachment loop), so the ceiling also bounds
 * peak heap at roughly 8 x the largest file rather than the whole set.
 */
const BLOB_DOWNLOAD_CONCURRENCY = 8;

type Settled<R> = { ok: true; value: R } | { ok: false; error: unknown };

/**
 * Run `work` over `items` with at most `limit` in flight, handing each result
 * to `consume` strictly IN ORDER and one at a time.
 *
 * The ordering guarantee is what makes this safe to drop into the existing
 * loops: `consume` keeps doing exactly what the sequential body did (append to
 * a spool file, bump counters, dedupe against a Set), with no concurrent
 * access to any of it — only the network wait overlaps. Ordered output also
 * keeps an archive's bytes reproducible for a given space rather than varying
 * with which download happened to finish first.
 *
 * A rejected `work` is captured rather than thrown, so one bad item still
 * reaches `consume` as a failure. A full backup then fails closed; already
 * started work is drained first so its streams and resumable receipts settle.
 */
const forEachConcurrent = async <T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
  consume: (settled: Settled<R>, item: T) => Promise<void> | void,
): Promise<void> => {
  const inFlight = new Map<number, Promise<Settled<R>>>();
  let started = 0;

  try {
    for (let emitted = 0; emitted < items.length; emitted += 1) {
      while (inFlight.size < limit && started < items.length) {
        const index = started;
        started += 1;
        inFlight.set(
          index,
          work(items[index]).then<Settled<R>, Settled<R>>(
            (value) => ({ ok: true, value }),
            (error) => ({ ok: false, error }),
          ),
        );
      }
      // Always populated: `emitted` trails `started`, and the loop above tops
      // the window up before every read.
      const pending = inFlight.get(emitted) as Promise<Settled<R>>;
      inFlight.delete(emitted);
      await consume(await pending, items[emitted]);
    }
  } catch (error) {
    // Already-started downloads must settle their streams/receipts before the
    // command returns or another --resume can race unfinished cache writes.
    await Promise.all(inFlight.values());
    throw error;
  }
};

/**
 * Write an NDJSON archive entry from already-collected rows without ever
 * concatenating them into a single JS string first. A real production table
 * (e.g. `fieldValues` holding long CMS/article-body content) can produce an
 * NDJSON blob well past V8's max string length — `"".join("\n")` on such a
 * table throws `RangeError: Invalid string length` and aborts the whole
 * backup. Streaming line-sized buffers through `ArchiveWriter.addStream`
 * (already built for exactly this — see its own doc comment) avoids ever
 * holding one oversized string/buffer.
 *
 * `addStream` needs the entry's total byte size up front (a tar constraint),
 * which used to be met by materializing every line as a `Buffer` in an array
 * and summing it. On `fieldValues` that is 1.1M `Buffer`s alive at once while
 * the 1.1M row objects they came from are also still live — the same
 * peak-heap shape `SpooledNdjsonEntry` was written to avoid, on the one table
 * that dwarfs the rest. Measure the size in a first pass (keeping only a
 * running total), then re-serialize lazily from a generator so at most one
 * line exists at a time. The cost is `JSON.stringify` twice per row, which is
 * CPU against a backup whose real bottleneck is the network.
 */
const writeNdjsonEntry = async (
  writer: ArchiveWriter,
  path: string,
  rows: Array<Record<string, unknown>>,
): Promise<void> => {
  let totalSize = 0;
  for (const row of rows) {
    totalSize += Buffer.byteLength(`${JSON.stringify(row)}\n`, "utf8");
  }
  const lines = function* () {
    for (const row of rows) yield Buffer.from(`${JSON.stringify(row)}\n`, "utf8");
  };
  await writer.addStream(path, totalSize, Readable.from(lines()));
};

class BackupCoverageError extends Error {}
const incomplete = (message: string): BackupCoverageError =>
  new BackupCoverageError(`Full backup incomplete: ${message}. No new archive was published.`);

function validateNodeGraph(rows: Array<Record<string, unknown>>): void {
  const nodes = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    if (typeof row.id !== "string" || !row.id || nodes.has(row.id))
      throw incomplete("the nodes snapshot contains an invalid or duplicate node id");
    nodes.set(row.id, row);
  }
  const children = new Map<string, string[]>();
  const queue: string[] = [];
  for (const [id, row] of nodes) {
    if (row.parentId === null || row.parentId === undefined) {
      queue.push(id);
      continue;
    }
    if (typeof row.parentId !== "string" || !nodes.has(row.parentId))
      throw incomplete(`node ${id} references a missing parent ${String(row.parentId)}`);
    const siblings = children.get(row.parentId) ?? [];
    siblings.push(id);
    children.set(row.parentId, siblings);
  }
  for (let index = 0; index < queue.length; index++)
    for (const child of children.get(queue[index]) ?? []) queue.push(child);
  if (queue.length !== nodes.size)
    throw incomplete("the nodes parent graph contains a cycle and cannot be restored");
}

function validateBodies(bodies: ExportDocBodiesVO["bodies"], requested: ReadonlySet<string>): void {
  if (!Array.isArray(bodies)) throw incomplete("the body response was not an array");
  const seen = new Set<string>();
  for (const body of bodies) {
    if (
      !body ||
      typeof body.nodeId !== "string" ||
      typeof body.markdown !== "string" ||
      !requested.has(body.nodeId) ||
      seen.has(body.nodeId)
    )
      throw incomplete("the server returned malformed, duplicate or unrequested document bodies");
    seen.add(body.nodeId);
  }
}

/** Resumable raw object directories; old small base64 spools migrate on --resume. */
export const SPOOL_SUFFIXES = [".attachment-blobs.part", ".asset-text-blobs.part"] as const;

// Every dump-eligible table, taken straight from the contract enum (the single
// source of truth). FETCH order here is irrelevant — each table is drained
// independently into `tableRows` (or a leaf table's disk spool), and the
// doc-body / attachment-blob passes read the smaller parent tables from that map. Deriving this instead of
// hand-maintaining a parallel copy is what stops a newly-registered table
// (e.g. the `nodePrincipals` permissions table) from being silently skipped
// on backup.
//
// WRITE order (which archive entries actually land in, below) is a separate
// concern and does matter — see the write-phase comment.
const EXPORT_TABLES: DumpTable[] = [...DumpTableSchema.options];

/**
 * Which dump tables reference which OTHER dump tables, column by column —
 * mirrors the real `.references()` declarations in busabase-core's schema
 * (`domains/base/schema.ts`, `domains/assets/schema/assets.ts`,
 * `db/schema.ts`). Only cross-table FKs matter here: a column with no
 * `.references()` (e.g. `fieldValues.fieldId`, a loose text ref by design, or
 * `assetUsages.recordId`, which defaults to `""`) cannot throw a violation and
 * must NOT be listed, or the drift check would drop rows Postgres would have
 * accepted.
 *
 * Source root references resolve inside this exported node set before the
 * importer remaps them to the target root. Loose history pointers such as
 * commits.parentCommitId are intentionally not treated as database FKs.
 */
const DUMP_FOREIGN_KEYS: Partial<Record<DumpTable, Record<string, DumpTable>>> = {
  nodes: { parentId: "nodes" },
  nodePrincipals: { nodeId: "nodes", sourceNodeId: "nodes" },
  nodeShares: { nodeId: "nodes" },
  favorites: { nodeId: "nodes" },
  nodeSubscriptions: { nodeId: "nodes" },
  forms: { nodeId: "nodes", targetBaseId: "bases" },
  commits: { baseId: "bases", nodeId: "nodes" },
  changeRequests: { baseId: "bases", nodeId: "nodes" },
  operations: {
    changeRequestId: "changeRequests",
    baseId: "bases",
    nodeId: "nodes",
    targetViewId: "views",
    mergedViewId: "views",
    headCommitId: "commits",
  },
  comments: {
    recordId: "records",
    changeRequestId: "changeRequests",
    operationId: "operations",
    commitId: "commits",
  },
  commentMentions: { commentId: "comments" },
  agentSessionEvents: { sessionId: "agentSessions" },
  agentSessionCommands: { sessionId: "agentSessions" },
  routerConnections: { grantId: "routerGrants" },
  reviews: { changeRequestId: "changeRequests" },
  bases: { nodeId: "nodes" },
  baseFields: { baseId: "bases" },
  views: { baseId: "bases" },
  records: { baseId: "bases", headCommitId: "commits" },
  fieldValues: {
    baseId: "bases",
    recordId: "records",
    changeRequestId: "changeRequests",
    operationId: "operations",
    commitId: "commits",
  },
  recordLinks: {
    baseId: "bases",
    fieldId: "baseFields",
    sourceRecordId: "records",
    targetBaseId: "bases",
    targetRecordId: "records",
    commitId: "commits",
  },
  assetUsages: { assetId: "assets", nodeId: "nodes" },
  assetTexts: { assetId: "assets" },
  auditEvents: {
    baseId: "bases",
    recordId: "records",
    changeRequestId: "changeRequests",
    operationId: "operations",
    commitId: "commits",
  },
};

// Transcripts, command payloads and workflow outputs can be larger than record
// history. Keep only parent session ids in memory; their payloads stay on disk.
const ADDITIONAL_SPOOLED_TABLES: DumpTable[] = [
  "workflowRuns",
  "webhookDeliveries",
  "agentSessions",
  "agentSessionEvents",
  "agentSessionCommands",
  "commentMentions",
];

const HISTORY_TABLES: DumpTable[] = [
  "commits",
  "changeRequests",
  "operations",
  "comments",
  "reviews",
  "auditEvents",
];

/**
 * A change request in one of these states is FINISHED — its content is history.
 * Anything else (`in_review`, `approved`, `conflict`, …) is work somebody has
 * not finished yet, and a backup that silently dropped it would lose a
 * colleague's in-flight work, not history. On the validated production space
 * that is 492 unfinished out of 22,828.
 */
const FINISHED_CR_STATUSES = new Set(["merged", "closed", "rejected"]);

/**
 * Reduce the history tables to what the CURRENT state (plus unfinished work)
 * genuinely needs, for `--no-history`.
 *
 * The flag used to just omit the history tables wholesale, which produced an
 * archive that could never be restored: `records.head_commit_id` is a NOT NULL
 * FK into `commits`, so every record dangled. Verified end-to-end — the
 * restore died on the first `records` batch. Dropping a table a live table
 * still points at is not "less history", it is a broken archive.
 *
 * What the shape of the data actually allows (measured on the real Vika Team
 * space, 1,130,898 fieldValues rows):
 *  - Every (record, field) cell holds exactly ONE row — there are no
 *    per-field historical versions to drop. 499,186 rows carry a `recordId`
 *    and ARE the current values.
 *  - The other 631,712 rows carry no `recordId` at all: they are values staged
 *    inside change requests ("this CR proposes setting X to Y"). Those are the
 *    history, and they are 56% of the table.
 *  - 97.8% of change requests are already merged.
 *
 * So: keep every current value, keep unfinished change requests whole, and
 * drop the finished ones' contents. Commits are then kept transitively —
 * whatever the surviving rows still reference — rather than by any rule about
 * what a commit "is", so a NOT NULL `commitId` can never be left dangling.
 */
const pruneToCurrentState = async (
  tableRows: Partial<Record<DumpTable, Array<Record<string, unknown>>>>,
  tableCounts: Record<string, number>,
  log: (message: string) => void,
  fieldValuesSpool: SpooledTable,
  commitsSpool: SpooledTable,
  commitIds: Set<string>,
): Promise<void> => {
  const before = Object.fromEntries(HISTORY_TABLES.map((t) => [t, tableCounts[t] ?? 0] as const));
  const beforeFieldValues = tableCounts.fieldValues ?? 0;

  // Unfinished change requests are in-flight work — kept whole, with every
  // operation, staged value, review and commit they depend on.
  const keptCrIds = new Set(
    (tableRows.changeRequests ?? [])
      .filter((cr) => !FINISHED_CR_STATUSES.has(cr.status as string))
      .map((cr) => cr.id as string),
  );
  const keptOperations = (tableRows.operations ?? []).filter((op) =>
    keptCrIds.has(op.changeRequestId as string),
  );
  const keptOpIds = new Set(keptOperations.map((op) => op.id as string));

  // A fieldValue with a `recordId` is a live cell of a live record. One
  // without belongs to a change request / operation, and survives only if that
  // change request is still unfinished.
  const neededCommitIds = new Set<string>();
  const need = (id: unknown) => {
    if (typeof id === "string" && id) neededCommitIds.add(id);
  };
  const keptFieldValuesCount = await fieldValuesSpool.transform((fv) => {
    const keep =
      Boolean(fv.recordId) ||
      Boolean(fv.changeRequestId && keptCrIds.has(fv.changeRequestId as string)) ||
      Boolean(fv.operationId && keptOpIds.has(fv.operationId as string));
    if (!keep) return undefined;
    // Current cells retain the commit they need, while finished CR/op refs are
    // nullable and must not pull all finished history back into the snapshot.
    if (fv.changeRequestId && !keptCrIds.has(fv.changeRequestId as string))
      fv.changeRequestId = null;
    if (fv.operationId && !keptOpIds.has(fv.operationId as string)) fv.operationId = null;
    need(fv.commitId);
    return fv;
  });

  const keptReviews = (tableRows.reviews ?? []).filter((r) =>
    keptCrIds.has(r.changeRequestId as string),
  );
  // Comments hang off records/CRs/operations/commits by nullable FKs; keep the
  // ones whose subject survives, which for a merged CR means dropping them.
  const keptComments = (tableRows.comments ?? []).filter(
    (c) => !c.changeRequestId || keptCrIds.has(c.changeRequestId as string),
  );

  // Commits: strictly whatever the survivors still point at. `records`,
  // `recordLinks` and `fieldValues` all have a NOT NULL `commitId`, and
  // `operations.headCommitId` is NOT NULL too — collect from all of them
  // rather than assuming which commits "belong to" the current state.
  for (const r of tableRows.records ?? []) need(r.headCommitId);
  for (const rl of tableRows.recordLinks ?? []) need(rl.commitId);
  for (const op of keptOperations) need(op.headCommitId);
  for (const c of keptComments) need(c.commitId);
  const keptCommitCount = await commitsSpool.filter((commit) =>
    neededCommitIds.has(commit.id as string),
  );
  for (const id of commitIds) if (!neededCommitIds.has(id)) commitIds.delete(id);

  const assign = (table: DumpTable, rows: Array<Record<string, unknown>>) => {
    tableRows[table] = rows;
    tableCounts[table] = rows.length;
  };
  tableCounts.fieldValues = keptFieldValuesCount;
  assign(
    "changeRequests",
    (tableRows.changeRequests ?? []).filter((cr) => keptCrIds.has(cr.id as string)),
  );
  assign("operations", keptOperations);
  assign("reviews", keptReviews);
  assign("comments", keptComments);
  tableCounts.commits = keptCommitCount;
  // Audit events are a pure append-only trail — nothing references them, and
  // "who did what when" is exactly what `--no-history` is asked to leave out.
  assign("auditEvents", []);

  const dropped = (table: DumpTable) => before[table] - (tableCounts[table] ?? 0);
  log(
    `  --no-history: kept ${keptFieldValuesCount}/${beforeFieldValues} fieldValues ` +
      `(dropped ${beforeFieldValues - keptFieldValuesCount} staged in finished change requests), ` +
      `${keptCrIds.size} unfinished change request(s); dropped ${dropped("commits")} commits, ` +
      `${dropped("operations")} operations, ${dropped("reviews")} reviews, ` +
      `${dropped("auditEvents")} audit events.`,
  );
};

export interface FullExportOptions {
  client: BusabaseClient;
  outPath: string;
  spaceId: string;
  sourceHost: string;
  includeHistory: boolean;
  toolVersion: string;
  /**
   * Continue a backup whose process was killed, reusing the blob bytes it had
   * already downloaded to the spool files next to `outPath`.
   *
   * Table rows are always re-fetched — they are ~4 minutes of a ~28 minute
   * run, and re-reading them keeps every table's snapshot from the SAME
   * attempt rather than splicing a fresh `fieldValues` onto an hours-old
   * `records`, which is exactly the cross-table drift the FK check exists to
   * catch. The blob phase is ~2/3 of the wall clock and is content-addressed,
   * so that is the part worth resuming.
   */
  resume?: boolean;
  /**
   * `--retries`. The CLI's shared `withRetry` wraps `fetch` but deliberately
   * refuses to retry a 5xx on anything that is not GET/HEAD/OPTIONS, because a
   * repeated mutation could file the same change request twice. Every read this
   * export makes is an oRPC call, and oRPC sends reads as POST — so a single
   * proxy 502 partway through a multi-hour backup was never retried by that
   * wrapper at all. These reads have no side effects, so they are retried here,
   * where their safety is known, rather than by loosening the shared rule for
   * every command.
   */
  retries?: number;
  onProgress?: (message: string) => void;
  /**
   * Internal-only override of the per-page row count (production default:
   * 2000, the contract's maximum). Not exposed as a CLI flag; exists
   * so tests can force the cursor-pagination path to genuinely execute more
   * than once without needing to seed 500+ real rows. Must stay within the
   * contract's `1..2000` bound.
   */
  pageLimit?: number;
}

/**
 * Full-fidelity export: pulls every dump-eligible table via the `dump.exportTables`
 * endpoint (cursor-paginated rows with original identities), stored node
 * documents via `dump.exportDocBodies`, every physical attachment through its
 * signed origin URL, and every derived text object via `dump.exportAssetText`.
 * Writes one `tree/<table>.ndjson` per table (NDJSON
 * keeps the format uniform regardless of table size).
 */
export async function exportFull(options: FullExportOptions): Promise<Manifest> {
  const fieldValuesSpool = await SpooledTable.create(options.outPath);
  let commitsSpool: SpooledTable | undefined;
  let writingDirectory: string | undefined;
  const blobSpools: RawBlobSpool[] = [];
  const additionalSpools = new Map<DumpTable, SpooledTable>();
  const cleanupTableSpools = () =>
    Promise.all([
      fieldValuesSpool.cleanup(),
      commitsSpool?.cleanup(),
      ...[...additionalSpools.values()].map((spool) => spool.cleanup()),
    ]);
  try {
    commitsSpool = await SpooledTable.create(options.outPath, "commits");
    for (const table of ADDITIONAL_SPOOLED_TABLES)
      additionalSpools.set(table, await SpooledTable.create(options.outPath, table));
    writingDirectory = await mkdtemp(
      join(dirname(options.outPath), `.${basename(options.outPath)}.writing-`),
    );
    const writingPath = join(writingDirectory, "archive.bbdump");
    const manifest = await exportFullWithSpool(
      options,
      fieldValuesSpool,
      commitsSpool,
      writingPath,
      blobSpools,
      additionalSpools,
    );
    // Close snapshots before publication. A prior good backup is replaced only
    // after all entries and the manifest have been finalized successfully.
    await cleanupTableSpools();
    await rename(writingPath, options.outPath);
    for (const spool of blobSpools) {
      await spool
        .cleanup()
        .catch((error) =>
          options.onProgress?.(
            `  NOTE: backup published, but its resumable cache could not be removed (${error instanceof Error ? error.message : String(error)})`,
          ),
        );
    }
    return manifest;
  } catch (error) {
    if (error instanceof BackupCoverageError) throw error;
    throw new Error(
      `Full backup failed; no new archive was published and any previous output was preserved (${error instanceof Error ? error.message : String(error)})`,
      { cause: error },
    );
  } finally {
    await cleanupTableSpools().catch((error) =>
      options.onProgress?.(
        `  NOTE: could not remove a closed table snapshot (${error instanceof Error ? error.message : String(error)})`,
      ),
    );
    if (writingDirectory)
      await rm(writingDirectory, { recursive: true, force: true }).catch((error) =>
        options.onProgress?.(
          `  NOTE: could not remove private archive staging (${error instanceof Error ? error.message : String(error)})`,
        ),
      );
  }
}

async function exportFullWithSpool(
  options: FullExportOptions,
  fieldValuesSpool: SpooledTable,
  commitsSpool: SpooledTable,
  writingPath: string,
  blobSpools: RawBlobSpool[],
  additionalSpools: ReadonlyMap<DumpTable, SpooledTable>,
): Promise<Manifest> {
  const {
    client,
    outPath,
    spaceId,
    sourceHost,
    includeHistory,
    toolVersion,
    resume = false,
    retries = DEFAULT_PAGE_FETCH_RETRIES,
    onProgress,
  } = options;
  // Deterministic, and next to the archive rather than in `tmpdir()`: a
  // resumable spool has to be findable by the next run, and putting it beside
  // the output makes its (multi-GB) disk cost visible where the operator
  // already expects the archive's.
  const [attachmentSpoolPath, assetTextSpoolPath] = SPOOL_SUFFIXES.map(
    (suffix) => `${outPath}${suffix}`,
  );
  // The contract's ceiling (see `ExportTablesInputSchema.limit`). The old
  // default of 500 meant `fieldValues` alone — 1,103,718 rows on the validated
  // production space — took ~2,200 sequential round trips; at 2,000 it takes
  // ~550. Rows are small metadata, so a 4x larger page is a bigger response
  // but not a memory concern the way a blob batch would be.
  const pageLimit = options.pageLimit ?? 2000;
  const log = onProgress ?? (() => {});
  const tableCounts: Record<string, number> = {};
  const tableRows: Partial<Record<DumpTable, Array<Record<string, unknown>>>> = {};
  // Child FKs need only commit identities, never the large payload bodies.
  const commitIds = new Set<string>();
  const agentSessionIds = new Set<string>();
  const spoolFor = (table: DumpTable) =>
    table === "fieldValues"
      ? fieldValuesSpool
      : table === "commits"
        ? commitsSpool
        : additionalSpools.get(table);

  // Always FETCH everything, even under `--no-history`. Deciding what history
  // is still load-bearing needs the history itself: which change requests are
  // unfinished, and which commits the surviving rows point at. The old code
  // skipped these tables outright, which is exactly why its archives could not
  // be restored — `records.head_commit_id` is NOT NULL, so a missing `commits`
  // table dangles every record. `pruneToCurrentState` below does the dropping,
  // after it can see what it is dropping.
  const tables = EXPORT_TABLES;

  for (const table of tables) {
    const rows: Array<Record<string, unknown>> = [];
    let count = 0;
    const spool = spoolFor(table);
    let cursor: string | undefined;
    // A large table (fieldValues on a real space: hundreds of thousands of
    // rows, thousands of pages) can otherwise go silent for many minutes
    // between the "exported X: N rows" line for the PREVIOUS table and this
    // one — indistinguishable from a hang.
    const reportProgress = throttledProgress(log, () => `  ...${table}: ${count} rows so far`);
    do {
      const page = await fetchPageWithRetry(
        () => client.dump.exportTables({ table, cursor, limit: pageLimit }),
        (attempt, error) => {
          const message = error instanceof Error ? error.message : String(error);
          log(`  retrying ${table} page (attempt ${attempt}/${retries}): ${message}`);
        },
        undefined,
        retries,
      );
      const fetchedRows = page.rows as Array<Record<string, unknown>>;
      if (table === "commits")
        for (const row of fetchedRows) if (typeof row.id === "string") commitIds.add(row.id);
      if (table === "agentSessions")
        for (const row of fetchedRows) if (typeof row.id === "string") agentSessionIds.add(row.id);
      if (spool) await spool.append(fetchedRows);
      else rows.push(...fetchedRows);
      count += fetchedRows.length;
      cursor = page.nextCursor ?? undefined;
      if (cursor) reportProgress();
    } while (cursor);

    if (!spool) tableRows[table] = rows;
    if (additionalSpools.has(table)) await spool?.seal();
    tableCounts[table] = count;
    log(`exported ${table}: ${count} rows`);
  }

  if (!includeHistory) {
    await pruneToCurrentState(
      tableRows,
      tableCounts,
      log,
      fieldValuesSpool,
      commitsSpool,
      commitIds,
    );
  } else {
    await commitsSpool.seal();
  }
  if (!includeHistory) {
    // Mentions belong to comments, including the comments deliberately removed
    // with finished change requests by --no-history.
    const keptComments = new Set((tableRows.comments ?? []).map((row) => row.id));
    const mentions = additionalSpools.get("commentMentions");
    if (mentions)
      tableCounts.commentMentions = await mentions.filter((row) => keptComments.has(row.commentId));
  }

  // A real, actively-used space keeps changing WHILE a large backup is
  // running (this one alone took over an hour): `dump.exportTables` for each
  // table is its own independent, paginated snapshot query, taken at whatever
  // moment that table's turn comes up in `tables` above — not one consistent
  // point-in-time view across the whole space. So a row created live between
  // two tables' turns is captured by the LATER table and missed by the
  // EARLIER one — and since pages are id-ordered rather than
  // creation-time-ordered, the drift isn't confined to the archive's tail.
  // Restoring such a row throws a raw Postgres FK violation; reproduced live
  // on a real production restore of `fieldValues.recordId`, and the same
  // exposure exists for every FK in `DUMP_FOREIGN_KEYS` below.
  //
  // Cross-check each referencing table against the ids THIS SAME archive
  // actually carries. An unresolved reference is a failed full backup, never
  // permission to discard the row and publish an apparently complete archive.
  {
    // Only a table THIS export actually fetched can testify about what it
    // does or doesn't contain — treating "not fetched" as "carries no ids"
    // would judge every `fieldValues` row unresolvable (its `commitId` is NOT
    // NULL) and silently drop all 1,080,685 of them on the validated
    // production space, reported as drift. That is exactly what the old
    // `--no-history` (which skipped the history tables) caused.
    //
    // `tables` is now always the full set, so this branch is unreachable
    // today. It stays because the distinction is real and cheap: an EMPTY
    // table genuinely means "no such ids exist, drop what points at them",
    // while an ABSENT one means "no information" — collapsing the two is the
    // bug above waiting to come back the moment any caller narrows the set.
    validateNodeGraph(tableRows.nodes ?? []);
    const exported = new Set(tables);
    const idsOf = (table: DumpTable): Set<string> | null =>
      !exported.has(table)
        ? null
        : table === "commits"
          ? commitIds
          : table === "agentSessions"
            ? agentSessionIds
            : new Set((tableRows[table] ?? []).map((row) => row.id as string));

    const validIds = new Map<DumpTable, Set<string> | null>();
    const validIdsFor = (table: DumpTable): Set<string> | null => {
      if (!validIds.has(table)) validIds.set(table, idsOf(table));
      return validIds.get(table) ?? null;
    };

    for (const table of IMPORT_ORDER) {
      const foreignKeys = DUMP_FOREIGN_KEYS[table];
      if (!foreignKeys || !exported.has(table)) continue;
      const rows = tableRows[table] ?? [];
      const spool = spoolFor(table);
      if (!spool && rows.length === 0) continue;

      const referencesResolve = (row: Record<string, unknown>): boolean => {
        for (const [column, targetTable] of Object.entries(foreignKeys)) {
          const id = row[column];
          if (id === null || id === undefined) continue;
          const valid = validIdsFor(targetTable);
          if (valid !== null && !valid.has(id as string))
            throw incomplete(
              `${table} row ${String(row.id)} references missing ${targetTable} id ${String(id)} via ${column}; retry against a consistent source snapshot`,
            );
        }
        return true;
      };
      if (spool) await spool.filter(referencesResolve);
      else for (const row of rows) referencesResolve(row);
    }
  }

  // Doc bodies — one markdown entry per `doc` node, read in batches via
  // `dump.exportDocBodies` (doc bodies live in object storage, not a
  // dump-eligible DB table).
  //
  // This used to go through the ordinary `nodes.get({ type: "doc" })`, which
  // deliberately 404s on an ARCHIVED node (Trash is read through a separate,
  // metadata-only endpoint) — while the raw `nodes` table dump above includes
  // archived rows by design. Every archived Doc therefore fell into the catch
  // below and was skipped with a warning: on a real production space that was
  // 75 of 88 bodies, and restoring that archive brought all 75 back EMPTY. The
  // dump route reads storage directly after proving the node is a Doc in this
  // space, so it sees the whole table like every other `dump.*` export.
  //
  // Batching also retires one HTTP round trip per Doc.
  //
  // The CLI ships independently of the server, so a current CLI is routinely
  // pointed at a server that predates this route — the real Vika Team backup
  // did exactly that and every batch came back `Not found`. Falling straight
  // through to the catch below would have archived ZERO bodies, worse than the
  // 13 the old path managed. So: detect a missing route once, say so, and
  // finish the run on the legacy per-Doc path, which still gets every LIVE
  // Doc. Archived Docs stay unreachable until the server is upgraded — that is
  // the ceiling of what an old server can serve, and the warning says so
  // rather than letting the gap pass silently.
  const docNodes = (tableRows.nodes ?? []).filter((n) => n.type === "doc");
  // `html` marks a folder's HTML readme, archived as `docs/{nodeId}.html`.
  const docBodyEntries: Array<{ nodeId: string; body: string; html?: true }> = [];
  const skippedDocBodies: string[] = [];
  const coverageProblems: string[] = [];
  const reportDocProgress = throttledProgress(
    log,
    () => `  ...doc bodies: ${docBodyEntries.length}/${docNodes.length} fetched`,
  );

  // `dump.exportDocBodies` never answers NOT_FOUND for a node it cannot
  // resolve (it omits the entry instead), so a NOT_FOUND here can only mean
  // the ROUTE itself is absent — an unambiguous "server is older than this
  // CLI" signal, not a data condition.
  const isMissingRoute = (error: unknown): boolean =>
    /^(?:not found|HTTP 404|endpoint not found|no procedure.*|unknown procedure.*|cannot (?:get|post) .*)$/i.test(
      error instanceof Error ? error.message : String(error),
    );

  // Throws on an archived Doc (an old `nodes.get` refuses them) — the caller's
  // sequential step turns that into the skip warning.
  const readOneDocBodyLegacy = async (nodeId: string): Promise<string> =>
    await fetchPageWithRetry(
      async () => {
        const detail = await client.nodes.get({ nodeId, type: "doc" });
        if (detail.type !== "doc") {
          throw new Error(`Expected a doc node for ${nodeId}, got "${detail.type}"`);
        }
        if (typeof detail.body !== "string")
          throw incomplete(`legacy server returned no readable body for doc ${nodeId}`);
        return detail.body;
      },
      (attempt, error) =>
        log(
          `  retrying doc body ${nodeId} (attempt ${attempt}/${retries}): ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      // A node that is not a Doc — and an old server's 404 on an archived one —
      // answers the same way every time; only the transport is worth retrying.
      isTransientError,
      retries,
    );

  const applyLegacyDocBody = (nodeId: string, body: string): void => {
    docBodyEntries.push({ nodeId, body });
  };

  let batchRouteAvailable = typeof client.dump.exportDocBodies === "function";
  for (let i = 0; i < docNodes.length; i += EXPORT_DOC_BODIES_MAX_BATCH) {
    reportDocProgress();
    const batch = docNodes.slice(i, i + EXPORT_DOC_BODIES_MAX_BATCH);
    const nodeIds = batch.map((node) => node.id as string);

    if (batchRouteAvailable) {
      try {
        const { bodies } = await fetchPageWithRetry(
          () => client.dump.exportDocBodies({ nodeIds }),
          (attempt, error) =>
            log(
              `    retrying doc bodies batch (attempt ${attempt}): ${
                error instanceof Error ? error.message : String(error)
              }`,
            ),
          (error) => !isMissingRoute(error),
          retries,
        );
        validateBodies(bodies, new Set(nodeIds));
        if (bodies.some((body) => body.bodyFormat !== undefined || body.nodeType !== undefined))
          throw incomplete("a Doc body response carried a different content type");
        const byId = new Map(bodies.map((entry) => [entry.nodeId, entry.markdown]));
        for (const nodeId of nodeIds) {
          const markdown = byId.get(nodeId);
          if (markdown === undefined) {
            // The route omits an id it cannot resolve to a Doc in this space
            // rather than failing the batch. That should be unreachable here
            // (these ids came from this same archive's own `nodes` dump), so
            // surface it rather than silently archiving nothing for it.
            skippedDocBodies.push(nodeId);
            coverageProblems.push(`server returned no body for doc node ${nodeId}`);
            continue;
          }
          // Written later, in the write phase below — see that comment for why.
          docBodyEntries.push({ nodeId, body: markdown });
        }
        continue;
      } catch (error) {
        if (!isMissingRoute(error)) {
          // Collect this batch's failure for a precise coverage error. Nothing
          // is published when any required body was unreadable.
          const message = error instanceof Error ? error.message : String(error);
          skippedDocBodies.push(...nodeIds);
          coverageProblems.push(`could not read doc bodies for ${nodeIds.join(", ")} (${message})`);
          continue;
        }
        batchRouteAvailable = false;
        log(
          "  NOTE: this server predates `dump.exportDocBodies`; falling back to one request per " +
            "Doc and folder. Every body must still be readable; missing archived content " +
            "will fail the backup instead of producing an incomplete archive.",
        );
      }
    }

    // Legacy path: one request per Doc, so overlap them too. Ordered, and the
    // pushes inside `readOneDocBodyLegacy` happen in the sequential step.
    await forEachConcurrent(
      nodeIds,
      BLOB_DOWNLOAD_CONCURRENCY,
      (nodeId) => readOneDocBodyLegacy(nodeId),
      (settled, nodeId) => {
        if (settled.ok) {
          applyLegacyDocBody(nodeId, settled.value);
          return;
        }
        const { error } = settled;
        const message = error instanceof Error ? error.message : String(error);
        skippedDocBodies.push(nodeId);
        coverageProblems.push(`could not read doc body for node ${nodeId} (${message})`);
      },
    );
  }
  log(`fetched ${docBodyEntries.length} doc bodies, skipped ${skippedDocBodies.length}`);

  // Folder readmes — the optional markdown at `…/folder/readme.md`, served by
  // the same `dump.exportDocBodies` route and archived under the same
  // `docs/{nodeId}.md` entries: the server decides on restore whether an entry
  // is a Doc body or a readme from the node's restored type. Without this pass
  // a restore brought every readme back EMPTY while its `folder_update`
  // history survived. An HTML readme (`bodyFormat: "html"`) is archived as
  // `docs/{nodeId}.html` instead, so the restore knows to write it back as HTML.
  //
  // A separate pass, not folders mixed into `docNodes`: most folders have no
  // readme, and the route omits those, so an omitted folder is the normal case
  // here — not the "server returned no body" warning it is for a Doc. A server
  // older than readmes matches only Docs and omits every folder the same way;
  // one that predates the route has no readmes to lose, so a missing route
  // ends this pass quietly rather than taking the legacy per-Doc path.
  const folderIds = (tableRows.nodes ?? [])
    .filter((n) => n.type === "folder")
    .map((n) => n.id as string);
  let folderReadmeCount = 0;
  const skippedFolderReadmes: string[] = [];
  let legacyFolderStart = batchRouteAvailable ? folderIds.length : 0;
  if (batchRouteAvailable) {
    for (let i = 0; i < folderIds.length; i += EXPORT_DOC_BODIES_MAX_BATCH) {
      const nodeIds = folderIds.slice(i, i + EXPORT_DOC_BODIES_MAX_BATCH);
      try {
        const { bodies } = await fetchPageWithRetry(
          () => client.dump.exportDocBodies({ nodeIds }),
          (attempt, error) =>
            log(
              `    retrying folder readmes batch (attempt ${attempt}): ${
                error instanceof Error ? error.message : String(error)
              }`,
            ),
          (error) => !isMissingRoute(error),
          retries,
        );
        const requested = new Set(nodeIds);
        validateBodies(bodies, requested);
        if (
          bodies.some(
            (body) =>
              body.nodeType !== undefined ||
              (body.bodyFormat !== undefined && body.bodyFormat !== "html"),
          )
        )
          throw incomplete("a folder readme response carried a different content type");
        for (const entry of bodies) {
          if (!requested.has(entry.nodeId)) continue;
          docBodyEntries.push(
            entry.bodyFormat === "html"
              ? { nodeId: entry.nodeId, body: entry.markdown, html: true }
              : { nodeId: entry.nodeId, body: entry.markdown },
          );
          folderReadmeCount += 1;
        }
      } catch (error) {
        if (isMissingRoute(error)) {
          legacyFolderStart = i;
          break;
        }
        const message = error instanceof Error ? error.message : String(error);
        skippedFolderReadmes.push(...nodeIds);
        coverageProblems.push(
          `could not read folder readmes for ${nodeIds.join(", ")} (${message})`,
        );
      }
    }
  }
  if (legacyFolderStart < folderIds.length) {
    await forEachConcurrent(
      folderIds.slice(legacyFolderStart),
      BLOB_DOWNLOAD_CONCURRENCY,
      async (nodeId) => {
        const detail = await fetchPageWithRetry(
          () => client.nodes.get({ nodeId, type: "folder" }),
          undefined,
          isTransientError,
          retries,
        );
        if (detail.type !== "folder" || typeof detail.body !== "string")
          throw incomplete(`legacy server cannot read folder ${nodeId} completely`);
        return detail;
      },
      (settled, nodeId) => {
        if (!settled.ok) {
          skippedFolderReadmes.push(nodeId);
          coverageProblems.push(
            `could not read legacy folder ${nodeId} (${settled.error instanceof Error ? settled.error.message : String(settled.error)})`,
          );
          return;
        }
        const detail = settled.value;
        if (detail.body.length === 0) return;
        docBodyEntries.push(
          detail.bodyFormat === "html"
            ? { nodeId, body: detail.body, html: true }
            : { nodeId, body: detail.body },
        );
        folderReadmeCount++;
      },
    );
  }
  log(
    `fetched ${folderReadmeCount} folder readmes from ${folderIds.length} folders, ` +
      `skipped ${skippedFolderReadmes.length}`,
  );

  // Preserve raw stored rich documents, including archived nodes. Do not use
  // renderer defaults or JSON parse/stringify: both would change source bytes.
  const richNodes = (tableRows.nodes ?? []).filter((node) =>
    ["html", "whiteboard", "workflow"].includes(node.type as string),
  );
  const richBodyEntries: Array<{
    nodeId: string;
    nodeType: "html" | "whiteboard" | "workflow";
    body: string;
  }> = [];
  for (let offset = 0; offset < richNodes.length; offset += EXPORT_DOC_BODIES_MAX_BATCH) {
    const batch = richNodes.slice(offset, offset + EXPORT_DOC_BODIES_MAX_BATCH);
    try {
      const result = await fetchPageWithRetry(
        () => client.dump.exportDocBodies({ nodeIds: batch.map((node) => node.id as string) }),
        undefined,
        (error) => !isMissingRoute(error),
        retries,
      );
      if (
        !Array.isArray(result.supportedRichNodeTypes) ||
        batch.some(
          (node) =>
            !result.supportedRichNodeTypes?.includes(
              node.type as "html" | "whiteboard" | "workflow",
            ),
        )
      )
        throw incomplete(
          "server does not support complete HTML, whiteboard and workflow backup coverage; upgrade the server",
        );
      validateBodies(result.bodies, new Set(batch.map((node) => node.id as string)));
      for (const body of result.bodies) {
        const node = batch.find((node) => node.id === body.nodeId);
        if (!node || !body.nodeType || body.nodeType !== node.type)
          throw incomplete("a rich document response carried a different node type");
        richBodyEntries.push({
          nodeId: body.nodeId,
          nodeType: body.nodeType,
          body: body.markdown,
        });
      }
    } catch (error) {
      coverageProblems.push(
        `could not read rich node document(s) ${batch.map((node) => node.id).join(", ")}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  log(`fetched ${richBodyEntries.length} stored rich documents from ${richNodes.length} nodes`);

  if (coverageProblems.length > 0)
    throw incomplete(
      `${coverageProblems.length} document coverage error(s): ${coverageProblems.slice(0, 10).join("; ")}`,
    );

  // Physical rows are the complete byte registry. Assets cover only a subset:
  // attachments with no Asset still belong in a disaster-recovery archive.
  const attachmentRows = tableRows.attachments ?? [];
  const attachmentsById = new Map(
    attachmentRows.map((attachment) => [attachment.id as string, attachment]),
  );
  const assetsByAttachmentId = new Map<string, Record<string, unknown>>();
  for (const asset of tableRows.assets ?? []) {
    if (!assetsByAttachmentId.has(asset.attachmentId as string))
      assetsByAttachmentId.set(asset.attachmentId as string, asset);
    if (!attachmentsById.has(asset.attachmentId as string)) {
      throw incomplete(
        `asset ${asset.id} has no exported attachment row; upgrade an older server or repair the source registry before backing up`,
      );
    }
  }
  const uniqueAttachments = [
    ...new Map(
      attachmentRows.map((attachment) => [attachment.storageKey as string, attachment]),
    ).values(),
  ];
  const registeredHashes = new Map<string, string>();
  for (const attachment of attachmentRows) {
    const normalized = canonicalHash(attachment.contentHash, `attachment ${attachment.id}`);
    if (normalized === undefined) continue;
    const key = attachment.storageKey as string;
    const previous = registeredHashes.get(key);
    if (previous && previous !== normalized)
      throw new BackupContentIntegrityError(
        `Conflicting registered content hashes for shared attachment key ${key}. No new archive was published.`,
      );
    registeredHashes.set(key, normalized);
  }
  const attachmentBlobs = await RawBlobSpool.open(
    attachmentSpoolPath,
    "attachments",
    resume,
    registeredHashes,
  );
  blobSpools.push(attachmentBlobs);
  const allowedAttachmentKeys = new Map(
    uniqueAttachments.map((attachment) => [
      attachment.storageKey as string,
      registeredHashes.get(attachment.storageKey as string),
    ]),
  );
  const recoveredBlobs = await attachmentBlobs.recover(allowedAttachmentKeys);
  let blobCount = recoveredBlobs.count;
  let blobBytes = recoveredBlobs.bytes;
  const skippedAttachments: string[] = [];
  if (recoveredBlobs.count > 0)
    log(
      `  resuming: ${recoveredBlobs.count} attachment blob(s) already downloaded (${recoveredBlobs.bytes} bytes), continuing with the rest`,
    );

  // Probe once before concurrent work. New SDK methods against old servers are
  // present locally but 404 remotely; plain test/old SDK objects can lack it.
  let attachmentRouteAvailable = typeof client.dump.exportAttachment === "function";
  const prefetched = new Map<string, ExportAttachmentVO>();
  const firstAttachment = uniqueAttachments.find(
    (attachment) => !recoveredBlobs.keys.has(attachment.storageKey as string),
  );
  if (attachmentRouteAvailable && firstAttachment) {
    try {
      prefetched.set(
        firstAttachment.id as string,
        await client.dump.exportAttachment({ attachmentId: firstAttachment.id as string }),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // An absent object or a now-deleted row is not an absent route.
      if (
        /^(?:not found|unknown procedure.*|no procedure.*|cannot get .*|HTTP 404)$/i.test(message)
      )
        attachmentRouteAvailable = false;
    }
  }
  if (!attachmentRouteAvailable && uniqueAttachments.length > 0) {
    log(
      "  WARNING: this server predates dump.exportAttachment. Falling back to Asset downloads: physical attachments without Assets and original bytes behind a rewriting CDN cannot be guaranteed. Upgrade the server for complete backup coverage.",
    );
  }
  const reportBlobProgress = throttledProgress(
    log,
    () => `  ...attachment blobs: ${blobCount}/${uniqueAttachments.length} fetched`,
  );
  await forEachConcurrent(
    uniqueAttachments,
    BLOB_DOWNLOAD_CONCURRENCY,
    async (attachment) => {
      const key = attachment.storageKey as string;
      if (recoveredBlobs.keys.has(key)) return null;
      return await fetchPageWithRetry(
        async () => {
          let downloadUrl: string;
          let mimeType = attachment.mimeType as string;
          let registeredHash = registeredHashes.get(key);
          if (attachmentRouteAvailable) {
            const info =
              prefetched.get(attachment.id as string) ??
              (await client.dump.exportAttachment({ attachmentId: attachment.id as string }));
            prefetched.delete(attachment.id as string);
            if (info.storageKey !== key || info.attachmentId !== attachment.id)
              throw new BackupContentIntegrityError(
                `Attachment identity changed while backing up ${attachment.id}.`,
              );
            downloadUrl = info.downloadUrl;
            mimeType = info.mimeType;
            registeredHash = info.contentHash ?? registeredHash;
          } else {
            const asset = assetsByAttachmentId.get(attachment.id as string);
            if (!asset)
              throw new Error(
                "server has no physical-attachment download endpoint and this attachment has no Asset",
              );
            const legacy = await client.assets.download({ assetId: asset.id as string });
            downloadUrl = legacy.downloadUrl;
            mimeType = legacy.mimeType;
          }
          const response = await fetch(new URL(downloadUrl, sourceHost).toString());
          if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
          const metadata = await attachmentBlobs.download(
            response,
            key,
            mimeType,
            [registeredHashes.get(key), registeredHash],
            `attachment ${attachment.id}`,
          );
          // Size registrations can be stale (verified on real legacy images).
          // A matching content hash proves byte identity; keep those bytes and
          // expose the size discrepancy rather than treating metadata as damage.
          const registeredSize = attachment.sizeBytes;
          const sizeWarning =
            typeof registeredSize === "number" && registeredSize !== metadata.bytes
              ? `  WARNING: attachment ${attachment.id} registered size ${registeredSize} differs from downloaded ${metadata.bytes}; ${registeredHash ? "content hash verified" : "no registered hash available"}.`
              : null;
          return { metadata, sizeWarning };
        },
        (attempt, error) =>
          log(
            `  retrying attachment ${attachment.id} (attempt ${attempt}/${retries}): ${error instanceof Error ? error.message : String(error)}`,
          ),
        isTransientError,
        retries,
      );
    },
    async (settled, attachment) => {
      reportBlobProgress();
      if (!settled.ok) {
        if (settled.error instanceof BackupContentIntegrityError) throw settled.error;
        throw incomplete(
          `could not download attachment ${attachment.id} after retries (${settled.error instanceof Error ? settled.error.message : String(settled.error)})`,
        );
      }
      if (!settled.value) return;
      const { metadata, sizeWarning } = settled.value;
      if (sizeWarning) log(sizeWarning);
      blobCount++;
      blobBytes += metadata.bytes;
    },
  );
  log(
    `fetched ${blobCount} attachment blobs (${blobBytes} bytes), skipped ${skippedAttachments.length}`,
  );

  // Asset-text blobs — the extracted-text objects `busabase_asset_texts` rows
  // point at (Drive Grep Retrieval). The ROWS were always exported (assetTexts
  // is a dump table); their BYTES were not, so a restore produced rows saying
  // `status: "present"` over objects that had never been captured and grep
  // silently returned no matches for text the source could find. Same shape as
  // the `nodePrincipals` loss: the table is in the dump set, the content it
  // depends on is not.
  //
  // Only rows that own a SEPARATE object are archived here. The server decides
  // that (see `exportAssetTextBlob`) and returns `downloadUrl: null` otherwise
  // — auto-registered text-kind rows point at the owning attachment's own
  // `storageKey`, whose bytes the attachment pass above already wrote, so
  // re-archiving them would duplicate bytes and have two entries fight over
  // one key on restore. Keys are content-addressed, so two assets holding
  // identical text share one key: dedupe, or the archive carries the same
  // bytes twice.
  const assetTextRows = tableRows.assetTexts ?? [];
  const expectedTextHashes = new Map<string, string>();
  for (const row of assetTextRows) {
    if (typeof row.textStorageKey !== "string" || !row.textStorageKey) continue;
    const hash = canonicalHash(row.textContentHash, `asset text ${row.assetId}`);
    if (hash === undefined) continue;
    const previous = expectedTextHashes.get(row.textStorageKey);
    if (previous && previous !== hash)
      throw new BackupContentIntegrityError(
        `Conflicting registered text hashes for shared key ${row.textStorageKey}`,
      );
    expectedTextHashes.set(row.textStorageKey, hash);
  }
  const allowedTextKeys = new Map(
    assetTextRows
      .filter((row) => typeof row.textStorageKey === "string" && row.textStorageKey)
      .map((row) => [
        row.textStorageKey as string,
        expectedTextHashes.get(row.textStorageKey as string),
      ]),
  );
  const textBlobs = await RawBlobSpool.open(assetTextSpoolPath, "asset-texts", resume);
  blobSpools.push(textBlobs);
  const recoveredTexts = await textBlobs.recover(allowedTextKeys);
  // Seeded with what a previous run already wrote, so the content-addressed
  // dedupe below still holds across the resume boundary.
  const seenTextKeys = new Set<string>(recoveredTexts.keys);
  let textBlobCount = recoveredTexts.count;
  let textBlobBytes = recoveredTexts.bytes;
  const skippedAssetTexts: string[] = [];
  if (recoveredTexts.count > 0) {
    log(`  resuming: ${recoveredTexts.count} asset-text blob(s) already downloaded`);
  }
  const reportTextProgress = throttledProgress(
    log,
    () => `  ...asset-text blobs: ${textBlobCount}/${assetTextRows.length} fetched`,
  );
  await forEachConcurrent(
    assetTextRows,
    BLOB_DOWNLOAD_CONCURRENCY,
    async (assetText) =>
      // Same two-round-trip unit as the attachment pass above, retried for the
      // same reason. The hash check below is INSIDE the retry on purpose: a
      // mismatch is exactly the transfer corruption a second attempt tends to
      // fix, so retrying it is the difference between recovering the text and
      // dropping it.
      await fetchPageWithRetry(
        async () => {
          const info = await client.dump.exportAssetText({
            assetId: assetText.assetId as string,
          });
          // No separate object to archive (auto-registered row, or `status: "none"`).
          if (!info.downloadUrl) {
            const key = assetText.textStorageKey;
            const ownsObject =
              typeof key === "string" && key.length > 0 && !allowedAttachmentKeys.has(key);
            if (ownsObject && assetText.status !== "none")
              throw incomplete(
                `server returned no download URL for extracted text ${assetText.assetId}`,
              );
            return null;
          }
          if (
            typeof assetText.textStorageKey === "string" &&
            assetText.textStorageKey !== info.textStorageKey
          )
            throw incomplete(
              `extracted text storage identity changed for asset ${assetText.assetId}`,
            );
          // Already spooled by a previous run. Safe to read `recoveredBlobs`-style
          // state from inside the concurrent worker because this set is immutable
          // for the whole run — unlike `seenTextKeys`, which the sequential step
          // mutates and which therefore must not be consulted here.
          if (recoveredTexts.keys.has(info.textStorageKey)) return null;

          const resolvedUrl = new URL(info.downloadUrl, sourceHost).toString();
          const res = await fetch(resolvedUrl);
          if (!res.ok || !res.body) {
            throw new Error(`HTTP ${res.status}`);
          }
          return await textBlobs.download(
            res,
            info.textStorageKey,
            undefined,
            [expectedTextHashes.get(info.textStorageKey), info.textContentHash],
            `asset text ${assetText.assetId}`,
          );
        },
        (attempt, error) =>
          log(
            `  retrying asset text ${assetText.assetId} (attempt ${attempt}/${retries}): ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        isTransientError,
        retries,
      ),
    async (settled, assetText) => {
      reportTextProgress();
      const assetId = assetText.assetId as string;
      if (!settled.ok) {
        const { error } = settled;
        if (error instanceof BackupContentIntegrityError) throw error;
        throw incomplete(
          `could not download text for asset ${assetId} after retries (${error instanceof Error ? error.message : String(error)})`,
        );
      }
      if (!settled.value) return;
      const metadata = settled.value;
      const textStorageKey = metadata.textStorageKey as string;
      // Keys are content-addressed, so two assets holding identical text share
      // one key. Dedupe HERE, in the sequential step — checking a shared Set
      // from inside the concurrent work function would race (two in-flight
      // downloads of the same key would both see it absent). The cost is
      // downloading a duplicate we then discard, which is rare and bounded.
      if (seenTextKeys.has(textStorageKey)) return;
      seenTextKeys.add(textStorageKey);
      textBlobCount += 1;
      textBlobBytes += metadata.bytes;
    },
  );
  log(
    `fetched ${textBlobCount} asset-text blobs (${textBlobBytes} bytes), skipped ${skippedAssetTexts.length}`,
  );

  // Write phase — everything above FETCHED data into memory or a disk spool;
  // nothing has touched the archive file yet. Entries are written here in the exact
  // order `full-importer.ts` needs to encounter them while streaming the
  // file back in a single pass (blobs before the table rows that reference
  // them, tables in FK-safe `IMPORT_ORDER`, doc bodies last): `streamArchive`
  // processes entries strictly in tar-physical order, so THIS order is what
  // makes a true single-pass streaming restore possible without re-reading
  // the file per table. See the matching comment on `IMPORT_ORDER`.
  const writer = ArchiveWriter.create(writingPath);
  try {
    await attachmentBlobs.finish(
      writer,
      uniqueAttachments.map((attachment) => attachment.storageKey as string),
    );
    await textBlobs.finish(writer, [...seenTextKeys]);
    for (const table of IMPORT_ORDER) {
      // `--no-history` never fetched these tables at all (see `tables` above)
      // — omit the entry entirely rather than writing an empty one, matching
      // the archive's previous shape for a `--no-history` backup.
      if (!tables.includes(table)) continue;
      const spool = spoolFor(table);
      if (spool) {
        await spool.writeArchive(writer, `tree/${table}.ndjson`);
      } else {
        await writeNdjsonEntry(writer, `tree/${table}.ndjson`, tableRows[table] ?? []);
      }
    }
    for (const doc of docBodyEntries) {
      await writer.addBuffer(`docs/${doc.nodeId}.${doc.html ? "html" : "md"}`, doc.body);
    }
    for (const rich of richBodyEntries) {
      const extension = rich.nodeType === "html" ? "html" : `${rich.nodeType}.json`;
      await writer.addBuffer(`rich/${rich.nodeId}.${extension}`, rich.body);
    }
    log(
      `wrote archive entries: ${blobCount} attachment blobs, ${textBlobCount} asset-text blobs, ` +
        `${IMPORT_ORDER.length} tables, ${docBodyEntries.length} doc bodies`,
    );

    const manifestWithoutChecksum: Omit<Manifest, "checksum"> = {
      formatVersion: FORMAT_VERSION,
      toolVersion,
      exportedAt: new Date().toISOString(),
      spaceId,
      sourceHost,
      fidelity: "full",
      excludesSecrets: true,
      tables: tableCounts,
      blobCount,
      blobBytes,
      textBlobCount,
      textBlobBytes,
    };
    return await writer.finalize(manifestWithoutChecksum);
  } catch (error) {
    await writer.abort();
    throw error;
  }
}
