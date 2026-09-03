import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, type WriteStream } from "node:fs";
import { open, stat, unlink } from "node:fs/promises";
import { Readable } from "node:stream";
import {
  type DumpTable,
  DumpTableSchema,
  EXPORT_DOC_BODIES_MAX_BATCH,
} from "busabase-contract/domains/dump/types";
import type { BusabaseClient } from "busabase-sdk";
import { isTransientError } from "../../retry.js";
import { ArchiveWriter } from "../format/archive-writer.js";
import { FORMAT_VERSION, type Manifest } from "../format/manifest.js";
import { IMPORT_ORDER } from "../import/full-importer.js";

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
 * reaches `consume` as a failure and the run continues — the loops below
 * already treat a single unreachable blob as a warning, not a reason to lose
 * the other 10,485.
 */
const forEachConcurrent = async <T, R>(
  items: readonly T[],
  limit: number,
  work: (item: T) => Promise<R>,
  consume: (settled: Settled<R>, item: T) => Promise<void> | void,
): Promise<void> => {
  const inFlight = new Map<number, Promise<Settled<R>>>();
  let started = 0;

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

/**
 * Same NDJSON-entry shape as {@link writeNdjsonEntry}, but for a table built
 * one row at a time over a long fetch loop (attachment blobs, asset-text
 * blobs) instead of already sitting in memory. `ArchiveWriter.addStream`
 * requires the entry's total byte size up front (a tar constraint), which is
 * why `writeNdjsonEntry` collects every row into an array first — fine for
 * table rows, but a real space's attachment blobs (base64-encoded, one row
 * per file) can total many GB. Held as an array of Buffers so their combined
 * size could be summed, that blew Node's default heap outright — confirmed
 * live: "JavaScript heap out of memory" partway through a ~5.7GB attachment
 * set. Spooling each row to a temp file as it's produced, then streaming
 * that file into the archive once its final size is known from disk, keeps
 * peak memory bounded by one row at a time rather than the whole table.
 */
class SpooledNdjsonEntry {
  private readonly path: string;
  private stream: WriteStream;

  /**
   * `spoolPath` is deterministic (derived from the archive path) rather than a
   * random temp name, so a killed backup leaves a file the next run can find
   * and continue from — see `recoverCompleteRows`. A random name in `tmpdir()`
   * left nothing but an orphan nobody could match back to its archive.
   */
  constructor(spoolPath: string, append: boolean) {
    this.path = spoolPath;
    this.stream = createWriteStream(this.path, append ? { flags: "a" } : {});
  }

  async writeRow(row: Record<string, unknown>): Promise<void> {
    const buf = Buffer.from(`${JSON.stringify(row)}\n`, "utf8");
    if (!this.stream.write(buf)) {
      await new Promise<void>((resolve) => this.stream.once("drain", resolve));
    }
  }

  async finish(writer: ArchiveWriter, archivePath: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.stream.end((error: unknown) => (error ? reject(error) : resolve()));
    });
    const { size } = await stat(this.path);
    await writer.addStream(archivePath, size, createReadStream(this.path));
    await unlink(this.path);
  }
}

/**
 * What a previous, killed run already spooled: the identifying key of every
 * COMPLETE row, plus the totals those rows represent.
 *
 * "Complete" is load-bearing. A process killed mid-write leaves a final line
 * with no trailing newline — valid-looking JSON prefix, truncated content. The
 * file is therefore truncated back to its last newline before anything is
 * appended, so a resumed run can never splice new output onto half a row.
 *
 * Byte totals are recomputed from the base64 lengths WITHOUT decoding: a real
 * space's spool is ~5.7GB, and decoding it just to re-derive a counter would
 * cost more than re-downloading. base64 encodes 3 bytes per 4 chars, minus one
 * byte per `=` of padding.
 */
/**
 * Suffixes of the two spool files a backup writes next to its archive, in the
 * order `exportFull` derives them (attachment blobs, then asset-text blobs).
 * Exported so `commands.ts` can detect leftovers from an interrupted run
 * without duplicating the naming.
 */
export const SPOOL_SUFFIXES = [".attachment-blobs.part", ".asset-text-blobs.part"] as const;

const decodedBase64Bytes = (base64: string): number => {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, (base64.length * 3) / 4 - padding);
};

const recoverCompleteRows = async (
  spoolPath: string,
  keyField: string,
): Promise<{ keys: Set<string>; count: number; bytes: number }> => {
  const keys = new Set<string>();
  let count = 0;
  let bytes = 0;
  let completeBytes = 0;

  let handle: Awaited<ReturnType<typeof open>>;
  try {
    handle = await open(spoolPath, "r+");
  } catch {
    return { keys, count, bytes }; // nothing spooled yet
  }
  try {
    let carry = "";
    // `autoClose: false` — the default closes the underlying handle when the
    // stream ends, and the `truncate` below still needs it open.
    for await (const chunk of handle.createReadStream({ encoding: "utf8", autoClose: false })) {
      carry += chunk as string;
      let newlineIndex: number;
      // biome-ignore lint/suspicious/noAssignInExpressions: standard incremental-parse idiom
      while ((newlineIndex = carry.indexOf("\n")) !== -1) {
        const line = carry.slice(0, newlineIndex);
        carry = carry.slice(newlineIndex + 1);
        completeBytes += Buffer.byteLength(line, "utf8") + 1;
        if (!line) continue;
        // A complete line can still be corrupt if the kill landed mid-flush of
        // a buffer that already contained a newline. Treat unparseable as the
        // end of trustworthy content rather than crashing the resume.
        let row: Record<string, unknown>;
        try {
          row = JSON.parse(line);
        } catch {
          completeBytes -= Buffer.byteLength(line, "utf8") + 1;
          carry = "";
          break;
        }
        const key = row[keyField];
        if (typeof key !== "string") continue;
        keys.add(key);
        count += 1;
        bytes += decodedBase64Bytes(typeof row.base64 === "string" ? row.base64 : "");
      }
    }
    // Drop the trailing partial (or post-corruption) region so appends start
    // on a clean row boundary.
    await handle.truncate(completeBytes);
  } finally {
    await handle.close();
  }
  return { keys, count, bytes };
};

// Every dump-eligible table, taken straight from the contract enum (the single
// source of truth). FETCH order here is irrelevant — each table is drained
// independently into `tableRows`, and the doc-body / attachment-blob passes
// below read from that already-collected map. Deriving this instead of
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
 * `nodes.parentId` is deliberately absent despite being a real self-FK: the
 * importer rewrites it (dropping the source root and remapping its children
 * onto the target's own root — see `import-logic.ts`), so a parentId that
 * looks dangling here is resolved server-side.
 */
const DUMP_FOREIGN_KEYS: Partial<Record<DumpTable, Record<string, DumpTable>>> = {
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
const pruneToCurrentState = (
  tableRows: Partial<Record<DumpTable, Array<Record<string, unknown>>>>,
  tableCounts: Record<string, number>,
  log: (message: string) => void,
): void => {
  const before = Object.fromEntries(
    HISTORY_TABLES.map((t) => [t, (tableRows[t] ?? []).length] as const),
  );
  const beforeFieldValues = (tableRows.fieldValues ?? []).length;

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
  const keptFieldValues = (tableRows.fieldValues ?? []).filter((fv) => {
    if (fv.recordId) return true;
    if (fv.changeRequestId && keptCrIds.has(fv.changeRequestId as string)) return true;
    return Boolean(fv.operationId) && keptOpIds.has(fv.operationId as string);
  });

  // A surviving current value may still name the (now dropped) change request
  // that originally produced it. Those columns are nullable by design, so
  // clear them rather than dragging finished history back in to satisfy an FK.
  for (const fv of keptFieldValues) {
    if (fv.changeRequestId && !keptCrIds.has(fv.changeRequestId as string)) {
      fv.changeRequestId = null;
    }
    if (fv.operationId && !keptOpIds.has(fv.operationId as string)) fv.operationId = null;
  }

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
  const neededCommitIds = new Set<string>();
  const need = (id: unknown) => {
    if (typeof id === "string" && id) neededCommitIds.add(id);
  };
  for (const r of tableRows.records ?? []) need(r.headCommitId);
  for (const rl of tableRows.recordLinks ?? []) need(rl.commitId);
  for (const fv of keptFieldValues) need(fv.commitId);
  for (const op of keptOperations) need(op.headCommitId);
  for (const c of keptComments) need(c.commitId);
  const keptCommits = (tableRows.commits ?? []).filter((c) => neededCommitIds.has(c.id as string));

  const assign = (table: DumpTable, rows: Array<Record<string, unknown>>) => {
    tableRows[table] = rows;
    tableCounts[table] = rows.length;
  };
  assign("fieldValues", keptFieldValues);
  assign(
    "changeRequests",
    (tableRows.changeRequests ?? []).filter((cr) => keptCrIds.has(cr.id as string)),
  );
  assign("operations", keptOperations);
  assign("reviews", keptReviews);
  assign("comments", keptComments);
  assign("commits", keptCommits);
  // Audit events are a pure append-only trail — nothing references them, and
  // "who did what when" is exactly what `--no-history` is asked to leave out.
  assign("auditEvents", []);

  const dropped = (table: DumpTable) => before[table] - (tableRows[table] ?? []).length;
  log(
    `  --no-history: kept ${keptFieldValues.length}/${beforeFieldValues} fieldValues ` +
      `(dropped ${beforeFieldValues - keptFieldValues.length} staged in finished change requests), ` +
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
   * 500, matching the contract's default — see `ExportTablesInputSchema` in
   * `busabase-contract/domains/dump/types`). Not exposed as a CLI flag; exists
   * so tests can force the cursor-pagination path to genuinely execute more
   * than once without needing to seed 500+ real rows. Must stay within the
   * contract's `1..2000` bound.
   */
  pageLimit?: number;
}

/**
 * Full-fidelity export: pulls every dump-eligible table via the `dump.exportTables`
 * endpoint (cursor-paginated, raw rows with original ids), doc bodies for
 * every `doc` node via the public `docs.body` read, every asset's bytes via
 * `assets.download`, and every derived extracted-text object via
 * `dump.exportAssetText`. Writes one `tree/<table>.ndjson` per table (NDJSON
 * keeps the format uniform regardless of table size).
 */
export async function exportFull(options: FullExportOptions): Promise<Manifest> {
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
  const writer = ArchiveWriter.create(outPath);
  const tableCounts: Record<string, number> = {};
  const tableRows: Partial<Record<DumpTable, Array<Record<string, unknown>>>> = {};

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
    let cursor: string | undefined;
    // A large table (fieldValues on a real space: hundreds of thousands of
    // rows, thousands of pages) can otherwise go silent for many minutes
    // between the "exported X: N rows" line for the PREVIOUS table and this
    // one — indistinguishable from a hang.
    const reportProgress = throttledProgress(
      log,
      () => `  ...${table}: ${rows.length} rows so far`,
    );
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
      rows.push(...(page.rows as Array<Record<string, unknown>>));
      cursor = page.nextCursor ?? undefined;
      if (cursor) reportProgress();
    } while (cursor);

    tableRows[table] = rows;
    tableCounts[table] = rows.length;
    log(`exported ${table}: ${rows.length} rows`);
  }

  if (!includeHistory) {
    pruneToCurrentState(tableRows, tableCounts, log);
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
  // actually carries and drop what can't resolve, so the archive is at least
  // internally self-consistent even though it isn't a perfect
  // instant-in-time snapshot. Walked in `IMPORT_ORDER` so a drop cascades: if
  // a `records` row goes, the `fieldValues` rows pointing at it go too.
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
    const exported = new Set(tables);
    const idsOf = (table: DumpTable): Set<string> | null =>
      exported.has(table) ? new Set((tableRows[table] ?? []).map((row) => row.id as string)) : null;

    const validIds = new Map<DumpTable, Set<string> | null>();
    const validIdsFor = (table: DumpTable): Set<string> | null => {
      if (!validIds.has(table)) validIds.set(table, idsOf(table));
      return validIds.get(table) ?? null;
    };

    for (const table of IMPORT_ORDER) {
      const foreignKeys = DUMP_FOREIGN_KEYS[table];
      if (!foreignKeys || !exported.has(table)) continue;
      const rows = tableRows[table] ?? [];
      if (rows.length === 0) continue;

      const kept = rows.filter((row) =>
        Object.entries(foreignKeys).every(([column, targetTable]) => {
          const id = row[column];
          // A null/absent FK is legitimately unset, not a dangling reference.
          if (id === null || id === undefined || id === "") return true;
          const valid = validIdsFor(targetTable);
          // Target table not part of this export — nothing to check against.
          return valid === null || valid.has(id as string);
        }),
      );

      const dropped = rows.length - kept.length;
      if (dropped === 0) continue;
      log(
        `  WARNING: dropped ${dropped} ${table} row(s) referencing a ` +
          `${Object.values(foreignKeys).join("/")} that this archive does not carry — a long ` +
          "backup of an actively-used space can drift out of sync with itself. Re-run the " +
          "backup for a tighter snapshot if these matter.",
      );
      tableRows[table] = kept;
      tableCounts[table] = kept.length;
      // Later tables must judge against what SURVIVED, not what was fetched.
      validIds.set(table, new Set(kept.map((row) => row.id as string)));
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
  const docBodyEntries: Array<{ nodeId: string; body: string }> = [];
  const skippedDocBodies: string[] = [];
  const reportDocProgress = throttledProgress(
    log,
    () => `  ...doc bodies: ${docBodyEntries.length}/${docNodes.length} fetched`,
  );

  // `dump.exportDocBodies` never answers NOT_FOUND for a node it cannot
  // resolve (it omits the entry instead), so a NOT_FOUND here can only mean
  // the ROUTE itself is absent — an unambiguous "server is older than this
  // CLI" signal, not a data condition.
  const isMissingRoute = (error: unknown): boolean =>
    /not found|404|no procedure|unknown procedure/i.test(
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
        return detail.body ?? "";
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

  let batchRouteAvailable = true;
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
        const byId = new Map(bodies.map((entry) => [entry.nodeId, entry.markdown]));
        for (const nodeId of nodeIds) {
          const markdown = byId.get(nodeId);
          if (markdown === undefined) {
            // The route omits an id it cannot resolve to a Doc in this space
            // rather than failing the batch. That should be unreachable here
            // (these ids came from this same archive's own `nodes` dump), so
            // surface it rather than silently archiving nothing for it.
            skippedDocBodies.push(nodeId);
            log(`  WARNING: server returned no body for doc node ${nodeId}, skipping it`);
            continue;
          }
          // Written later, in the write phase below — see that comment for why.
          docBodyEntries.push({ nodeId, body: markdown });
        }
        continue;
      } catch (error) {
        if (!isMissingRoute(error)) {
          // A genuine failure on one batch must not cost the whole archive —
          // same treatment as the attachment and asset-text loops below.
          const message = error instanceof Error ? error.message : String(error);
          skippedDocBodies.push(...nodeIds);
          log(
            `  WARNING: could not read doc bodies for ${nodeIds.length} node(s), skipping them (${message})`,
          );
          continue;
        }
        batchRouteAvailable = false;
        log(
          "  NOTE: this server predates `dump.exportDocBodies`; falling back to one request per " +
            "Doc. Archived Docs cannot be read that way, so their bodies will be missing from " +
            "this archive — upgrade the server to capture them.",
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
        log(`  WARNING: could not read doc body for node ${nodeId}, skipping it (${message})`);
      },
    );
  }
  log(`fetched ${docBodyEntries.length} doc bodies, skipped ${skippedDocBodies.length}`);

  // Attachment blobs — download every exported Asset's bytes and archive them
  // keyed by the OWNING `busabase_attachments` row's own `storageKey` (written
  // to `attachments.ndjson` next to the `attachments` table dump above), not
  // by content hash — the importer restores each blob at that exact key via
  // `storage.uploadFileToKey` before the `attachments` row that FKs into it is
  // inserted, so a re-imported Asset's `assets.download` resolves immediately.
  const attachmentsById = new Map((tableRows.attachments ?? []).map((a) => [a.id as string, a]));
  // Resuming: whatever a previous killed run finished downloading is already
  // on disk at a known path. Recover it (truncating any half-written final
  // row) and skip re-downloading those blobs — this phase is ~2/3 of a real
  // backup's wall clock, so it is the part worth not repeating.
  const recoveredBlobs = resume
    ? await recoverCompleteRows(attachmentSpoolPath, "storageKey")
    : { keys: new Set<string>(), count: 0, bytes: 0 };
  const attachmentBlobs = new SpooledNdjsonEntry(attachmentSpoolPath, resume);
  let blobCount = recoveredBlobs.count;
  let blobBytes = recoveredBlobs.bytes;
  const skippedAssets: string[] = [];
  const assetRows = tableRows.assets ?? [];
  if (recoveredBlobs.count > 0) {
    log(
      `  resuming: ${recoveredBlobs.count} attachment blob(s) already downloaded ` +
        `(${recoveredBlobs.bytes} bytes), continuing with the rest`,
    );
  }
  const reportBlobProgress = throttledProgress(
    log,
    () => `  ...attachment blobs: ${blobCount}/${assetRows.length} fetched`,
  );
  // Downloads overlap (`BLOB_DOWNLOAD_CONCURRENCY`); the spool write and the
  // counters stay strictly sequential and in order — see `forEachConcurrent`.
  await forEachConcurrent(
    assetRows,
    BLOB_DOWNLOAD_CONCURRENCY,
    async (asset) => {
      const attachment = attachmentsById.get(asset.attachmentId as string);
      // A single asset row with no resolvable bytes (e.g. an orphaned row
      // whose attachment was already removed) must not abort the whole space
      // backup — it surfaces as a warning below. `dump.importCommit`'s
      // integrity pass also cross-checks `assets` rows against blobs actually
      // present in the archive, so a caller can see this gap on import too.
      if (!attachment) throw new Error("no matching attachments row (orphaned asset)");
      // Already spooled by a previous run — its bytes are on disk, so neither
      // the `assets.download` round trip nor the transfer is needed again.
      if (recoveredBlobs.keys.has(attachment.storageKey as string)) return null;
      // Retried as a unit. Neither round trip below was retried at all before:
      // `assets.download` is an oRPC POST, which the shared `withRetry`
      // refuses to repeat, and the byte transfer is a bare `fetch` that never
      // went through that wrapper. A blip on either one dropped the blob and
      // logged a warning, so the backup finished "successfully" MISSING an
      // attachment — a silent hole in a disaster-recovery archive, which is
      // worse than a loud failure. Re-requesting the download url is
      // deliberate: it may be a short-lived signed url that expired.
      return await fetchPageWithRetry(
        async () => {
          const download = await client.assets.download({ assetId: asset.id as string });
          // A local (non-S3) server returns a root-relative `downloadUrl` (e.g.
          // `/api/storage/...`) meant to be fetched same-origin from the
          // browser. `busabase-cli backup` runs out-of-process, so it must resolve
          // that against the configured server host itself — found live against a real
          // seeded server (a bare `fetch("/api/...")` throws "Failed to parse
          // URL" in Node), not just inferred from reading the code.
          const resolvedUrl = new URL(download.downloadUrl, sourceHost).toString();
          const res = await fetch(resolvedUrl);
          if (!res.ok || !res.body) {
            throw new Error(`HTTP ${res.status}`);
          }
          return {
            storageKey: attachment.storageKey as string,
            mimeType: download.mimeType,
            buf: Buffer.from(await res.arrayBuffer()),
          };
        },
        (attempt, error) =>
          log(
            `  retrying asset ${asset.id} (attempt ${attempt}/${retries}): ${
              error instanceof Error ? error.message : String(error)
            }`,
          ),
        isTransientError,
        retries,
      );
    },
    async (settled, asset) => {
      reportBlobProgress();
      const assetId = asset.id as string;
      if (!settled.ok) {
        const { error } = settled;
        const message = error instanceof Error ? error.message : String(error);
        skippedAssets.push(assetId);
        log(`  WARNING: could not download asset ${assetId}, skipping its blob (${message})`);
        return;
      }
      if (!settled.value) return; // already recovered from a previous run
      const { storageKey, mimeType, buf } = settled.value;
      await attachmentBlobs.writeRow({ storageKey, mimeType, base64: buf.toString("base64") });
      blobCount += 1;
      blobBytes += buf.length;
    },
  );
  log(
    `fetched ${blobCount} attachment blobs (${blobBytes} bytes), skipped ${skippedAssets.length}`,
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
  const recoveredTexts = resume
    ? await recoverCompleteRows(assetTextSpoolPath, "textStorageKey")
    : { keys: new Set<string>(), count: 0, bytes: 0 };
  const textBlobs = new SpooledNdjsonEntry(assetTextSpoolPath, resume);
  // Seeded with what a previous run already wrote, so the content-addressed
  // dedupe below still holds across the resume boundary.
  const seenTextKeys = new Set<string>(recoveredTexts.keys);
  let textBlobCount = recoveredTexts.count;
  let textBlobBytes = recoveredTexts.bytes;
  const skippedAssetTexts: string[] = [];
  const assetTextRows = tableRows.assetTexts ?? [];
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
          if (!info.downloadUrl) return null;
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
          const buf = Buffer.from(await res.arrayBuffer());
          // The key IS the sha256 of these bytes, so a text that comes back even
          // one byte different (a line-oriented reader dropping a trailing
          // newline, a proxy re-encoding the body) would restore to a key that no
          // longer matches its own `textContentHash`. Verify rather than assume —
          // a corrupt backup that reports success is worse than a loud skip.
          if (info.textContentHash) {
            const actual = `sha256:${createHash("sha256").update(buf).digest("hex")}`;
            if (actual !== info.textContentHash) {
              throw new Error(
                `content hash mismatch (expected ${info.textContentHash}, downloaded ${actual})`,
              );
            }
          }
          return { textStorageKey: info.textStorageKey, buf };
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
        const message = error instanceof Error ? error.message : String(error);
        skippedAssetTexts.push(assetId);
        log(
          `  WARNING: could not download text for asset ${assetId}, skipping its blob (${message})`,
        );
        return;
      }
      if (!settled.value) return;
      const { textStorageKey, buf } = settled.value;
      // Keys are content-addressed, so two assets holding identical text share
      // one key. Dedupe HERE, in the sequential step — checking a shared Set
      // from inside the concurrent work function would race (two in-flight
      // downloads of the same key would both see it absent). The cost is
      // downloading a duplicate we then discard, which is rare and bounded.
      if (seenTextKeys.has(textStorageKey)) return;
      seenTextKeys.add(textStorageKey);
      await textBlobs.writeRow({ textStorageKey, base64: buf.toString("base64") });
      textBlobCount += 1;
      textBlobBytes += buf.length;
    },
  );
  log(
    `fetched ${textBlobCount} asset-text blobs (${textBlobBytes} bytes), skipped ${skippedAssetTexts.length}`,
  );

  // Write phase — everything above only FETCHED data into memory; nothing has
  // touched the archive file yet. Entries are written here in the exact
  // order `full-importer.ts` needs to encounter them while streaming the
  // file back in a single pass (blobs before the table rows that reference
  // them, tables in FK-safe `IMPORT_ORDER`, doc bodies last): `streamArchive`
  // processes entries strictly in tar-physical order, so THIS order is what
  // makes a true single-pass streaming restore possible without re-reading
  // the file per table. See the matching comment on `IMPORT_ORDER`.
  await attachmentBlobs.finish(writer, "tree/attachmentBlobs.ndjson");
  await textBlobs.finish(writer, "tree/assetTextBlobs.ndjson");
  for (const table of IMPORT_ORDER) {
    // `--no-history` never fetched these tables at all (see `tables` above)
    // — omit the entry entirely rather than writing an empty one, matching
    // the archive's previous shape for a `--no-history` backup.
    if (!tables.includes(table)) continue;
    await writeNdjsonEntry(writer, `tree/${table}.ndjson`, tableRows[table] ?? []);
  }
  for (const doc of docBodyEntries) {
    await writer.addBuffer(`docs/${doc.nodeId}.md`, doc.body);
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
  return writer.finalize(manifestWithoutChecksum);
}
