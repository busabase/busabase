import "server-only";

/**
 * Actor-independent node scope of one change request: the node ids its
 * operations touch, or `unresolved` when the scope cannot be proven (the CR is
 * then hidden from every non-manager). Who may SEE those nodes is evaluated per
 * request — only the scope is cached, never a visibility verdict.
 */
export interface ChangeRequestScope {
  nodeIds: readonly string[];
  unresolved: boolean;
}

/**
 * A scope is only cached once nothing can change it any more:
 *  - terminal status — merged / rejected / abandoned CRs are never revised or
 *    re-merged, so their operations (incl. a merged node_create's nodeId) are final;
 *  - settled — `updatedAt` is old enough that the multi-statement create paths
 *    (CR row first, operation rows after, not always in one transaction) have
 *    certainly finished. Caching a half-written CR could otherwise pin a partial
 *    scope and leak it.
 * The key carries `updatedAt`, so any later write to the CR row misses the cache
 * on every instance without cross-process invalidation.
 */
const CACHEABLE_STATUSES = new Set(["merged", "rejected", "abandoned"]);
export const CHANGE_REQUEST_SCOPE_SETTLE_MS = 5 * 60_000;

/**
 * Memory bounds. Heap cost grows with the node ids an entry holds (~500 B for a
 * one-node entry, ~6 KB at 50 nodes), so an entry-count cap alone does not bound
 * memory: a space full of large merged installs would pin hundreds of MB, and
 * terminal entries are never invalidated. Three caps together keep the worst
 * case fixed regardless of the data:
 *  - an entry above MAX_NODE_IDS_PER_ENTRY is never cached (rare; it simply
 *    re-reads from the database every time);
 *  - the total node ids held across all entries is capped, LRU-evicted;
 *  - the entry count is capped, so zero-node (unresolved) entries are bounded too.
 */
export const MAX_NODE_IDS_PER_ENTRY = 256;
export const MAX_TOTAL_NODE_IDS = 500_000;
export const MAX_ENTRIES = 100_000;

export interface ScopeCacheCandidate {
  id: string;
  status?: string;
  updatedAt?: Date;
}

const cache = new Map<string, ChangeRequestScope>();
let totalNodeIds = 0;

export const changeRequestScopeCacheKey = (
  spaceId: string,
  row: ScopeCacheCandidate,
  nowMs: number = Date.now(),
): string | null => {
  if (!row.status || !row.updatedAt || !CACHEABLE_STATUSES.has(row.status)) return null;
  const updatedAtMs = row.updatedAt.getTime();
  if (!Number.isFinite(updatedAtMs) || nowMs - updatedAtMs < CHANGE_REQUEST_SCOPE_SETTLE_MS) {
    return null;
  }
  return `${spaceId}\u0000${row.id}\u0000${row.status}\u0000${updatedAtMs}`;
};

export const getCachedChangeRequestScope = (key: string): ChangeRequestScope | undefined => {
  const hit = cache.get(key);
  if (hit) {
    // LRU touch: Map iteration order is insertion order.
    cache.delete(key);
    cache.set(key, hit);
  }
  return hit;
};

const deleteEntry = (key: string): void => {
  const existing = cache.get(key);
  if (!existing) return;
  totalNodeIds -= existing.nodeIds.length;
  cache.delete(key);
};

export const setCachedChangeRequestScope = (key: string, scope: ChangeRequestScope): void => {
  deleteEntry(key);
  if (scope.nodeIds.length > MAX_NODE_IDS_PER_ENTRY) return;
  cache.set(key, scope);
  totalNodeIds += scope.nodeIds.length;
  // Map iteration order is insertion order, so the first key is least recently used.
  while (cache.size > MAX_ENTRIES || totalNodeIds > MAX_TOTAL_NODE_IDS) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    deleteEntry(oldest);
  }
};

/** Test / diagnostics hook. */
export const getChangeRequestScopeCacheStats = (): { entries: number; nodeIds: number } => ({
  entries: cache.size,
  nodeIds: totalNodeIds,
});

/** Test hook. */
export const clearChangeRequestScopeCache = (): void => {
  cache.clear();
  totalNodeIds = 0;
};
