/**
 * How one record search spends its request time.
 *
 * A search has one deadline. Finding matches takes the largest part of it; what
 * comes after (ordering the matches, reading and hydrating the rows to show)
 * needs a share of its own that matching cannot use up, and must stop before
 * the deadline with whatever it has instead of running into it: a deadline hit
 * once matches exist would throw their work away as a timeout.
 */

/** The time kept for everything after matching, when the request has that much left. */
export const POST_MATCH_RESERVE_MS = 800;

/** Matching always gets at least this much, however little is left. */
export const MIN_MATCH_MS = 150;

/** Matching never takes more than this share of what is left. */
export const MAX_MATCH_SHARE = 0.5;

/**
 * Time for finding matches: up to half of what is left, but never so much that
 * less than `POST_MATCH_RESERVE_MS` remains for what follows. A request that is
 * already short on time still gets `MIN_MATCH_MS`.
 */
export const planMatchBudgetMs = (remainingMs: number): number =>
  Math.max(
    MIN_MATCH_MS,
    Math.min(remainingMs * MAX_MATCH_SHARE, remainingMs - POST_MATCH_RESERVE_MS),
  );

/**
 * A match scope that finishes after its deadline keeps its matches if it is no
 * more than this late: a statement can be slow to honour its cancellation (a
 * cold or throttled disk), and finding the matches is the work most worth
 * keeping.
 */
export const MATCH_OVERRUN_MS = 300;

/**
 * Once matches are in hand, reading and hydrating the first rows always gets
 * this long, even if that runs past the request deadline: a search that found
 * its matches answers, a few hundred milliseconds late at worst, instead of
 * throwing them away.
 */
export const MIN_ANSWER_MS = 300;

/** The floor for hydrating alone, within `MIN_ANSWER_MS`. */
export const MIN_HYDRATE_MS = 150;

/** Ordering by relevance is skipped when less than this is left for it. */
export const MIN_RANK_MS = 50;

/** Rows hydrated at a time, in rank order: the first chunk is the first page of a palette. */
export const HYDRATE_CHUNK_ROWS = 8;

/** Slack kept before the deadline for merging and returning the answer. */
export const answerMarginMs = (requestMs: number): number => Math.max(50, requestMs * 0.04);

/**
 * Wait for `work` until `until` (epoch ms): its value, or `null` when time ran
 * out first. The work itself is not cancelled; its outcome is discarded, errors
 * included, so nothing is left unhandled.
 */
export const settleBefore = <T>(work: Promise<T>, until: number): Promise<{ value: T } | null> => {
  const left = until - Date.now();
  if (left <= 0) {
    work.catch(() => undefined);
    return Promise.resolve(null);
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      work.catch(() => undefined);
      resolve(null);
    }, left);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve({ value });
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
};

/**
 * Run `run` over `items` in order, `chunkSize` at a time, and stop at `until`:
 * the results of every item finished by then, as the longest prefix of `items`
 * so a result never appears without the better-ranked ones before it, and
 * whether all of them finished. An item's own failure fails the whole run, as
 * it would without a deadline.
 */
export const runWithin = async <T, R>(
  items: readonly T[],
  run: (item: T) => Promise<R>,
  options: { until: number; chunkSize: number },
): Promise<{ results: R[]; complete: boolean }> => {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += options.chunkSize) {
    if (Date.now() >= options.until) return { results, complete: false };
    const chunk = items.slice(start, start + options.chunkSize);
    const finished: Array<{ value: R } | undefined> = [];
    const settled = await settleBefore(
      Promise.all(
        chunk.map(async (item, index) => {
          finished[index] = { value: await run(item) };
        }),
      ),
      options.until,
    );
    for (const entry of finished) {
      if (!entry) break;
      results.push(entry.value);
    }
    if (!settled) return { results, complete: false };
  }
  return { results, complete: true };
};
