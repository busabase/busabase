import "server-only";

import { StringDecoder } from "node:string_decoder";
import { and, asc, count, eq, exists, gt, isNull, notExists, or, sql } from "drizzle-orm";
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

/** Read at most the projection cap, then atomically publish if its version is current. */
export const reindexAssetText = async (db: Db, assetId: string): Promise<boolean> => {
  await acquireReader();
  try {
    const [row] = await db
      .select()
      .from(busabaseAssetTexts)
      .where(eq(busabaseAssetTexts.assetId, assetId))
      .limit(1);
    if (!row || row.status !== "present") return false;
    const builder = new AssetSearchProjectionBuilder();
    const deadline = Date.now() + 30_000;
    for await (const bytes of readObjectInChunks(row.textStorageKey, 1024 * 1024)) {
      if (Date.now() >= deadline) return false;
      builder.write(bytes);
      // Do not fetch the remaining gigabytes just to build a bounded index.
      if (builder.full) {
        builder.write(Buffer.from(" "));
        break;
      }
    }
    const projection = builder.finish();
    return await db.transaction(async (tx) => {
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
  } catch {
    // Missing/corrupt objects stay unindexed, observable via completeness.
    return false;
  } finally {
    releaseReader();
  }
};

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

const missingProjectionCondition = (db: Db) =>
  notExists(
    db
      .select({ one: sql`1` })
      .from(busabaseAssetTextSearch)
      .where(
        and(
          eq(busabaseAssetTextSearch.assetId, busabaseAssets.id),
          eq(busabaseAssetTextSearch.textStorageKey, busabaseAssetTexts.textStorageKey),
        ),
      ),
  );

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
  failedAssetIds: string[];
  nextCursor: string | undefined;
}> => {
  const limit = Math.max(1, Math.min(opts.limit ?? 25, 100));
  const rows = await db
    .select({ assetId: busabaseAssets.id, status: busabaseAssetTexts.status })
    .from(busabaseAssets)
    .leftJoin(busabaseAssetTexts, eq(busabaseAssetTexts.assetId, busabaseAssets.id))
    .where(
      and(
        opts.spaceId ? eq(busabaseAssets.spaceId, opts.spaceId) : undefined,
        opts.afterAssetId ? gt(busabaseAssets.id, opts.afterAssetId) : undefined,
        or(
          eq(busabaseAssetTexts.status, "present"),
          and(eq(busabaseAssets.contentKind, "text"), isNull(busabaseAssetTexts.assetId)),
        ),
        missingProjectionCondition(db),
        // Only mounted, live content; migration retry uploads cannot flood backfill.
        exists(
          db
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
      ),
    )
    .orderBy(asc(busabaseAssets.id))
    .limit(limit);
  let indexed = 0;
  let failed = 0;
  const pending = [...rows];
  const failedAssetIds: string[] = [];
  const failures = cooldownFor(db);
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      for (let row = pending.shift(); row; row = pending.shift()) {
        if (opts.coolDownFailures && (failures.get(row.assetId) ?? 0) > Date.now()) {
          failed++;
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
          ok = await reindexAssetText(db, row.assetId);
        } catch {
          /* This row remains missing and will be reported/retried. */
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
    failedAssetIds,
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
      const deadline = Date.now() + 30_000;
      let afterAssetId: string | undefined;
      let failed = 0;
      do {
        const page = await backfillAssetTextSearch(db, {
          spaceId,
          afterAssetId,
          coolDownFailures: true,
        });
        failed += page.failed;
        afterAssetId = page.nextCursor;
      } while (afterAssetId && Date.now() < deadline);
      return !afterAssetId && failed === 0;
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
