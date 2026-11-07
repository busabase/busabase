import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  ilike,
  inArray,
  like,
  lt,
  lte,
  or,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import type { DbInstance } from "../db";
import { busabaseCommits, busabaseFieldValues } from "../db/schema";
import { busabaseBases } from "../domains/base/schema";

/** Ordinary search treats LIKE metacharacters as text; grep owns patterns. */
export const literalSearchPattern = (query: string): string =>
  `%${query.replace(/[\\%_]/g, "\\$&")}%`;

/**
 * A substring with no three consecutive word characters cannot use a selective
 * trigram lookup. Count Unicode characters so two-character CJK queries retain
 * substring semantics. Conservative fallback also covers separated short words.
 */
export const needsScopedRecordScan = (query: string): boolean => !/[\p{L}\p{N}]{3}/u.test(query);

/**
 * Matching field values one search ranks: the newest this many, plus however
 * many deeper pages need. Ranking every match computed `to_tsvector` and
 * `ts_rank` for each one before LIMIT; a common word in a space with 70k
 * records matched over 100k values and every such search timed out.
 */
export const RECORD_SEARCH_WINDOW_ROWS = 1_000;

/**
 * Never more than this, however deep the page: the window's ids are bound one
 * parameter each when it is ranked, and Postgres takes at most 65,534.
 */
const MAX_WINDOW_ROWS = 10_000;

export const recordSearchWindowRows = (candidateWindow: number): number =>
  Math.min(MAX_WINDOW_ROWS, Math.max(RECORD_SEARCH_WINDOW_ROWS, candidateWindow * 4));

/**
 * Scan steps, in ids. The first is small; each later one is sized from how
 * long the last took, toward a step time that leaves room to stop on time.
 * Values run up to 8,000 characters and are stored out of line, so the same
 * number of ids can cost ten times more in one space than in another.
 */
const FIRST_STEP_ROWS = 2_000;
const MIN_STEP_ROWS = 500;
const MAX_STEP_ROWS = 200_000;

/** A statement that would otherwise start with no time left still gets this long. */
const MIN_STATEMENT_MS = 25;

/** The id-range lookup's share of the match budget, and its cap. */
const RANGE_LOOKUP_SHARE = 0.2;
const RANGE_LOOKUP_MAX_MS = 300;

/**
 * How far a field value id's time may sit outside its Base's commit times.
 * Values are written right after their commit, by the same process clock.
 */
const ID_RANGE_SLACK_MS = 60 * 60_000;

/** Lowercasing changes nothing (CJK, digits, symbols): LIKE and ILIKE agree, and LIKE skips the case folding. */
const isCaseless = (query: string): boolean => query.toLowerCase() === query.toUpperCase();

/** Every letter that has case is ASCII, so folding ASCII alone matches ILIKE. */
const hasOnlyAsciiCase = (query: string): boolean =>
  [...query].every((char) => char.toLowerCase() === char.toUpperCase() || char <= "\u007f");

/**
 * One run of letters/digits parses to a single lexeme. A value holding that
 * lexeme holds the query as a substring, so the substring test already finds
 * every full-text match.
 */
const isSingleWord = (query: string): boolean => /^[\p{L}\p{N}]+$/u.test(query);

/** Substring test the trigram indexes can answer (only for inputs with trigrams). */
const indexedSubstring = (query: string): SQL => {
  const pattern = literalSearchPattern(query);
  const contains = isCaseless(query) ? like : ilike;
  return (
    or(
      contains(busabaseFieldValues.valueText, pattern),
      contains(busabaseFieldValues.fieldSlug, pattern),
    ) ?? sql`false`
  );
};

/**
 * `column` contains `text`, as cheaply as the text allows. ILIKE folds the
 * whole value through the database locale on every row; folding under the C
 * collation (ASCII only) costs a fraction and gives the same answer when every
 * cased letter in `text` is ASCII, and caseless text needs no folding at all.
 * `strpos` is also invisible to the trigram indexes, so a pattern with no
 * trigrams can never turn into a read of the whole index across every space.
 */
const scannedContains = (column: SQLWrapper, text: string): SQL =>
  isCaseless(text)
    ? sql`strpos(${column}, ${text}) > 0`
    : hasOnlyAsciiCase(text)
      ? sql`strpos(lower(${column} collate "C"), ${text.toLowerCase()}) > 0`
      : sql`strpos(lower(${column}), lower(${text})) > 0`;

const fullTextMatch = (query: string): SQL =>
  sql`to_tsvector('simple', coalesce(${busabaseFieldValues.valueText}, '')) @@ plainto_tsquery('simple', ${query})`;

/**
 * Whether a field value matches, for scanning row by row: the query as a
 * substring of the value or the field slug, or — for a multi-word query — full
 * text. A full-text match holds every word of the query as a substring, so
 * those cheap tests run first and `to_tsvector` parses only the rows that pass.
 */
const scannedMatch = (query: string): SQL => {
  const substring =
    or(
      scannedContains(busabaseFieldValues.valueText, query),
      scannedContains(busabaseFieldValues.fieldSlug, query),
    ) ?? sql`false`;
  if (isSingleWord(query)) return substring;
  const words = query.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const everyWord = and(
    ...words.map((word) => scannedContains(busabaseFieldValues.valueText, word)),
    fullTextMatch(query),
  );
  return or(substring, everyWord) ?? substring;
};

/** The same match, in the form the trigram and full-text indexes can answer. */
const indexedMatch = (query: string): SQL =>
  isSingleWord(query)
    ? indexedSubstring(query)
    : (or(indexedSubstring(query), fullTextMatch(query)) ?? indexedSubstring(query));

const fieldValueIdAt = (epochMs: number) => `fvl${Math.max(0, epochMs).toString(36)}`;

/**
 * Before 2026-06-22 `kernel.id` wrote `${prefix}_${time}_${random}` and field
 * values used the prefix `qfv`; such ids stay until their record is written
 * again, and an import or a self-hosted install can carry them still. They
 * carry their write time too, so a space's legacy values sit in the same span
 * of time under `qfv_`.
 */
const legacyIdAt = (epochMs: number) => `qfv_${Math.max(0, epochMs).toString(36)}`;

interface IdRange {
  /** Every current field value id of the space sorts above this. */
  low: string;
  /** Every current field value id of the space sorts below this. */
  high: string;
  /** The same span for `qfv_` ids. */
  legacyLow: string;
  legacyHigh: string;
}

/**
 * The span of field value ids a space can hold, from its Bases' oldest and
 * newest commits. Field value ids embed their write time (`kernel.id`), and
 * every value is written right after a commit in its Base: record writes and
 * change-request projections project their commit (`projectCommitFields`),
 * formula recalculation writes a commit per record, and imports keep both
 * sides' original ids. Restricting a scan to this span keeps a space that has
 * not been written for months from first stepping over every newer value of
 * every other space. One index probe per Base each way.
 */
const spaceIdRange = async (db: DbInstance, spaceId: string): Promise<IdRange | null> => {
  // Spelled out: drizzle leaves columns unqualified inside a selected
  // expression, which would bind `id` to the commit instead of the Base.
  const commitTime = (direction: "asc" | "desc") =>
    sql`(select c.created_at from busabase_commits as c
      where c.base_id = busabase_bases.id
      order by c.created_at ${sql.raw(direction)} limit 1)`.mapWith(busabaseCommits.createdAt);
  const rows = await db
    .select({ oldest: commitTime("asc"), newest: commitTime("desc") })
    .from(busabaseBases)
    .where(eq(busabaseBases.spaceId, spaceId));
  const epochs = rows
    .flatMap((row) => [row.oldest, row.newest])
    .filter((at) => at !== null)
    .map((at) => new Date(at).getTime());
  if (epochs.length === 0) return null;
  const oldest = Math.min(...epochs) - ID_RANGE_SLACK_MS;
  const newest = Math.max(...epochs) + ID_RANGE_SLACK_MS;
  return {
    low: fieldValueIdAt(oldest),
    high: fieldValueIdAt(newest),
    legacyLow: legacyIdAt(oldest),
    legacyHigh: legacyIdAt(newest),
  };
};

/*
 * Id regions, all compared in the primary key's own (default) collation so the
 * scan and the index window cover exactly the same ids. `column` is the bare
 * id for primary-key ranges, or an expression of it when the comparison has to
 * stay a filter.
 */
const currentRegion = (column: SQLWrapper, range: IdRange) =>
  sql`(${column} > ${range.low} and ${column} < ${range.high})`;

/**
 * Ids this space may hold outside the current shape: legacy `qfv_` ids from
 * the space's lifetime, and anything neither shape describes (no generator
 * here writes those; an import might).
 */
const legacyRegion = (column: SQLWrapper, range: IdRange) =>
  sql`((${column} > ${range.legacyLow} and ${column} < ${range.legacyHigh})
    or ${column} < ${"fvl0"} or (${column} >= ${"fvm"} and ${column} < ${"qfv"}) or ${column} >= ${"qfw"})`;

/**
 * One matching field value, with everything an answer needs to order it, so
 * a ranking or hydration that runs out of time can still answer from it.
 */
export interface MatchRow {
  id: string;
  /** Write time, so current and legacy ids merge into one order. */
  at: number;
  recordId: string | null;
  changeRequestId: string | null;
  updatedAt: Date;
  createdAt: Date;
}

const matchColumns = {
  id: busabaseFieldValues.id,
  recordId: busabaseFieldValues.recordId,
  changeRequestId: busabaseFieldValues.changeRequestId,
  updatedAt: busabaseFieldValues.updatedAt,
  createdAt: busabaseFieldValues.createdAt,
};

type MatchRecord = Pick<
  MatchRow,
  "id" | "recordId" | "changeRequestId" | "updatedAt" | "createdAt"
>;

/** Rows found through an index or by update time carry their write time as `updatedAt`. */
const timedByUpdate = (row: MatchRecord): MatchRow => ({ ...row, at: row.updatedAt.getTime() });

/**
 * Every id any space could hold up to now: the range to scan when the
 * space's own range could not be looked up in time. No row is lost; a space
 * that has not been written for a while just steps over newer values of
 * other spaces first.
 */
const wholeIdRange = (): IdRange => {
  const newest = Date.now() + ID_RANGE_SLACK_MS;
  return {
    low: fieldValueIdAt(0),
    high: fieldValueIdAt(newest),
    legacyLow: legacyIdAt(0),
    legacyHigh: legacyIdAt(newest),
  };
};

/**
 * What a match scope has found so far, readable by its caller even when the
 * scope does not come back in time: a statement can be slow to honour its
 * cancellation, and its result is then thrown away as a timeout.
 */
export interface MatchProgress {
  rows: MatchRow[];
}

interface MatchSet {
  rows: MatchRow[];
  /** Matches may exist that `rows` does not hold. */
  truncated: boolean;
}

interface WindowInput {
  query: string;
  eligibility: SQL | undefined;
  rows: number;
  oldestFirst: boolean;
  /** No scan step starts after this epoch time. */
  scanUntil: number;
  /** Cap for the index attempt, in milliseconds. */
  indexTimeoutMs: number;
  /** Ids in the first scan step; defaults to `FIRST_STEP_ROWS`. */
  chunkRows?: number;
  /**
   * Time for looking up the space's id range; defaults to a share of the
   * match budget. Below `MIN_STATEMENT_MS` the lookup is skipped and the
   * whole range is scanned, as when it times out.
   */
  rangeTimeoutMs?: number;
}

const order = (oldestFirst: boolean) =>
  oldestFirst ? asc(busabaseFieldValues.id) : desc(busabaseFieldValues.id);

/** Write-time order that holds for legacy ids too. */
const timeOrder = (oldestFirst: boolean) =>
  oldestFirst
    ? [asc(busabaseFieldValues.updatedAt), asc(busabaseFieldValues.id)]
    : [desc(busabaseFieldValues.updatedAt), desc(busabaseFieldValues.id)];

const isStatementTimeout = (error: unknown): boolean => {
  let current = error;
  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth++) {
    if ("code" in current && current.code === "57014") return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
};

/** Carries a result out of a savepoint, which then rolls back with its settings. */
class SavepointResult<T> extends Error {
  constructor(readonly value: T) {
    super("savepoint result");
  }
}

/** Each statement after this may run for at most `ms`. */
const limitStatements = (db: DbInstance, ms: number) =>
  db.execute(
    // statement_timeout takes milliseconds up to INT_MAX.
    sql`select set_config('statement_timeout', ${String(Math.min(2_147_483_647, Math.max(MIN_STATEMENT_MS, Math.floor(ms))))}, true)`,
  );

/**
 * Run `work` in a savepoint whose statements may each run for at most
 * `timeoutMs` (`work` may tighten it further). `null` when one ran out of
 * time: the savepoint rolls back and the search's transaction carries on, so
 * a slow statement costs its time, not the whole search. The savepoint always
 * rolls back, so no setting made inside it outlives it. Outside a transaction
 * it is one of its own, on one pooled connection. Also bounds records grep's
 * prefiltered batches (`logic/grep.ts`).
 */
export const withinTime = async <T>(
  db: DbInstance,
  timeoutMs: number,
  work: (savepoint: DbInstance) => Promise<T>,
): Promise<T | null> => {
  try {
    await db.transaction(async (savepoint) => {
      const inner = savepoint as unknown as DbInstance;
      await limitStatements(inner, timeoutMs);
      throw new SavepointResult(await work(inner));
    });
  } catch (error) {
    if (error instanceof SavepointResult) return error.value as T;
    if (isStatementTimeout(error)) return null;
    throw error;
  }
  return null;
};

/**
 * The newest `rows + 1` matches the indexes can find — current and legacy ids
 * alike — in bitmap scans only (an ordered walk would read the space instead
 * of the index). `null` means it could not finish in `timeoutMs` (common
 * trigrams around a rare phrase) and scanning has to answer instead.
 */
const indexWindow = async (
  db: DbInstance,
  input: WindowInput & { range: IdRange },
  timeoutMs: number,
): Promise<{ matches: MatchRow[]; truncated: boolean } | null> => {
  // An expression, so the id regions stay filters: ANDing the primary key's
  // bitmap for the whole space costs more than the match bitmap itself.
  const id = sql`(${busabaseFieldValues.id} || '')`;
  const rows = await withinTime(db, timeoutMs, async (savepoint) => {
    await savepoint.execute(sql`select set_config('enable_indexscan', 'off', true)`);
    return savepoint
      .select(matchColumns)
      .from(busabaseFieldValues)
      .where(
        and(
          input.eligibility,
          sql`(${currentRegion(id, input.range)} or ${legacyRegion(id, input.range)})`,
          indexedMatch(input.query),
        ),
      )
      .orderBy(...timeOrder(input.oldestFirst))
      .limit(input.rows + 1);
  });
  if (!rows) return null;
  return { matches: rows.map(timedByUpdate), truncated: rows.length > input.rows };
};

/**
 * Matches among the space's legacy and unrecognized ids, by write time,
 * complete up to `rows + 1`. Primary-key ranges: the `qfv_` span of the
 * space's lifetime, and the regions no generator writes, which are empty in a
 * database without imports from elsewhere. `null` when it ran out of time.
 */
const legacyMatches = async (
  db: DbInstance,
  input: WindowInput & { range: IdRange },
  timeoutMs: number,
): Promise<{ matches: MatchRow[]; truncated: boolean } | null> => {
  const rows = await withinTime(db, timeoutMs, (savepoint) =>
    savepoint
      .select(matchColumns)
      .from(busabaseFieldValues)
      .where(
        and(
          input.eligibility,
          legacyRegion(busabaseFieldValues.id, input.range),
          scannedMatch(input.query),
        ),
      )
      .orderBy(...timeOrder(input.oldestFirst))
      .limit(input.rows + 1),
  );
  if (!rows) return null;
  return { matches: rows.map(timedByUpdate), truncated: rows.length > input.rows };
};

interface ScanState extends MatchSet {
  /** Exclusive edge of what has been scanned; the next step starts past it. */
  cursor: string;
  /** The whole space has been scanned. */
  finished: boolean;
  /** Ids the next step reads. */
  stepRows: number;
  /** Ids read and time spent so far, to judge how fast matches turn up. */
  scannedRows: number;
  scannedMs: number;
}

/**
 * Scan the space newest first (oldest first for ascending sorts) in steps,
 * until `rows + 1` matches, the end of the space, or `until`. Every statement
 * of a step is capped at the time left, so a step that would overrun stops
 * the scan with what was found instead of failing the search. Step sizes
 * follow the measured speed toward a fraction of the time left. With
 * `giveUpWhenSparse`, it also stops as soon as the matches found so far, at
 * the speed measured so far, would not fill the window before `scanUntil`.
 */
const scanSpace = async (
  db: DbInstance,
  input: WindowInput & {
    range: IdRange;
    from: ScanState;
    until: number;
    giveUpWhenSparse?: boolean;
    progress?: MatchProgress;
  },
): Promise<ScanState> => {
  const { oldestFirst, range, until } = input;
  const rows = [...input.from.rows];
  // Every step adds to this same array: the caller sees them as they come.
  if (input.progress) input.progress.rows = rows;
  let { cursor, stepRows, scannedRows, scannedMs } = input.from;
  const targetMs = Math.min(250, Math.max(20, (until - Date.now()) / 6));
  for (let first = true; first || Date.now() < until; first = false) {
    const startedAt = Date.now();
    const ahead = oldestFirst
      ? and(gt(busabaseFieldValues.id, cursor), lt(busabaseFieldValues.id, range.high))
      : and(lt(busabaseFieldValues.id, cursor), gt(busabaseFieldValues.id, range.low));
    const step = await withinTime(db, until - startedAt, async (savepoint) => {
      const [edge] = await savepoint
        .select({ id: busabaseFieldValues.id })
        .from(busabaseFieldValues)
        .where(ahead)
        .orderBy(order(oldestFirst))
        .offset(stepRows)
        .limit(1);
      const span = edge
        ? oldestFirst
          ? and(gt(busabaseFieldValues.id, cursor), lte(busabaseFieldValues.id, edge.id))
          : and(lt(busabaseFieldValues.id, cursor), gte(busabaseFieldValues.id, edge.id))
        : ahead;
      await limitStatements(savepoint, until - Date.now());
      const found = await savepoint
        .select(matchColumns)
        .from(busabaseFieldValues)
        .where(and(input.eligibility, span, scannedMatch(input.query)))
        .orderBy(order(oldestFirst))
        .limit(input.rows + 1 - rows.length);
      return { edge, found };
    });
    if (!step) {
      // The step overran and its work is gone; the next one starts smaller.
      const smaller = Math.max(MIN_STEP_ROWS, Math.floor(stepRows / 4));
      const state = { cursor, stepRows: smaller, scannedRows, scannedMs };
      return { rows, truncated: true, finished: false, ...state };
    }
    const tookMs = Math.max(1, Date.now() - startedAt);
    scannedRows += stepRows;
    scannedMs += tookMs;
    rows.push(...step.found.map((row) => ({ ...row, at: currentIdTime(row.id) })));
    if (rows.length > input.rows) {
      return { rows, truncated: true, finished: false, cursor, stepRows, scannedRows, scannedMs };
    }
    if (!step.edge) {
      return { rows, truncated: false, finished: true, cursor, stepRows, scannedRows, scannedMs };
    }
    cursor = step.edge.id;
    if (input.giveUpWhenSparse) {
      const fillMs =
        rows.length === 0
          ? Number.POSITIVE_INFINITY
          : ((input.rows + 1 - rows.length) * scannedMs) / rows.length;
      if (fillMs > input.scanUntil - Date.now()) {
        return { rows, truncated: true, finished: false, cursor, stepRows, scannedRows, scannedMs };
      }
    }
    stepRows = Math.min(
      MAX_STEP_ROWS,
      stepRows * 4,
      Math.max(MIN_STEP_ROWS, Math.round((stepRows * targetMs) / tookMs)),
    );
  }
  return { rows, truncated: true, finished: false, cursor, stepRows, scannedRows, scannedMs };
};

/** A current id's write time is in its name (`fvl` + base36 epoch ms). */
const currentIdTime = (id: string) => Number.parseInt(id.slice(3, 11), 36);

/**
 * Matches among the space's ids. The newest part of the space is scanned
 * first, for at most a third of the time and only while matches turn up fast
 * enough to fill the window; a common word fills it there. Otherwise the
 * indexes are asked, under a cap, for the newest matches
 * anywhere in the space, legacy ids included — a rare word is answered
 * completely. An input the indexes cannot answer (no trigrams) or cannot
 * answer in time goes on scanning until the window is full or the time runs
 * out.
 */
const spaceMatches = async (
  db: DbInstance,
  input: WindowInput & { range: IdRange; progress?: MatchProgress },
): Promise<{ matches: MatchRow[]; truncated: boolean; legacyIncluded: boolean }> => {
  const startedAt = Date.now();
  const budgetMs = Math.max(0, input.scanUntil - startedAt);
  const start: ScanState = {
    rows: [],
    truncated: false,
    cursor: input.oldestFirst ? input.range.low : input.range.high,
    finished: false,
    stepRows: input.chunkRows ?? FIRST_STEP_ROWS,
    scannedRows: 0,
    scannedMs: 0,
  };
  const first = await scanSpace(db, {
    ...input,
    from: start,
    until: startedAt + budgetMs / 3,
    giveUpWhenSparse: true,
  });
  if (first.rows.length > input.rows || first.finished) {
    return { matches: first.rows, truncated: first.truncated, legacyIncluded: false };
  }
  const indexTimeoutMs = Math.min(input.indexTimeoutMs, input.scanUntil - Date.now());
  const indexed =
    needsScopedRecordScan(input.query) || indexTimeoutMs < MIN_STATEMENT_MS
      ? null
      : await indexWindow(db, input, indexTimeoutMs);
  if (indexed) {
    const seen = new Set(indexed.matches.map((match) => match.id));
    const extra = first.rows.filter((match) => !seen.has(match.id));
    if (input.progress) input.progress.rows = [...indexed.matches, ...extra];
    return {
      matches: [...indexed.matches, ...extra],
      truncated: indexed.truncated,
      legacyIncluded: true,
    };
  }
  const rest =
    Date.now() < input.scanUntil
      ? await scanSpace(db, { ...input, from: first, until: input.scanUntil })
      : first;
  return { matches: rest.rows, truncated: rest.truncated, legacyIncluded: false };
};

/**
 * The matching field values one search ranks: at most `rows`, newest first
 * (oldest first for ascending sorts), and whether more matched. Below the
 * window the result is exactly every match, legacy ids included. Every
 * statement is capped at the time left before `scanUntil` (with a small
 * floor), so running out of time answers with what was found, marked
 * truncated, and never fails the search.
 */
export const findRecordMatches = async (
  db: DbInstance,
  input: WindowInput & { spaceId: string },
  progress?: MatchProgress,
): Promise<MatchSet> => {
  // These statements are many and short; compiling one costs more (~300 ms)
  // than running it. Local to this search's transaction.
  await db.execute(sql`select set_config('jit', 'off', true)`);
  const rangeTimeoutMs =
    input.rangeTimeoutMs ??
    Math.min(RANGE_LOOKUP_MAX_MS, (input.scanUntil - Date.now()) * RANGE_LOOKUP_SHARE);
  // One index probe per Base each way: on a cold cache, with hundreds of
  // Bases, that alone could outlast a quick search's statement timeout.
  const lookup =
    rangeTimeoutMs >= MIN_STATEMENT_MS
      ? await withinTime(db, rangeTimeoutMs, async (savepoint) => ({
          range: await spaceIdRange(savepoint, input.spaceId),
        }))
      : null;
  if (lookup && !lookup.range) return { rows: [], truncated: false };
  const range = lookup?.range ?? wholeIdRange();
  const bounded = { ...input, range, progress };
  const found = await spaceMatches(db, bounded);
  // Legacy ids are older than every current one. Newest first, they matter
  // only when the current matches did not fill the window and were all found.
  const needsLegacy =
    !found.legacyIncluded &&
    (input.oldestFirst || (!found.truncated && found.matches.length <= input.rows));
  const legacy = needsLegacy
    ? ((await legacyMatches(db, bounded, input.scanUntil - Date.now())) ?? {
        matches: [] as MatchRow[],
        truncated: true,
      })
    : { matches: [] as MatchRow[], truncated: false };
  const merged = [...found.matches, ...legacy.matches].sort((left, right) =>
    input.oldestFirst
      ? left.at - right.at || (left.id < right.id ? -1 : 1)
      : right.at - left.at || (left.id < right.id ? 1 : -1),
  );
  return {
    rows: merged.slice(0, input.rows),
    truncated: merged.length > input.rows || found.truncated || legacy.truncated,
  };
};

export type RankSort =
  | "relevance"
  | "updated_desc"
  | "updated_asc"
  | "created_desc"
  | "created_asc";

/** What a search result is built from: one record, or one change request's proposal. */
export interface MatchGroup {
  recordId: string | null;
  changeRequestId: string | null;
}

/**
 * Group the window's values by record or change request and order the groups
 * for the page, in memory: the match rows already carry what each sort needs.
 * `max` for the newest-first orders and `min` for oldest-first, so a record
 * with many edited values sorts by the edge the caller actually asked about
 * rather than an arbitrary one. Relevance has no meaning here and orders by
 * update time, newest first, which is also what it falls back to.
 */
export const orderMatchGroups = (
  rows: readonly MatchRow[],
  sort: RankSort,
  limit: number,
): MatchGroup[] => {
  const key = (row: MatchRow) => `${row.recordId ?? ""}\u0000${row.changeRequestId ?? ""}`;
  const byCreated = sort === "created_desc" || sort === "created_asc";
  const newestFirst = sort === "relevance" || sort === "updated_desc" || sort === "created_desc";
  const groups = new Map<string, MatchGroup & { time: number; id: string }>();
  for (const row of rows) {
    const time = (byCreated ? row.createdAt : row.updatedAt).getTime();
    const group = groups.get(key(row));
    if (!group) {
      groups.set(key(row), {
        recordId: row.recordId,
        changeRequestId: row.changeRequestId,
        time,
        id: row.id,
      });
    } else if (newestFirst ? time > group.time : time < group.time) {
      group.time = time;
    }
  }
  return [...groups.values()]
    .sort((left, right) =>
      newestFirst
        ? right.time - left.time || (left.id < right.id ? 1 : -1)
        : left.time - right.time || (left.id < right.id ? -1 : 1),
    )
    .slice(0, limit)
    .map(({ recordId, changeRequestId }) => ({ recordId, changeRequestId }));
};

/**
 * Order the window's groups by relevance: `ts_rank` over every window value
 * (`to_tsvector`, up to 8,000 characters each) is the one ranking step that
 * costs real time. `null` when it could not finish in `timeoutMs`; the caller
 * answers with `orderMatchGroups` instead, so a slow ranking never fails the
 * search.
 */
export const rankRelevance = async (
  db: DbInstance,
  input: { ids: string[]; query: string; limit: number; timeoutMs: number },
): Promise<MatchGroup[] | null> => {
  if (input.ids.length === 0) return [];
  return withinTime(db, input.timeoutMs, (savepoint) =>
    savepoint
      .select({
        changeRequestId: busabaseFieldValues.changeRequestId,
        recordId: busabaseFieldValues.recordId,
      })
      .from(busabaseFieldValues)
      .where(inArray(busabaseFieldValues.id, input.ids))
      .groupBy(busabaseFieldValues.recordId, busabaseFieldValues.changeRequestId)
      .orderBy(
        desc(
          sql`max(ts_rank(to_tsvector('simple', coalesce(${busabaseFieldValues.valueText}, '')), plainto_tsquery('simple', ${input.query})))`,
        ),
        desc(sql`max(${busabaseFieldValues.updatedAt})`),
      )
      .limit(input.limit),
  );
};
