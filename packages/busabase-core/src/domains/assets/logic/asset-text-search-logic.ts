import "server-only";

import { StringDecoder } from "node:string_decoder";
import { and, asc, count, eq, exists, gt, ilike, isNull, notExists, or, sql } from "drizzle-orm";
import type { BusabaseDatabase as Db } from "../../../context";
import { busabaseAssets, busabaseAssetUsages, busabaseNodes } from "../../../db/schema";
import {
  busabaseAssetTextSearch,
  busabaseAssetTextSearchChunks,
} from "../schema/asset-text-search";
import { busabaseAssetTexts } from "../schema/asset-texts";
import { readObjectInChunks } from "./object-stream";
import { StreamingUtf8Validator } from "./utf8-scan";

export const ASSET_SEARCH_CHUNK_CHARS = 16_384;
/** Queries up to this length cannot disappear at a chunk boundary. */
export const ASSET_SEARCH_OVERLAP_CHARS = 512;
/**
 * 2M UTF-16 units per asset, the same order as mainstream document search
 * (SharePoint stops parsing an item at 2M characters). Covers whole contracts,
 * reports and typical exports; the tail of a larger log/CSV is reported via
 * `contentTruncated` and remains fully accessible to grep. Every stored unit
 * costs ~1.3x in table+trigram index and is scanned by sub-trigram (two-CJK-
 * character) queries, so a few huge files must not dominate a space's index.
 */
export const ASSET_SEARCH_MAX_CHARS = 2_000_000;

export interface AssetSearchProjection {
  chunks: string[];
  complete: boolean;
}

/** Collects a bounded search projection alongside putText's existing stream. */
export class AssetSearchProjectionBuilder {
  private decoder = new StringDecoder("utf8");
  private utf8 = new StreamingUtf8Validator();
  private pending = "";
  private chunks: string[] = [];
  private chars = 0;
  private complete = true;

  write(bytes: Buffer): void {
    if (this.chars >= ASSET_SEARCH_MAX_CHARS) {
      if (bytes.length > 0) this.complete = false;
      return;
    }
    this.utf8.push(bytes);
    this.append(this.decoder.write(bytes));
  }

  private append(text: string): void {
    const available = ASSET_SEARCH_MAX_CHARS - this.chars;
    if (text.length > available) this.complete = false;
    const accepted = text.slice(0, available);
    this.chars += accepted.length;
    // Postgres text cannot contain U+0000. Keep the readable part, but never
    // claim that its projection is an exact, complete representation.
    if (accepted.includes("\0")) this.complete = false;
    this.pending += accepted.replaceAll("\0", "\ufffd");
    while (this.pending.length > ASSET_SEARCH_CHUNK_CHARS) {
      let end = ASSET_SEARCH_CHUNK_CHARS;
      const last = this.pending.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) end--;
      this.chunks.push(this.pending.slice(0, end));
      let next = end - ASSET_SEARCH_OVERLAP_CHARS;
      const first = this.pending.charCodeAt(next);
      if (first >= 0xdc00 && first <= 0xdfff) next--;
      this.pending = this.pending.slice(next);
    }
  }

  get full(): boolean {
    return this.chars >= ASSET_SEARCH_MAX_CHARS;
  }

  finish(): AssetSearchProjection {
    this.append(this.decoder.end());
    if (this.pending.length > 0) this.chunks.push(this.pending);
    return { chunks: this.chunks, complete: this.complete && this.utf8.finish() };
  }
}

/** Caller holds the current text row lock / is writing it in this transaction. */
export const publishAssetTextProjection = async (
  db: Db,
  input: {
    assetId: string;
    spaceId: string;
    textStorageKey: string;
    projection: AssetSearchProjection;
  },
): Promise<void> => {
  const { projection, ...header } = input;
  await db
    .insert(busabaseAssetTextSearch)
    .values({ ...header, complete: projection.complete })
    .onConflictDoUpdate({
      target: busabaseAssetTextSearch.assetId,
      set: { ...header, complete: projection.complete, indexedAt: new Date() },
    });
  await db
    .delete(busabaseAssetTextSearchChunks)
    .where(eq(busabaseAssetTextSearchChunks.assetId, input.assetId));
  for (let offset = 0; offset < projection.chunks.length; offset += 128) {
    await db.insert(busabaseAssetTextSearchChunks).values(
      projection.chunks.slice(offset, offset + 128).map((contentText, index) => ({
        assetId: input.assetId,
        chunkIndex: offset + index,
        contentText,
      })),
    );
  }
};

// Across spaces and upload warmers, keep at most four projection buffers
// alive. A bulk upload queues ids rather than one capped buffer per file.
let activeReaders = 0;
const waitingReaders: (() => void)[] = [];
const acquireReader = async (): Promise<void> => {
  if (activeReaders < 4) {
    activeReaders++;
    return;
  }
  await new Promise<void>((resolve) => waitingReaders.push(resolve));
};
const releaseReader = (): void => {
  const next = waitingReaders.shift();
  if (next) next();
  else activeReaders--;
};

/** What one reindex attempt did and what it cost. Never carries any document text. */
export interface ReindexReport {
  ok: boolean;
  /** Why it did not index. Absent when there was nothing to index. */
  reason?: "read-deadline" | "superseded" | "error";
  /** `name code: message` of the error, trimmed. */
  message?: string;
  /** Reading the text object from storage, and publishing the projection. */
  readMs: number;
  publishMs: number;
  chars: number;
  chunks: number;
}

const describeError = (error: unknown): string => {
  if (!(error instanceof Error)) return String(error).slice(0, 200);
  const code = "code" in error && typeof error.code === "string" ? ` ${error.code}` : "";
  return `${error.name}${code}: ${error.message}`.slice(0, 200);
};

/**
 * Read at most the projection cap, then atomically publish if its version is
 * current. `onReport` receives the outcome and timings of this attempt, which
 * is how the self-heal and the operator command learn why an asset stayed
 * unindexed.
 */
export const reindexAssetText = async (
  db: Db,
  assetId: string,
  onReport?: (report: ReindexReport) => void,
): Promise<boolean> => {
  await acquireReader();
  const report: ReindexReport = { ok: false, readMs: 0, publishMs: 0, chars: 0, chunks: 0 };
  try {
    const [row] = await db
      .select()
      .from(busabaseAssetTexts)
      .where(eq(busabaseAssetTexts.assetId, assetId))
      .limit(1);
    if (!row || row.status !== "present") return false;
    const builder = new AssetSearchProjectionBuilder();
    const deadline = Date.now() + 30_000;
    const readStarted = Date.now();
    for await (const bytes of readObjectInChunks(row.textStorageKey, 1024 * 1024)) {
      if (Date.now() >= deadline) {
        report.reason = "read-deadline";
        report.readMs = Date.now() - readStarted;
        return false;
      }
      builder.write(bytes);
      // Do not fetch the remaining gigabytes just to build a bounded index.
      if (builder.full) {
        builder.write(Buffer.from(" "));
        break;
      }
    }
    report.readMs = Date.now() - readStarted;
    const projection = builder.finish();
    report.chunks = projection.chunks.length;
    report.chars = projection.chunks.reduce((total, chunk) => total + chunk.length, 0);
    const publishStarted = Date.now();
    const published = await db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(busabaseAssetTexts)
        .where(eq(busabaseAssetTexts.assetId, assetId))
        .for("update");
      if (!current || current.status !== "present" || current.textStorageKey !== row.textStorageKey)
        return false;
      await publishAssetTextProjection(tx, {
        assetId,
        spaceId: row.spaceId,
        textStorageKey: row.textStorageKey,
        projection,
      });
      return true;
    });
    report.publishMs = Date.now() - publishStarted;
    if (!published) report.reason = "superseded";
    report.ok = published;
    return published;
  } catch (error) {
    // Missing/corrupt objects stay unindexed, observable via completeness, and
    // now also through the report.
    report.reason = "error";
    report.message = describeError(error);
    return false;
  } finally {
    releaseReader();
    onReport?.(report);
  }
};

/**
 * At most `max` lines per `windowMs`; the rest are counted and reported as one
 * line when the window rolls over, so a space full of failing assets cannot
 * flood the log.
 */
export const createRateLimitedLog = (
  write: (line: string) => void,
  opts: { max: number; windowMs: number; now?: () => number },
): ((line: string) => void) => {
  const now = opts.now ?? Date.now;
  let windowStart = Number.NEGATIVE_INFINITY;
  let emitted = 0;
  let suppressed = 0;
  return (line) => {
    const at = now();
    if (at - windowStart >= opts.windowMs) {
      if (suppressed > 0) write(`[asset-text-search] ${suppressed} similar lines suppressed`);
      windowStart = at;
      emitted = 0;
      suppressed = 0;
    }
    if (emitted < opts.max) {
      emitted++;
      write(line);
    } else {
      suppressed++;
    }
  };
};

const logReindexFailure = createRateLimitedLog((line) => console.warn(line), {
  max: 20,
  windowMs: 5 * 60_000,
});

/** Native uploads may warm a small index, but never wait for a large/slow object. */
const warming = new WeakMap<Db, Map<string, Promise<boolean>>>();
export const warmAssetTextProjection = async (db: Db, assetId: string): Promise<void> => {
  let assets = warming.get(db);
  if (!assets) {
    assets = new Map();
    warming.set(db, assets);
  }
  let run = assets.get(assetId);
  if (!run) {
    run = reindexAssetText(db, assetId).finally(() => assets.delete(assetId));
    assets.set(assetId, run);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      run,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 300);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

const failedUntil = new WeakMap<Db, Map<string, number>>();
const cooldownFor = (db: Db): Map<string, number> => {
  let failures = failedUntil.get(db);
  if (!failures) {
    failures = new Map();
    failedUntil.set(db, failures);
  }
  return failures;
};

/** The asset has a mounted usage on a node that is not archived. */
const liveUsageExists = (
  db: Db,
  assetId: typeof busabaseAssets.id | typeof busabaseAssetTexts.assetId,
) =>
  exists(
    db
      .select({ one: sql`1` })
      .from(busabaseAssetUsages)
      .innerJoin(busabaseNodes, eq(busabaseNodes.id, busabaseAssetUsages.nodeId))
      .where(and(eq(busabaseAssetUsages.assetId, assetId), isNull(busabaseNodes.archivedAt))),
  );

/** Subquery: a projection of exactly this text slot's current version (complete or not). */
const currentProjectionOf = (db: Db) =>
  db
    .select({ one: sql`1` })
    .from(busabaseAssetTextSearch)
    .where(
      and(
        eq(busabaseAssetTextSearch.assetId, busabaseAssetTexts.assetId),
        eq(busabaseAssetTextSearch.textStorageKey, busabaseAssetTexts.textStorageKey),
      ),
    );

/** Subquery: a COMPLETE projection of exactly this text slot's current version. */
const completeProjectionOf = (db: Db) =>
  db
    .select({ one: sql`1` })
    .from(busabaseAssetTextSearch)
    .where(
      and(
        eq(busabaseAssetTextSearch.assetId, busabaseAssetTexts.assetId),
        eq(busabaseAssetTextSearch.textStorageKey, busabaseAssetTexts.textStorageKey),
        eq(busabaseAssetTextSearch.complete, true),
      ),
    );

/** Subquery: the asset's text slot. */
const textSlotOf = (db: Db) =>
  db
    .select({ one: sql`1` })
    .from(busabaseAssetTexts)
    .where(eq(busabaseAssetTexts.assetId, busabaseAssets.id));

// The two scans below drive from the SMALL tables. Text slots are a small
// fraction of a space's assets (24,520 of 142,924 in Vika Office), and these
// run on every full search, so starting from `busabase_assets` and joining out
// cost 1.2 s per search at that size, against 25 ms from the text slots.

/** Ids of text slots whose current projection is missing or partial. */
export const incompleteTextAssetIds = (db: Db, spaceId: string) =>
  db
    .select({ assetId: busabaseAssetTexts.assetId })
    .from(busabaseAssetTexts)
    .where(
      and(
        eq(busabaseAssetTexts.spaceId, spaceId),
        eq(busabaseAssetTexts.status, "present"),
        notExists(completeProjectionOf(db)),
      ),
    );

/** Ids of text-kind assets that never got a text slot (registered before slots existed). */
export const textWithoutSlotAssetIds = (db: Db, spaceId: string) =>
  db
    .select({ assetId: busabaseAssets.id })
    .from(busabaseAssets)
    .where(
      and(
        eq(busabaseAssets.spaceId, spaceId),
        eq(busabaseAssets.contentKind, "text"),
        notExists(textSlotOf(db)),
      ),
    );

/**
 * Whether ANY asset in the space is searchable only in part, regardless of who
 * may see it. A space that answers "no" can skip the per-caller probe, which
 * is what keeps a fully indexed space's searches cheap.
 */
export const assetTextCoverageGap = async (
  db: Db,
  spaceId: string,
): Promise<{ incompleteText: boolean; textWithoutSlot: boolean }> => {
  const [incomplete] = await incompleteTextAssetIds(db, spaceId).limit(1);
  const [withoutSlot] = await textWithoutSlotAssetIds(db, spaceId).limit(1);
  return { incompleteText: incomplete !== undefined, textWithoutSlot: withoutSlot !== undefined };
};

/**
 * pg_trgm can use its index for a LIKE pattern only when some run between
 * wildcards holds three word characters. Anything shorter has no trigrams, so
 * the match must read every stored chunk.
 */
export const queryUsesTrigramIndex = (query: string): boolean => /[\p{L}\p{N}]{3,}/u.test(query);

/** Matching chunks read for one search; more means the answer may be incomplete. */
export const ASSET_TEXT_MATCH_MAX_CHUNKS = 2_000;

/**
 * Assets whose CURRENT indexed text contains `pattern`.
 *
 * Runs in its own statement, never inside the row query. Chunk text sits in
 * TOAST, so the heap has a few hundred pages however much text there is, and
 * the planner prices a sequential scan far below what detoasting every chunk
 * costs: 6.9 s for 523 MB of text, against 3 ms through the trigram index for
 * a term the index can serve. It is also why this statement turns sequential
 * scans off when the query has trigrams. A query without them (or one that
 * matches little but is not indexable, such as a two-character Chinese word)
 * still scans everything, so the caller bounds it with `statementMs` and
 * answers with what it has when that runs out.
 *
 * Must run inside a transaction: both settings are transaction-local.
 */
export const matchAssetTextAssetIds = async (
  db: Db,
  spaceId: string,
  query: string,
  pattern: string,
  opts: { statementMs: number; maxChunks?: number },
): Promise<{ assetIds: string[]; capped: boolean }> => {
  const maxChunks = opts.maxChunks ?? ASSET_TEXT_MATCH_MAX_CHUNKS;
  await db.execute(sql`select set_config('statement_timeout', ${String(opts.statementMs)}, true)`);
  if (queryUsesTrigramIndex(query)) {
    await db.execute(sql`select set_config('enable_seqscan', 'off', true)`);
  }
  const rows = await db
    .select({ assetId: busabaseAssetTextSearchChunks.assetId })
    .from(busabaseAssetTextSearchChunks)
    .innerJoin(
      busabaseAssetTextSearch,
      eq(busabaseAssetTextSearch.assetId, busabaseAssetTextSearchChunks.assetId),
    )
    .innerJoin(
      busabaseAssetTexts,
      and(
        eq(busabaseAssetTexts.assetId, busabaseAssetTextSearch.assetId),
        eq(busabaseAssetTexts.textStorageKey, busabaseAssetTextSearch.textStorageKey),
        eq(busabaseAssetTexts.status, "present"),
      ),
    )
    .where(
      and(
        eq(busabaseAssetTextSearch.spaceId, spaceId),
        ilike(busabaseAssetTextSearchChunks.contentText, pattern),
      ),
    )
    .limit(maxChunks + 1);
  return {
    assetIds: [...new Set(rows.slice(0, maxChunks).map((row) => row.assetId))],
    capped: rows.length > maxChunks,
  };
};

/** Bounded keyset page: failures never keep later assets from being visited. */
export const backfillAssetTextSearch = async (
  db: Db,
  opts: {
    spaceId?: string;
    afterAssetId?: string;
    limit?: number;
    coolDownFailures?: boolean;
  } = {},
): Promise<{
  indexed: number;
  failed: number;
  /** Of `failed`, how many were skipped because they failed within the last ten minutes. */
  cooledDown: number;
  failedAssetIds: string[];
  /** Why the others failed: reason -> count. */
  failureReasons: Record<string, number>;
  /** Time spent reading text objects and publishing projections, summed over this page. */
  readMs: number;
  publishMs: number;
  nextCursor: string | undefined;
}> => {
  const limit = Math.max(1, Math.min(opts.limit ?? 25, 100));
  // Two scans driven from the small tables (see above), merged in id order. The
  // first `limit` of the union are within the first `limit` of each list.
  const withText = await db
    .select({ assetId: busabaseAssetTexts.assetId, status: busabaseAssetTexts.status })
    .from(busabaseAssetTexts)
    .where(
      and(
        opts.spaceId ? eq(busabaseAssetTexts.spaceId, opts.spaceId) : undefined,
        opts.afterAssetId ? gt(busabaseAssetTexts.assetId, opts.afterAssetId) : undefined,
        eq(busabaseAssetTexts.status, "present"),
        notExists(currentProjectionOf(db)),
        // Only mounted, live content; migration retry uploads cannot flood backfill.
        liveUsageExists(db, busabaseAssetTexts.assetId),
      ),
    )
    .orderBy(asc(busabaseAssetTexts.assetId))
    .limit(limit);
  const legacy = await db
    .select({ assetId: busabaseAssets.id })
    .from(busabaseAssets)
    .where(
      and(
        opts.spaceId ? eq(busabaseAssets.spaceId, opts.spaceId) : undefined,
        opts.afterAssetId ? gt(busabaseAssets.id, opts.afterAssetId) : undefined,
        eq(busabaseAssets.contentKind, "text"),
        notExists(textSlotOf(db)),
        liveUsageExists(db, busabaseAssets.id),
      ),
    )
    .orderBy(asc(busabaseAssets.id))
    .limit(limit);
  const rows: { assetId: string; status: string | null }[] = [
    ...withText,
    ...legacy.map((row) => ({ assetId: row.assetId, status: null })),
  ]
    .sort((a, b) => (a.assetId < b.assetId ? -1 : a.assetId > b.assetId ? 1 : 0))
    .slice(0, limit);
  let indexed = 0;
  let failed = 0;
  let cooledDown = 0;
  let readMs = 0;
  let publishMs = 0;
  const failureReasons: Record<string, number> = {};
  const noteFailure = (assetId: string, reason: string, message?: string) => {
    failureReasons[reason] = (failureReasons[reason] ?? 0) + 1;
    logReindexFailure(
      `[asset-text-search] not indexed asset=${assetId} reason=${reason}${message ? ` error=${message}` : ""}`,
    );
  };
  const pending = [...rows];
  const failedAssetIds: string[] = [];
  const failures = cooldownFor(db);
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let row = pending.shift(); row; row = pending.shift()) {
        if (opts.coolDownFailures && (failures.get(row.assetId) ?? 0) > Date.now()) {
          failed++;
          cooledDown++;
          failedAssetIds.push(row.assetId);
          continue;
        }
        let ok = false;
        try {
          if (row.status === null) {
            const { autoRegisterAssetText } = await import("./asset-texts-logic");
            await autoRegisterAssetText(row.assetId, db, {
              knownContentKind: "text",
              knownMissing: true,
            });
          }
          ok = await reindexAssetText(db, row.assetId, (report) => {
            readMs += report.readMs;
            publishMs += report.publishMs;
            if (!report.ok && report.reason)
              noteFailure(row.assetId, report.reason, report.message);
          });
        } catch (error) {
          // This row remains missing and will be reported/retried.
          noteFailure(row.assetId, "register-error", describeError(error));
        }
        if (ok) {
          indexed++;
          failures.delete(row.assetId);
        } else {
          failed++;
          failedAssetIds.push(row.assetId);
          if (failures.size >= 10_000) failures.clear();
          failures.set(row.assetId, Date.now() + 10 * 60_000);
        }
      }
    }),
  );
  return {
    indexed,
    failed,
    cooledDown,
    failedAssetIds,
    failureReasons,
    readMs,
    publishMs,
    nextCursor: rows.length === limit ? rows.at(-1)?.assetId : undefined,
  };
};

const running = new WeakMap<Db, Map<string, Promise<boolean>>>();

/**
 * Final reconciliation scans current state, not just this run's receipts.
 * `complete` means every eligible text slot has a current projection; a
 * missing one is a failure an operator must retry. `partial` projections
 * (source over the cap, NUL bytes, invalid UTF-8) are by design: idempotent
 * backfill skips them, rerunning cannot change them, and search already
 * discloses them via `contentTruncated`. They are reported, not failed.
 */
export const auditAssetTextSearch = async (
  db: Db,
  opts: { spaceId?: string; sampleLimit?: number } = {},
): Promise<{
  complete: boolean;
  eligible: number;
  missing: number;
  partial: number;
  missingAssetIds: string[];
  partialAssetIds: string[];
  sampleLimit: number;
}> => {
  const sampleLimit = Math.max(1, Math.min(opts.sampleLimit ?? 100, 1000));
  return db.transaction(
    async (tx) => {
      const eligibleCondition = and(
        opts.spaceId ? eq(busabaseAssets.spaceId, opts.spaceId) : undefined,
        or(
          eq(busabaseAssetTexts.status, "present"),
          and(eq(busabaseAssets.contentKind, "text"), isNull(busabaseAssetTexts.assetId)),
        ),
        exists(
          tx
            .select({ one: sql`1` })
            .from(busabaseAssetUsages)
            .innerJoin(busabaseNodes, eq(busabaseNodes.id, busabaseAssetUsages.nodeId))
            .where(
              and(
                eq(busabaseAssetUsages.assetId, busabaseAssets.id),
                isNull(busabaseNodes.archivedAt),
              ),
            ),
        ),
      );
      const rows = tx
        .select({ assetId: busabaseAssets.id, complete: busabaseAssetTextSearch.complete })
        .from(busabaseAssets)
        .leftJoin(busabaseAssetTexts, eq(busabaseAssetTexts.assetId, busabaseAssets.id))
        .leftJoin(
          busabaseAssetTextSearch,
          and(
            eq(busabaseAssetTextSearch.assetId, busabaseAssets.id),
            eq(busabaseAssetTextSearch.textStorageKey, busabaseAssetTexts.textStorageKey),
          ),
        )
        .where(eligibleCondition)
        .as("eligible_asset_text_search");
      const [eligibleRow] = await tx.select({ value: count() }).from(rows);
      const [missingRow] = await tx
        .select({ value: count() })
        .from(rows)
        .where(isNull(rows.complete));
      const [partialRow] = await tx
        .select({ value: count() })
        .from(rows)
        .where(eq(rows.complete, false));
      const missingAssets = await tx
        .select({ assetId: rows.assetId })
        .from(rows)
        .where(isNull(rows.complete))
        .orderBy(asc(rows.assetId))
        .limit(sampleLimit);
      const partialAssets = await tx
        .select({ assetId: rows.assetId })
        .from(rows)
        .where(eq(rows.complete, false))
        .orderBy(asc(rows.assetId))
        .limit(sampleLimit);
      const missing = missingRow?.value ?? 0;
      const partial = partialRow?.value ?? 0;
      return {
        complete: missing === 0,
        eligible: eligibleRow?.value ?? 0,
        missing,
        partial,
        missingAssetIds: missingAssets.map((row) => row.assetId),
        partialAssetIds: partialAssets.map((row) => row.assetId),
        sampleLimit,
      };
    },
    { isolationLevel: "repeatable read" },
  );
};

/** Backfill never monopolizes the search's request budget. */
export const healAssetTextProjections = async (
  db: Db,
  spaceId: string,
  opts: { waitMs?: number } = {},
): Promise<boolean> => {
  let spaces = running.get(db);
  if (!spaces) {
    spaces = new Map();
    running.set(db, spaces);
  }
  let run = spaces.get(spaceId);
  if (!run) {
    const runPages = async () => {
      const startedAt = Date.now();
      const deadline = startedAt + 30_000;
      let afterAssetId: string | undefined;
      const total = { pages: 0, indexed: 0, failed: 0, cooledDown: 0, readMs: 0, publishMs: 0 };
      const reasons: Record<string, number> = {};
      do {
        const page = await backfillAssetTextSearch(db, {
          spaceId,
          afterAssetId,
          coolDownFailures: true,
        });
        total.pages++;
        total.indexed += page.indexed;
        total.failed += page.failed;
        total.cooledDown += page.cooledDown;
        total.readMs += page.readMs;
        total.publishMs += page.publishMs;
        for (const [reason, count] of Object.entries(page.failureReasons)) {
          reasons[reason] = (reasons[reason] ?? 0) + count;
        }
        afterAssetId = page.nextCursor;
      } while (afterAssetId && Date.now() < deadline);
      // One line per run (at most one per 30 s per space), only when it did
      // something: how many it indexed, how many failed and why, and where the
      // time went (storage reads against database writes).
      if (total.indexed + total.failed > 0) {
        console.info(
          `[asset-text-search] heal run space=${spaceId} pages=${total.pages} indexed=${total.indexed} failed=${total.failed} cooledDown=${total.cooledDown} readMs=${total.readMs} publishMs=${total.publishMs} elapsedMs=${Date.now() - startedAt} finished=${!afterAssetId} reasons=${JSON.stringify(reasons)}`,
        );
      }
      return !afterAssetId && total.failed === 0;
    };
    run = runPages()
      .catch(() => false)
      .finally(() => spaces.delete(spaceId));
    spaces.set(spaceId, run);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run,
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), opts.waitMs ?? 300);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
