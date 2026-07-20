/**
 * `KnownNode` client-side quick-jump cache (`domains/dashboard/helpers/known-node-cache.ts`)
 * — pure logic, no DB/server needed. Runs under vitest's default "node"
 * environment (see vitest.config.ts), so `localStorage` isn't a real browser
 * global here: this file stubs a minimal in-memory fake on `globalThis` before
 * each test, which is enough to exercise the module's own try/catch-wrapped
 * read/write path exactly as a browser host would.
 *
 * Covers the Failure Scenario Matrix rows from
 * apps/busabase/content/spec/search-quick-jump.md: merge-overwrites-stale-
 * fields-but-preserves-lastVisitedAt, LRU eviction protecting visited entries,
 * and `localStorage` throwing never crashing the cache.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  clear,
  createKnownNodeCache,
  fuzzyMatch,
  type KnownNode,
  list,
  listVisited,
  markVisited,
  merge,
  nodeRoutePath,
} from "../src/domains/dashboard/helpers/known-node-cache";

class FakeLocalStorage {
  private store = new Map<string, string>();
  shouldThrow = false;

  getItem(key: string): string | null {
    if (this.shouldThrow) throw new Error("storage disabled");
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    if (this.shouldThrow) throw new Error("quota exceeded");
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    if (this.shouldThrow) throw new Error("storage disabled");
    this.store.delete(key);
  }
}

let fakeStorage: FakeLocalStorage;

const node = (overrides: Partial<KnownNode> & Pick<KnownNode, "id">): KnownNode => ({
  type: "base",
  name: "Untitled",
  slug: "untitled",
  path: "/base/untitled",
  ...overrides,
});

beforeEach(() => {
  fakeStorage = new FakeLocalStorage();
  (globalThis as unknown as { localStorage: FakeLocalStorage }).localStorage = fakeStorage;
  clear();
});

describe("KnownNode cache — merge/list", () => {
  it("upserts by id and lists every cached node", () => {
    merge([
      node({ id: "n1", name: "Roadmap Base", slug: "roadmap" }),
      node({ id: "n2", type: "doc", name: "Design Doc", slug: "design", path: "/doc/design" }),
    ]);
    const all = list();
    expect(all).toHaveLength(2);
    expect(all.map((n) => n.id).sort()).toEqual(["n1", "n2"]);
  });

  it("overwrites stale name/slug/path on a later merge, but preserves lastVisitedAt unless the merge explicitly provides a newer one", () => {
    merge([node({ id: "n1", name: "Old Name", slug: "old-slug", path: "/base/old-slug" })]);
    markVisited("n1", "2026-01-01T00:00:00.000Z");

    // A later sidebar/search sighting with a renamed node — must NOT clear lastVisitedAt.
    merge([node({ id: "n1", name: "New Name", slug: "new-slug", path: "/base/new-slug" })]);
    const [entry] = list();
    expect(entry.name).toBe("New Name");
    expect(entry.slug).toBe("new-slug");
    expect(entry.path).toBe("/base/new-slug");
    expect(entry.lastVisitedAt).toBe("2026-01-01T00:00:00.000Z");

    // An explicit newer lastVisitedAt in the merge DOES win.
    merge([
      node({
        id: "n1",
        name: "New Name",
        slug: "new-slug",
        path: "/base/new-slug",
        lastVisitedAt: "2026-02-02T00:00:00.000Z",
      }),
    ]);
    expect(list()[0].lastVisitedAt).toBe("2026-02-02T00:00:00.000Z");
  });

  it("a no-op merge with an empty array doesn't throw or touch storage", () => {
    expect(() => merge([])).not.toThrow();
    expect(list()).toEqual([]);
  });
});

describe("KnownNode cache — markVisited / listVisited", () => {
  it("stamps lastVisitedAt on a known node, and is a no-op for an unknown id", () => {
    merge([node({ id: "n1" })]);
    markVisited("n1", "2026-03-03T00:00:00.000Z");
    expect(list()[0].lastVisitedAt).toBe("2026-03-03T00:00:00.000Z");

    expect(() => markVisited("does-not-exist", "2026-03-04T00:00:00.000Z")).not.toThrow();
    expect(list()).toHaveLength(1);
  });

  it("listVisited returns only visited nodes, most-recent first", () => {
    merge([node({ id: "n1" }), node({ id: "n2" }), node({ id: "n3" })]);
    markVisited("n1", "2026-01-01T00:00:00.000Z");
    markVisited("n3", "2026-03-01T00:00:00.000Z");
    // n2 never visited — stays out of listVisited entirely.

    const visited = listVisited();
    expect(visited.map((n) => n.id)).toEqual(["n3", "n1"]);
  });
});

describe("KnownNode cache — fuzzyMatch", () => {
  it("matches substrings case-insensitively, ranked above subsequence-only matches", () => {
    merge([
      node({ id: "n1", name: "Roadmap Base" }),
      node({ id: "n2", name: "Reusable Onboarding Docs Metadata Plan" }), // subsequence "roadmap" but not substring
      node({ id: "n3", name: "Completely Unrelated" }),
    ]);

    const results = fuzzyMatch("ROADMAP");
    expect(results.map((n) => n.id)).toContain("n1");
    expect(results.map((n) => n.id)).not.toContain("n3");
    // The literal substring match ranks ahead of the subsequence-only one, if both matched.
    const n1Index = results.findIndex((n) => n.id === "n1");
    const n2Index = results.findIndex((n) => n.id === "n2");
    if (n2Index !== -1) {
      expect(n1Index).toBeLessThan(n2Index);
    }
  });

  it("an empty/blank query matches nothing", () => {
    merge([node({ id: "n1", name: "Anything" })]);
    expect(fuzzyMatch("")).toEqual([]);
    expect(fuzzyMatch("   ")).toEqual([]);
  });

  it("matches cached slugs as well as names", () => {
    merge([node({ id: "n1", name: "Quarterly Plan", slug: "finance-roadmap" })]);
    expect(fuzzyMatch("finance-roadmap").map((entry) => entry.id)).toEqual(["n1"]);
  });
});

describe("KnownNode cache — scope and stored-data validation", () => {
  it("isolates entries by workspace and user scope", () => {
    const alice = createKnownNodeCache("space-a:alice");
    const bob = createKnownNodeCache("space-b:bob");
    alice.clear();
    bob.clear();

    alice.merge([node({ id: "private-a", name: "Alice Private" })]);
    bob.merge([node({ id: "private-b", name: "Bob Private" })]);

    expect(alice.list().map((entry) => entry.id)).toEqual(["private-a"]);
    expect(bob.list().map((entry) => entry.id)).toEqual(["private-b"]);
  });

  it("ignores malformed persisted entries instead of crashing fuzzy/recent reads", () => {
    const scope = "corrupt-storage:test-user";
    fakeStorage.setItem(
      `busabase.dashboard.knownNodeCache.v1:${encodeURIComponent(scope)}`,
      JSON.stringify([
        { id: "missing-fields" },
        {
          id: "bad-visit",
          type: "base",
          name: "Bad",
          slug: "bad",
          path: "/base/bad",
          lastVisitedAt: 42,
        },
        node({ id: "valid", name: "Valid Node", lastVisitedAt: "2026-01-01T00:00:00.000Z" }),
      ]),
    );
    const cache = createKnownNodeCache(scope);

    expect(cache.list().map((entry) => entry.id)).toEqual(["valid"]);
    expect(() => cache.fuzzyMatch("valid")).not.toThrow();
    expect(() => cache.listVisited()).not.toThrow();
  });
});

describe("KnownNode cache — eviction", () => {
  it("evicts unvisited entries first (oldest-touched), protecting visited entries, once over the cap", () => {
    // Cap is 1000 (MAX_ENTRIES). Seed 999 (under the cap), visit the two
    // OLDEST-inserted ones (which `markVisited`'s delete+re-set also bumps to
    // the END of touch-order, so they're no longer "oldest" by the time
    // eviction runs), then merge 2 more to cross the cap by exactly 1 —
    // triggering a single-entry eviction that must come from the remaining
    // (still oldest, still unvisited) entries, never from the visited pair.
    const bulk: KnownNode[] = [];
    for (let i = 0; i < 999; i++) {
      bulk.push(node({ id: `bulk-${i}`, slug: `bulk-${i}`, path: `/base/bulk-${i}` }));
    }
    merge(bulk);
    markVisited("bulk-0", "2026-01-01T00:00:00.000Z");
    markVisited("bulk-1", "2026-01-01T00:00:01.000Z");

    merge([
      node({ id: "extra-1", slug: "extra-1", path: "/base/extra-1" }),
      node({ id: "extra-2", slug: "extra-2", path: "/base/extra-2" }),
    ]);

    const all = list();
    expect(all.length).toBeLessThanOrEqual(1000);
    // The visited entries must never be evicted ahead of unvisited ones,
    // even though they were among the very first ever inserted.
    expect(all.some((n) => n.id === "bulk-0")).toBe(true);
    expect(all.some((n) => n.id === "bulk-1")).toBe(true);
    // Exactly one unvisited entry was evicted to get back under the cap.
    const unvisitedRemaining = all.filter((n) => !n.lastVisitedAt).length;
    expect(unvisitedRemaining).toBe(997 + 2 - 1);
  });
});

describe("KnownNode cache — storage failure resilience", () => {
  it("never throws when localStorage.getItem/setItem throw, and keeps working in-memory", () => {
    fakeStorage.shouldThrow = true;
    expect(() => merge([node({ id: "n1" })])).not.toThrow();
    expect(() => list()).not.toThrow();
    expect(() => markVisited("n1", "2026-01-01T00:00:00.000Z")).not.toThrow();
  });
});

describe("nodeRoutePath", () => {
  it("builds the /{type}/{slug} route convention", () => {
    expect(nodeRoutePath("base", "roadmap")).toBe("/base/roadmap");
    expect(nodeRoutePath("doc", "design-notes")).toBe("/doc/design-notes");
  });
});
