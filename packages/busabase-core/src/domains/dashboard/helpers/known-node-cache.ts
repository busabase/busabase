import { NODE_TYPES, type NodeType } from "busabase-contract/domains";

/**
 * Client-side, `localStorage`-persisted cache of every node the dashboard has
 * ever shown the user — sidebar tree loads, `nodes.searchByName` hits, and
 * successfully loaded details. Backs the Search dialog's "Recent" tab: an empty query
 * shows visited nodes, a typed query fuzzy-matches this cache instantly
 * before ever falling through to the network. See
 * `apps/busabase/content/spec/search-quick-jump.md` for the full design.
 *
 * A plain module-level singleton with an observable snapshot facade — consumers
 * call `merge`/`recordVisit`/`list`/`fuzzyMatch`
 * directly, same as a browser-global would work. Every read/write is wrapped
 * in try/catch: `localStorage` can throw (private browsing, storage disabled,
 * quota exceeded) or simply not exist (SSR) — any failure degrades to "empty
 * cache", never a crash.
 */
export interface KnownNode {
  id: string;
  type: NodeType;
  name: string;
  slug: string;
  /** Route path this node navigates to, e.g. `/base/{slug}` — NOT a filesystem tree path. */
  path: string;
  /** ISO 8601 timestamp of the last time the user actually navigated to this node. */
  lastVisitedAt?: string;
}

export interface KnownNodeCacheSnapshot {
  revision: number;
  all: KnownNode[];
  visited: KnownNode[];
}

const STORAGE_KEY_PREFIX = "busabase.dashboard.knownNodeCache.v1";
const DEFAULT_SCOPE = "local:anonymous";

/** Cap on cache size — see the Failure Scenario Matrix's "cache grows unbounded" row. */
const MAX_ENTRIES = 1000;

// Lazily-populated in-memory mirror of `localStorage`, so repeated reads
// within a session don't re-parse JSON on every call. `null` means "not yet
// loaded from storage" (distinct from a loaded-but-empty Map).
const memoryCaches = new Map<string, Map<string, KnownNode>>();
const revisions = new Map<string, number>();
const listeners = new Map<string, Set<() => void>>();
const snapshots = new Map<string, KnownNodeCacheSnapshot>();

const publishForScope = (scope: string): void => {
  revisions.set(scope, (revisions.get(scope) ?? 0) + 1);
  snapshots.delete(scope);
  for (const listener of listeners.get(scope) ?? []) listener();
};

const subscribeForScope = (scope: string, listener: () => void): (() => void) => {
  const scopeListeners = listeners.get(scope) ?? new Set<() => void>();
  scopeListeners.add(listener);
  listeners.set(scope, scopeListeners);
  return () => {
    scopeListeners.delete(listener);
    if (scopeListeners.size === 0) listeners.delete(scope);
  };
};

const storageKeyForScope = (scope: string): string =>
  `${STORAGE_KEY_PREFIX}:${encodeURIComponent(scope)}`;

const isKnownNode = (value: unknown): value is KnownNode => {
  if (!value || typeof value !== "object") return false;
  const node = value as Partial<KnownNode>;
  return (
    typeof node.id === "string" &&
    typeof node.type === "string" &&
    NODE_TYPES.some((type) => type === node.type) &&
    typeof node.name === "string" &&
    typeof node.slug === "string" &&
    typeof node.path === "string" &&
    (node.lastVisitedAt === undefined || typeof node.lastVisitedAt === "string")
  );
};

const isStorageAvailable = (): boolean => {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    // Some hosts throw merely on ACCESSING the `localStorage` global (certain
    // private-browsing modes) rather than on calling its methods.
    return false;
  }
};

const readStorage = (scope: string): Map<string, KnownNode> => {
  const cached = memoryCaches.get(scope);
  if (cached) return cached;
  let cache = new Map<string, KnownNode>();
  memoryCaches.set(scope, cache);
  try {
    if (!isStorageAvailable()) return cache;
    const raw = localStorage.getItem(storageKeyForScope(scope));
    if (!raw) return cache;
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const entry of parsed) {
        if (isKnownNode(entry)) cache.set(entry.id, entry);
      }
    }
  } catch {
    // Corrupt JSON, storage disabled, or any other read failure — treat as an
    // empty cache rather than throwing (see Failure Scenario Matrix).
    cache = new Map();
    memoryCaches.set(scope, cache);
  }
  return cache;
};

const writeStorage = (scope: string, cache: Map<string, KnownNode>): void => {
  try {
    if (!isStorageAvailable()) return;
    localStorage.setItem(storageKeyForScope(scope), JSON.stringify([...cache.values()]));
  } catch {
    // Best-effort persistence only — e.g. quota exceeded in private browsing.
    // The in-memory cache for this session is still updated; nothing crashes.
  }
};

/**
 * Evict entries once over `MAX_ENTRIES`. Unvisited entries (no
 * `lastVisitedAt`) are evicted first, oldest-touched first — `Map` iteration
 * order is our LRU signal, since `merge`/`markVisited` always re-insert a
 * touched key at the end. Visited entries are only evicted (also
 * oldest-touched first) if the cache is STILL over the cap after every
 * unvisited entry has already been dropped, so a long-lived, heavily-used
 * session still can't grow the cache unboundedly.
 */
const evictIfNeeded = (cache: Map<string, KnownNode>): void => {
  if (cache.size <= MAX_ENTRIES) return;
  for (const [id, node] of cache) {
    if (cache.size <= MAX_ENTRIES) break;
    if (!node.lastVisitedAt) cache.delete(id);
  }
  if (cache.size <= MAX_ENTRIES) return;
  for (const [id] of cache) {
    if (cache.size <= MAX_ENTRIES) break;
    cache.delete(id);
  }
};

/**
 * Upsert `nodes` by `id`. Every merge always overwrites the denormalized
 * "what does this node currently look like" fields (`type`/`name`/`slug`/
 * `path`) with the freshest data — a node seen again via a sidebar reload or
 * a fresh `nodes.searchByName` hit self-heals a stale cached name/slug (see
 * the "cached node was renamed" row in the Failure Scenario Matrix).
 * `lastVisitedAt` is preserved unless the incoming record explicitly carries
 * a newer one (only `markVisited`, and a caller that already knows a visit
 * timestamp, ever sets it) — merely re-appearing in a sidebar load or a
 * search result must never count as a "visit".
 */
const mergeForScope = (scope: string, nodes: KnownNode[]): void => {
  if (nodes.length === 0) return;
  const cache = readStorage(scope);
  for (const incoming of nodes) {
    const existing = cache.get(incoming.id);
    const lastVisitedAt = incoming.lastVisitedAt ?? existing?.lastVisitedAt;
    const merged: KnownNode = {
      id: incoming.id,
      type: incoming.type,
      name: incoming.name,
      slug: incoming.slug,
      path: incoming.path,
      ...(lastVisitedAt ? { lastVisitedAt } : {}),
    };
    // Delete-then-set moves this key to the END of the Map's iteration
    // order — the cheapest available "most recently touched" signal, since
    // cache-only (never-visited) entries have no other timestamp to rank by.
    cache.delete(incoming.id);
    cache.set(incoming.id, merged);
  }
  evictIfNeeded(cache);
  writeStorage(scope, cache);
  publishForScope(scope);
};

/** Stamp `id` as visited `at` now — a no-op if `id` isn't a known node yet. */
const markVisitedForScope = (scope: string, id: string, at: string): void => {
  const cache = readStorage(scope);
  const existing = cache.get(id);
  if (!existing) return;
  cache.delete(id);
  cache.set(id, { ...existing, lastVisitedAt: at });
  writeStorage(scope, cache);
  publishForScope(scope);
};

/** Upsert a successfully loaded node and stamp it visited in one cache update. */
const recordVisitForScope = (scope: string, node: KnownNode, at: string): void => {
  mergeForScope(scope, [{ ...node, lastVisitedAt: at }]);
};

/** Every cached node, in no particular order (callers sort/filter as needed). */
const listForScope = (scope: string): KnownNode[] => [...readStorage(scope).values()];

/** Cached nodes that have actually been visited, most-recent first. */
const listVisitedForScope = (scope: string): KnownNode[] =>
  listForScope(scope)
    .filter((node): node is KnownNode & { lastVisitedAt: string } => Boolean(node.lastVisitedAt))
    .sort((a, b) => b.lastVisitedAt.localeCompare(a.lastVisitedAt));

const getSnapshotForScope = (scope: string): KnownNodeCacheSnapshot => {
  const existing = snapshots.get(scope);
  if (existing) return existing;
  const snapshot = {
    revision: revisions.get(scope) ?? 0,
    all: listForScope(scope),
    visited: listVisitedForScope(scope),
  };
  snapshots.set(scope, snapshot);
  return snapshot;
};

const isSubsequence = (needle: string, haystack: string): boolean => {
  let i = 0;
  for (let j = 0; j < haystack.length && i < needle.length; j++) {
    if (haystack[j] === needle[i]) i++;
  }
  return i === needle.length;
};

/**
 * Instant, client-side, case-insensitive match over the WHOLE cache — no
 * fuzzy-matching library, "same spirit" as `AgentSearchModal`'s
 * `normalize(...).includes(search)` (see the spec's Technical Findings).
 * Substring matches rank above subsequence-only matches; within a rank,
 * more-recently-visited nodes sort first, then alphabetically.
 */
export const fuzzyMatchKnownNodes = (
  nodes: KnownNode[],
  query: string,
  limit = 20,
): KnownNode[] => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return [];
  const ranked: Array<{ node: KnownNode; rank: 0 | 1 }> = [];
  for (const node of nodes) {
    const normalizedName = node.name.toLowerCase();
    const normalizedSlug = node.slug.toLowerCase();
    if (normalizedName.includes(normalizedQuery) || normalizedSlug.includes(normalizedQuery)) {
      ranked.push({ node, rank: 0 });
      continue;
    }
    if (
      isSubsequence(normalizedQuery, normalizedName) ||
      isSubsequence(normalizedQuery, normalizedSlug)
    ) {
      ranked.push({ node, rank: 1 });
    }
  }
  ranked.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    const aVisited = a.node.lastVisitedAt ?? "";
    const bVisited = b.node.lastVisitedAt ?? "";
    if (aVisited !== bVisited) return bVisited.localeCompare(aVisited);
    return a.node.name.localeCompare(b.node.name);
  });
  return ranked.slice(0, limit).map((entry) => entry.node);
};

const fuzzyMatchForScope = (scope: string, query: string, limit = 20): KnownNode[] =>
  fuzzyMatchKnownNodes(listForScope(scope), query, limit);

/** Clears the cache (memory + storage). Mainly for tests; also usable by a future "clear recent history" action. */
const clearForScope = (scope: string): void => {
  memoryCaches.set(scope, new Map());
  try {
    if (isStorageAvailable()) localStorage.removeItem(storageKeyForScope(scope));
  } catch {
    // Best-effort — nothing to recover from here.
  }
  publishForScope(scope);
};

export interface KnownNodeCache {
  merge: (nodes: KnownNode[]) => void;
  markVisited: (id: string, at: string) => void;
  recordVisit: (node: KnownNode, at: string) => void;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => KnownNodeCacheSnapshot;
  list: () => KnownNode[];
  listVisited: () => KnownNode[];
  fuzzyMatch: (query: string, limit?: number) => KnownNode[];
  clear: () => void;
}

/**
 * Creates a cache facade isolated to one workspace/user scope. Cloud callers
 * must include both identifiers so local hits never reveal another account's
 * node names or bypass the current workspace's ACL boundary.
 */
export const createKnownNodeCache = (scope: string): KnownNodeCache => ({
  merge: (nodes) => mergeForScope(scope, nodes),
  markVisited: (id, at) => markVisitedForScope(scope, id, at),
  recordVisit: (node, at) => recordVisitForScope(scope, node, at),
  subscribe: (listener) => subscribeForScope(scope, listener),
  getSnapshot: () => getSnapshotForScope(scope),
  list: () => listForScope(scope),
  listVisited: () => listVisitedForScope(scope),
  fuzzyMatch: (query, limit) => fuzzyMatchForScope(scope, query, limit),
  clear: () => clearForScope(scope),
});

const defaultCache = createKnownNodeCache(DEFAULT_SCOPE);

export const merge = defaultCache.merge;
export const markVisited = defaultCache.markVisited;
export const recordVisit = defaultCache.recordVisit;
export const list = defaultCache.list;
export const listVisited = defaultCache.listVisited;
export const fuzzyMatch = defaultCache.fuzzyMatch;
export const clear = defaultCache.clear;

/** The route path a node of `type`/`slug` navigates to — mirrors the server's `toNodeSearchResultVO` (logic/vo.ts). */
export const nodeRoutePath = (type: NodeType, slug: string): string => `/${type}/${slug}`;

export const knownNodeCache = defaultCache;
