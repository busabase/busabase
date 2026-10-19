import { beforeEach, describe, expect, it } from "vitest";
import {
  clearChangeRequestScopeCache,
  getCachedChangeRequestScope,
  getChangeRequestScopeCacheStats,
  MAX_ENTRIES,
  MAX_NODE_IDS_PER_ENTRY,
  MAX_TOTAL_NODE_IDS,
  setCachedChangeRequestScope,
} from "../src/logic/change-request-scope-cache";

const scopeOf = (count: number, prefix = "nod") => ({
  nodeIds: Array.from({ length: count }, (_, i) => `${prefix}_${i}`),
  unresolved: false,
});

describe("change request scope cache memory bounds", () => {
  beforeEach(() => clearChangeRequestScopeCache());

  it("caches an entry exactly at the per-entry node limit", () => {
    setCachedChangeRequestScope("k", scopeOf(MAX_NODE_IDS_PER_ENTRY));
    expect(getCachedChangeRequestScope("k")?.nodeIds).toHaveLength(MAX_NODE_IDS_PER_ENTRY);
    expect(getChangeRequestScopeCacheStats()).toEqual({
      entries: 1,
      nodeIds: MAX_NODE_IDS_PER_ENTRY,
    });
  });

  it("never caches an entry above the per-entry node limit", () => {
    setCachedChangeRequestScope("big", scopeOf(MAX_NODE_IDS_PER_ENTRY + 1));
    expect(getCachedChangeRequestScope("big")).toBeUndefined();
    expect(getChangeRequestScopeCacheStats()).toEqual({ entries: 0, nodeIds: 0 });
  });

  it("drops a stale entry when the same key is re-set with an oversized scope", () => {
    setCachedChangeRequestScope("k", scopeOf(3));
    setCachedChangeRequestScope("k", scopeOf(MAX_NODE_IDS_PER_ENTRY + 1));
    expect(getCachedChangeRequestScope("k")).toBeUndefined();
    expect(getChangeRequestScopeCacheStats()).toEqual({ entries: 0, nodeIds: 0 });
  });

  it("does not double-count a key that is overwritten", () => {
    setCachedChangeRequestScope("k", scopeOf(10));
    setCachedChangeRequestScope("k", scopeOf(4));
    expect(getChangeRequestScopeCacheStats()).toEqual({ entries: 1, nodeIds: 4 });
  });

  it("evicts least-recently-used entries once total node ids exceed the cap", () => {
    const perEntry = MAX_NODE_IDS_PER_ENTRY;
    const fit = Math.floor(MAX_TOTAL_NODE_IDS / perEntry);
    for (let i = 0; i < fit; i++) setCachedChangeRequestScope(`k${i}`, scopeOf(perEntry));
    expect(getChangeRequestScopeCacheStats().nodeIds).toBe(fit * perEntry);

    // Touch k0 so it becomes most recently used; k1 is now the oldest.
    expect(getCachedChangeRequestScope("k0")).toBeDefined();
    setCachedChangeRequestScope("overflow", scopeOf(perEntry));

    const stats = getChangeRequestScopeCacheStats();
    expect(stats.nodeIds).toBeLessThanOrEqual(MAX_TOTAL_NODE_IDS);
    expect(getCachedChangeRequestScope("k0")).toBeDefined();
    expect(getCachedChangeRequestScope("k1")).toBeUndefined();
    expect(getCachedChangeRequestScope("overflow")).toBeDefined();
  });

  it("still caps the entry count for zero-node (unresolved) scopes", () => {
    for (let i = 0; i < MAX_ENTRIES + 10; i++) {
      setCachedChangeRequestScope(`u${i}`, { nodeIds: [], unresolved: true });
    }
    expect(getChangeRequestScopeCacheStats()).toEqual({ entries: MAX_ENTRIES, nodeIds: 0 });
    expect(getCachedChangeRequestScope("u0")).toBeUndefined();
    expect(getCachedChangeRequestScope(`u${MAX_ENTRIES + 9}`)).toBeDefined();
  });

  it("clear resets the node-id total", () => {
    setCachedChangeRequestScope("k", scopeOf(5));
    clearChangeRequestScopeCache();
    expect(getChangeRequestScopeCacheStats()).toEqual({ entries: 0, nodeIds: 0 });
  });
});
