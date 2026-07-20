import { NODE_TYPES, type NodeType } from "busabase-contract/domains";
import type { NodeSearchResultVO, NodeVO } from "busabase-contract/types";

export interface KnownNode {
  id: string;
  type: NodeType;
  name: string;
  slug: string;
  path: string;
  lastVisitedAt?: string;
}

export interface AsyncKeyValueStorage {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
}

export interface KnownNodeCache {
  merge: (nodes: KnownNode[]) => Promise<void>;
  markVisited: (id: string, at?: string) => Promise<void>;
  list: () => Promise<KnownNode[]>;
  listVisited: () => Promise<KnownNode[]>;
  fuzzyMatch: (query: string, limit?: number) => Promise<KnownNode[]>;
  clear: () => Promise<void>;
  subscribe: (listener: () => void) => () => void;
}

const STORAGE_KEY_PREFIX = "busabase-mobile.known-node-cache.v1";
const MAX_ENTRIES = 1000;

const storageKeyForScope = (scope: string) => `${STORAGE_KEY_PREFIX}:${encodeURIComponent(scope)}`;

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

const evictIfNeeded = (cache: Map<string, KnownNode>) => {
  if (cache.size <= MAX_ENTRIES) return;
  for (const [id, node] of cache) {
    if (cache.size <= MAX_ENTRIES) break;
    if (!node.lastVisitedAt) cache.delete(id);
  }
  for (const [id] of cache) {
    if (cache.size <= MAX_ENTRIES) break;
    cache.delete(id);
  }
};

const isSubsequence = (needle: string, haystack: string) => {
  let needleIndex = 0;
  for (let index = 0; index < haystack.length && needleIndex < needle.length; index++) {
    if (haystack[index] === needle[needleIndex]) needleIndex++;
  }
  return needleIndex === needle.length;
};

export const createKnownNodeCacheScope = (
  serverUrl: string,
  spaceScope: string | null | undefined,
  userId: string | null | undefined,
) =>
  [
    serverUrl.replace(/\/+$/, "").toLowerCase(),
    spaceScope ?? "default",
    userId ?? "anonymous",
  ].join(":");

export const nodeRoutePath = (type: NodeType, slug: string) => `/${type}/${slug}`;

export const nodeToKnownNode = (node: NodeVO): KnownNode => ({
  id: node.id,
  type: node.type,
  name: node.name,
  slug: node.slug,
  path: nodeRoutePath(node.type, node.slug),
});

export const nodeSearchResultToKnownNode = (node: NodeSearchResultVO): KnownNode => ({
  id: node.id,
  type: node.type,
  name: node.name,
  slug: node.slug,
  path: node.path,
});

export const flattenNodesForCache = (nodes: NodeVO[]): KnownNode[] =>
  nodes.flatMap((node) => [nodeToKnownNode(node), ...flattenNodesForCache(node.children)]);

export const findKnownNodeByTypeAndSlug = (
  nodes: KnownNode[],
  type: NodeType,
  slug: string,
): KnownNode | undefined => nodes.find((node) => node.type === type && node.slug === slug);

export const createKnownNodeCache = (
  scope: string,
  storage: AsyncKeyValueStorage,
): KnownNodeCache => {
  const storageKey = storageKeyForScope(scope);
  let cache = new Map<string, KnownNode>();
  let loadPromise: Promise<void> | null = null;
  let mutationQueue = Promise.resolve();
  const listeners = new Set<() => void>();

  const notify = () => {
    for (const listener of listeners) listener();
  };

  const load = () => {
    if (loadPromise) return loadPromise;
    loadPromise = storage
      .getItem(storageKey)
      .then((raw) => {
        if (!raw) return;
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return;
        cache = new Map(parsed.filter(isKnownNode).map((node) => [node.id, node] as const));
      })
      .catch(() => {
        cache = new Map();
      });
    return loadPromise;
  };

  const persist = async () => {
    await storage.setItem(storageKey, JSON.stringify([...cache.values()])).catch(() => undefined);
  };

  const enqueueMutation = (mutation: () => Promise<void>) => {
    const operation = mutationQueue.then(mutation, mutation);
    mutationQueue = operation.catch(() => undefined);
    return operation;
  };

  const merge = (nodes: KnownNode[]) => {
    if (nodes.length === 0) return Promise.resolve();
    return enqueueMutation(async () => {
      await load();
      for (const incoming of nodes) {
        const existing = cache.get(incoming.id);
        const lastVisitedAt = incoming.lastVisitedAt ?? existing?.lastVisitedAt;
        cache.delete(incoming.id);
        cache.set(incoming.id, {
          id: incoming.id,
          type: incoming.type,
          name: incoming.name,
          slug: incoming.slug,
          path: incoming.path,
          ...(lastVisitedAt ? { lastVisitedAt } : {}),
        });
      }
      evictIfNeeded(cache);
      await persist();
      notify();
    });
  };

  const markVisited = (id: string, at = new Date().toISOString()) =>
    enqueueMutation(async () => {
      await load();
      const existing = cache.get(id);
      if (!existing) return;
      cache.delete(id);
      cache.set(id, { ...existing, lastVisitedAt: at });
      await persist();
      notify();
    });

  const list = async () => {
    await load();
    await mutationQueue;
    return [...cache.values()];
  };

  const listVisited = async () =>
    (await list())
      .filter((node): node is KnownNode & { lastVisitedAt: string } => Boolean(node.lastVisitedAt))
      .sort((a, b) => b.lastVisitedAt.localeCompare(a.lastVisitedAt));

  const fuzzyMatch = async (query: string, limit = 20) => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return [];
    const ranked: Array<{ node: KnownNode; rank: 0 | 1 }> = [];
    for (const node of await list()) {
      const name = node.name.toLowerCase();
      const slug = node.slug.toLowerCase();
      if (name.includes(normalizedQuery) || slug.includes(normalizedQuery)) {
        ranked.push({ node, rank: 0 });
      } else if (isSubsequence(normalizedQuery, name) || isSubsequence(normalizedQuery, slug)) {
        ranked.push({ node, rank: 1 });
      }
    }
    return ranked
      .sort((a, b) => {
        if (a.rank !== b.rank) return a.rank - b.rank;
        const visitOrder = (b.node.lastVisitedAt ?? "").localeCompare(a.node.lastVisitedAt ?? "");
        return visitOrder || a.node.name.localeCompare(b.node.name);
      })
      .slice(0, limit)
      .map(({ node }) => node);
  };

  const clear = () =>
    enqueueMutation(async () => {
      await load();
      cache = new Map();
      await storage.removeItem(storageKey).catch(() => undefined);
      notify();
    });

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return { merge, markVisited, list, listVisited, fuzzyMatch, clear, subscribe };
};
