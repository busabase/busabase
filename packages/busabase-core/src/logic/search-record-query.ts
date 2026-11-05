import "server-only";

import {
  and,
  asc,
  desc,
  eq,
  gt,
  gte,
  ilike,
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

export const recordSearchWindowRows = (candidateWindow: number): number =>
  Math.max(RECORD_SEARCH_WINDOW_ROWS, candidateWindow * 4);

/** Field values one scan step reads before checking the time budget again. */
const SCAN_CHUNK_ROWS = 50_000;

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

interface TimedMatch {
  id: string;
  /** Write time, so current and legacy ids merge into one order. */
  at: number;
}

interface MatchSet {
  ids: string[];
  /** Matches may exist that `ids` does not hold. */
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
  /** Ids per scan step; defaults to `SCAN_CHUNK_ROWS`. */
  chunkRows?: number;
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

/** Carries a capped query's rows out of its savepoint, which then rolls back with its settings. */
class CappedRows extends Error {
  constructor(readonly matches: TimedMatch[]) {
    super("capped rows");
  }
}

/**
 * The newest `rows + 1` matches the indexes can find — current and legacy ids
 * alike — in bitmap scans only (an ordered walk would read the space instead
 * of the index) and under its own short statement timeout. `null` means it
 * could not finish in time (common trigrams around a rare phrase) and
 * scanning has to answer instead. Runs in a savepoint that always rolls back,
 * so its settings never outlive it.
 */
const indexWindow = async (
  db: DbInstance,
  input: WindowInput & { range: IdRange },
): Promise<{ matches: TimedMatch[]; truncated: boolean } | null> => {
  // An expression, so the id regions stay filters: ANDing the primary key's
  // bitmap for the whole space costs more than the match bitmap itself.
  const id = sql`(${busabaseFieldValues.id} || '')`;
  try {
    await db.transaction(async (savepoint) => {
      const timeoutMs = String(Math.max(1, Math.floor(input.indexTimeoutMs)));
      await savepoint.execute(
        sql`select set_config('statement_timeout', ${timeoutMs}, true),
          set_config('enable_indexscan', 'off', true)`,
      );
      const rows = await savepoint
        .select({ id: busabaseFieldValues.id, updatedAt: busabaseFieldValues.updatedAt })
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
      throw new CappedRows(rows.map((row) => ({ id: row.id, at: row.updatedAt.getTime() })));
    });
  } catch (error) {
    if (error instanceof CappedRows) {
      return { matches: error.matches, truncated: error.matches.length > input.rows };
    }
    if (isStatementTimeout(error)) return null;
    throw error;
  }
  return null;
};

/**
 * Matches among the space's legacy and unrecognized ids, by write time,
 * complete up to `rows + 1`. Primary-key ranges: the `qfv_` span of the
 * space's lifetime, and the regions no generator writes, which are empty in a
 * database without imports from elsewhere.
 */
const legacyMatches = async (
  db: DbInstance,
  input: WindowInput & { range: IdRange },
): Promise<{ matches: TimedMatch[]; truncated: boolean }> => {
  const rows = await db
    .select({ id: busabaseFieldValues.id, updatedAt: busabaseFieldValues.updatedAt })
    .from(busabaseFieldValues)
    .where(
      and(
        input.eligibility,
        legacyRegion(busabaseFieldValues.id, input.range),
        scannedMatch(input.query),
      ),
    )
    .orderBy(...timeOrder(input.oldestFirst))
    .limit(input.rows + 1);
  return {
    matches: rows.map((row) => ({ id: row.id, at: row.updatedAt.getTime() })),
    truncated: rows.length > input.rows,
  };
};

interface ScanState extends MatchSet {
  /** Exclusive edge of what has been scanned; the next step starts past it. */
  cursor: string;
  /** The whole space has been scanned. */
  finished: boolean;
}

/**
 * Scan the space newest first (oldest first for ascending sorts), one step of
 * `chunkRows` ids at a time, until `rows + 1` matches, the end of the
 * space, `maxSteps`, or `scanUntil`. Each step is a bounded statement, so a
 * search that runs out of time still answers with the newest matches it found
 * instead of failing as a whole.
 */
const scanSpace = async (
  db: DbInstance,
  input: WindowInput & { range: IdRange; from: ScanState; maxSteps: number },
): Promise<ScanState> => {
  const { oldestFirst, range } = input;
  const ids = [...input.from.ids];
  let cursor = input.from.cursor;
  for (let step = 0; step < input.maxSteps; step++) {
    const ahead = oldestFirst
      ? and(gt(busabaseFieldValues.id, cursor), lt(busabaseFieldValues.id, range.high))
      : and(lt(busabaseFieldValues.id, cursor), gt(busabaseFieldValues.id, range.low));
    const [edge] = await db
      .select({ id: busabaseFieldValues.id })
      .from(busabaseFieldValues)
      .where(ahead)
      .orderBy(order(oldestFirst))
      .offset(input.chunkRows ?? SCAN_CHUNK_ROWS)
      .limit(1);
    const span = edge
      ? oldestFirst
        ? and(gt(busabaseFieldValues.id, cursor), lte(busabaseFieldValues.id, edge.id))
        : and(lt(busabaseFieldValues.id, cursor), gte(busabaseFieldValues.id, edge.id))
      : ahead;
    const found = await db
      .select({ id: busabaseFieldValues.id })
      .from(busabaseFieldValues)
      .where(and(input.eligibility, span, scannedMatch(input.query)))
      .orderBy(order(oldestFirst))
      .limit(input.rows + 1 - ids.length);
    ids.push(...found.map((row) => row.id));
    if (ids.length > input.rows) return { ids, truncated: true, cursor, finished: false };
    if (!edge) return { ids, truncated: false, cursor, finished: true };
    cursor = edge.id;
    if (Date.now() >= input.scanUntil) break;
  }
  return { ids, truncated: true, cursor, finished: false };
};

/** A current id's write time is in its name (`fvl` + base36 epoch ms). */
const currentIdTime = (id: string) => Number.parseInt(id.slice(3, 11), 36);

/**
 * Matches among the space's ids: the newest step of the space is scanned
 * first, and a common word fills the window there. Otherwise the indexes are
 * asked, under a time cap, for the newest matches anywhere in the space,
 * legacy ids included — a rare word is answered completely. An input the
 * indexes cannot answer (no trigrams) or cannot answer in time keeps
 * scanning, step by step, until the window is full or the time runs out.
 */
const spaceMatches = async (
  db: DbInstance,
  input: WindowInput & { range: IdRange },
): Promise<{ matches: TimedMatch[]; truncated: boolean; legacyIncluded: boolean }> => {
  const timed = (ids: string[]) => ids.map((id) => ({ id, at: currentIdTime(id) }));
  const start: ScanState = {
    ids: [],
    truncated: false,
    cursor: input.oldestFirst ? input.range.low : input.range.high,
    finished: false,
  };
  const first = await scanSpace(db, { ...input, from: start, maxSteps: 1 });
  if (first.ids.length > input.rows || first.finished) {
    return { matches: timed(first.ids), truncated: first.truncated, legacyIncluded: false };
  }
  const indexed = needsScopedRecordScan(input.query) ? null : await indexWindow(db, input);
  if (indexed) {
    const seen = new Set(indexed.matches.map((match) => match.id));
    const extra = timed(first.ids).filter((match) => !seen.has(match.id));
    return {
      matches: [...indexed.matches, ...extra],
      truncated: indexed.truncated,
      legacyIncluded: true,
    };
  }
  const rest = await scanSpace(db, { ...input, from: first, maxSteps: Number.POSITIVE_INFINITY });
  return { matches: timed(rest.ids), truncated: rest.truncated, legacyIncluded: false };
};

/**
 * The matching field values one search ranks: at most `rows`, newest first
 * (oldest first for ascending sorts), and whether more matched. Below the
 * window the result is exactly every match, legacy ids included.
 */
export const findRecordMatches = async (
  db: DbInstance,
  input: WindowInput & { spaceId: string },
): Promise<MatchSet> => {
  // These statements are many and short; compiling one costs more (~300 ms)
  // than running it. Local to this search's transaction.
  await db.execute(sql`select set_config('jit', 'off', true)`);
  const range = await spaceIdRange(db, input.spaceId);
  if (!range) return { ids: [], truncated: false };
  const bounded = { ...input, range };
  const found = await spaceMatches(db, bounded);
  // Legacy ids are older than every current one. Newest first, they matter
  // only when the current matches did not fill the window and were all found.
  const needsLegacy =
    !found.legacyIncluded &&
    (input.oldestFirst || (!found.truncated && found.matches.length <= input.rows));
  const legacy = needsLegacy
    ? await legacyMatches(db, bounded)
    : { matches: [] as TimedMatch[], truncated: false };
  const merged = [...found.matches, ...legacy.matches].sort((left, right) =>
    input.oldestFirst
      ? left.at - right.at || (left.id < right.id ? -1 : 1)
      : right.at - left.at || (left.id < right.id ? 1 : -1),
  );
  return {
    ids: merged.slice(0, input.rows).map((match) => match.id),
    truncated: merged.length > input.rows || found.truncated || legacy.truncated,
  };
};
