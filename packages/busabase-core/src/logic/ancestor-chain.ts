/**
 * One definition of "walk a node's parent chain", shared by the real store and
 * the demo store so the two cannot drift.
 *
 * They already did drift once: the real implementation emitted the workspace
 * root while its own doc comment (and the demo twin) said it did not. The rule
 * is subtle enough — root-first, self excluded, root excluded, cycle-safe —
 * that stating it twice was never going to hold.
 *
 * Deliberately dependency-free: both `logic/node-detail.ts` and
 * `logic/demo-store.ts` import it, and `logic/store.ts` re-exports
 * `logic/nodes.ts`, so anything with imports risks a cycle here.
 */

/**
 * Hard bound on how far the walk climbs. Real trees are a handful of levels
 * deep; this exists so corrupt data cannot turn one navigation into an
 * unbounded run of sequential lookups. The cycle guard below already catches
 * a *loop*, but not a pathologically long (or maliciously deep) chain.
 */
export const MAX_ANCESTOR_DEPTH = 64;

/**
 * `nodeId`'s ancestors, ROOT-FIRST, excluding the node itself and excluding
 * the workspace root.
 *
 * `parentOf` returns the given node's parent id, or `null`/`undefined` when
 * there is none — which covers both "this is the workspace root" and "no such
 * node". Both stop the walk WITHOUT contributing an entry: the root is not a
 * sidebar row (the tree lifts its children to the top level and drops it), and
 * an id with no row behind it is not something a caller could act on either.
 *
 * It may be sync or async; the walk awaits it either way, so an in-memory map
 * and a database both fit without a second copy of this function.
 */
export const collectAncestorIds = async (
  nodeId: string,
  parentOf: (id: string) => Promise<string | null | undefined> | string | null | undefined,
): Promise<string[]> => {
  const ancestorIds: string[] = [];
  const visited = new Set<string>([nodeId]);
  let cursorId = await parentOf(nodeId);

  while (cursorId && ancestorIds.length < MAX_ANCESTOR_DEPTH) {
    // Cycle guard against corrupt data — a self- or mutually-parented row must
    // not spin here.
    if (visited.has(cursorId)) break;
    visited.add(cursorId);
    const nextId = await parentOf(cursorId);
    if (nextId === null || nextId === undefined) break;
    ancestorIds.push(cursorId);
    cursorId = nextId;
  }

  // Collected leaf-first while climbing; callers want root-first.
  return ancestorIds.reverse();
};
