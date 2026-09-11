import { describe, expect, it } from "vitest";
import {
  createKnownNodeCache,
  type KnownNode,
  mergeRecentMatches,
  partitionByVisited,
} from "./known-node-cache";

/**
 * Every test gets its own scope string — the cache is a module-level
 * singleton keyed by scope, so a shared scope would let tests bleed into
 * each other's `localStorage`-backed state.
 */
let scopeCounter = 0;
const freshCache = () => createKnownNodeCache(`test:known-node-cache:${scopeCounter++}`);

const node = (overrides: Partial<KnownNode> = {}): KnownNode => ({
  id: "nod_1",
  type: "skill",
  name: "Weekly Report",
  slug: "weekly-report",
  path: "/skill/weekly-report",
  ...overrides,
});

describe("KnownNode icon", () => {
  it("carries a custom icon through merge and back out via list()", () => {
    const cache = freshCache();
    cache.merge([node({ icon: { type: "emoji", value: "📊" } })]);

    const [cached] = cache.list();
    expect(cached?.icon).toEqual({ type: "emoji", value: "📊" });
  });

  it("has no icon at all for a node that never carried one — not a crash, not a stray default", () => {
    const cache = freshCache();
    cache.merge([node()]);

    const [cached] = cache.list();
    expect(cached?.icon).toBeUndefined();
  });

  // Same "self-heals a stale cached name/slug" contract the module already
  // documents for name/slug/path — a changed icon is the same class of
  // staleness and must self-heal the same way, freshest write wins.
  it("overwrites a previously cached icon with the freshest merge", () => {
    const cache = freshCache();
    cache.merge([node({ icon: { type: "emoji", value: "📊" } })]);
    cache.merge([node({ icon: { type: "emoji", value: "💸" } })]);

    const [cached] = cache.list();
    expect(cached?.icon).toEqual({ type: "emoji", value: "💸" });
  });

  it("clears a previously cached icon when a later merge explicitly carries null", () => {
    const cache = freshCache();
    cache.merge([node({ icon: { type: "emoji", value: "📊" } })]);
    cache.merge([node({ icon: null })]);

    const [cached] = cache.list();
    expect(cached?.icon).toBeNull();
  });

  it("preserves lastVisitedAt across an icon-only update, matching the existing name/slug contract", () => {
    const cache = freshCache();
    cache.recordVisit(node(), "2026-01-01T00:00:00.000Z");
    cache.merge([node({ icon: { type: "emoji", value: "📊" } })]);

    const [cached] = cache.list();
    expect(cached?.lastVisitedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(cached?.icon).toEqual({ type: "emoji", value: "📊" });
  });
});

describe("mergeRecentMatches", () => {
  // Guards the bug this exists for: the cache only knows what this browser has
  // already loaded (the sidebar tree's prefetched depth, expanded folders,
  // visited nodes). The search used to ask the server ONLY when the cache came
  // back empty, so a single shallow hit silently suppressed every deeper node
  // matching the same query — verified in a real browser before the fix:
  // searching "zebra" returned only the root-level "Zebra Shallow Doc" and
  // never the 4-levels-deep "Zebra Deep Doc", with zero network requests.
  const local = node({ id: "nod_shallow", name: "Zebra Shallow Doc", slug: "zebra-shallow" });
  const deep = node({ id: "nod_deep", name: "Zebra Deep Doc", slug: "zebra-deep" });

  it("appends server results the cache had never seen", () => {
    expect(mergeRecentMatches([local], [deep]).map((n) => n.id)).toEqual([
      "nod_shallow",
      "nod_deep",
    ]);
  });

  it("keeps local results first and in their original order", () => {
    const a = node({ id: "nod_a" });
    const b = node({ id: "nod_b" });
    expect(mergeRecentMatches([b, a], [deep]).map((n) => n.id)).toEqual([
      "nod_b",
      "nod_a",
      "nod_deep",
    ]);
  });

  it("drops a server row the cache already had, matching on id", () => {
    const renamedOnServer = node({ id: "nod_shallow", name: "Zebra Renamed" });
    const merged = mergeRecentMatches([local], [renamedOnServer, deep]);

    expect(merged.map((n) => n.id)).toEqual(["nod_shallow", "nod_deep"]);
    // The local (possibly stale) copy wins its slot rather than being
    // reordered — self-healing the name is `merge`'s job, not this function's.
    expect(merged[0]?.name).toBe("Zebra Shallow Doc");
  });

  it("de-duplicates within the server results too", () => {
    expect(mergeRecentMatches([], [deep, deep]).map((n) => n.id)).toEqual(["nod_deep"]);
  });

  it("returns the local list unchanged when the server found nothing", () => {
    expect(mergeRecentMatches([local], [])).toEqual([local]);
  });

  it("returns the server list when the cache had nothing — the old fallback case still works", () => {
    expect(mergeRecentMatches([], [deep]).map((n) => n.id)).toEqual(["nod_deep"]);
  });

  it("does not mutate either input", () => {
    const localList = [local];
    const networkList = [deep];
    mergeRecentMatches(localList, networkList);
    expect(localList).toHaveLength(1);
    expect(networkList).toHaveLength(1);
  });
});

describe("partitionByVisited", () => {
  // Why by `lastVisitedAt` and not "was it in the cache": the cache also holds
  // the sidebar tree and every node a previous search returned, so a
  // cache-based split files never-opened nodes under "Recently visited".
  // Observed exactly that way before this existed — a folder three levels
  // deep, never opened, appeared under that heading because an earlier query
  // had returned it.
  const visited = (id: string) => node({ id, lastVisitedAt: "2026-01-01T00:00:00.000Z" });
  const unvisited = (id: string) => node({ id });

  it("floats visited rows above unvisited ones and counts them", () => {
    const { ordered, visitedCount } = partitionByVisited([
      unvisited("a"),
      visited("b"),
      unvisited("c"),
      visited("d"),
    ]);
    expect(ordered.map((n) => n.id)).toEqual(["b", "d", "a", "c"]);
    expect(visitedCount).toBe(2);
  });

  it("keeps each group's own order stable", () => {
    const { ordered } = partitionByVisited([
      visited("b"),
      visited("a"),
      unvisited("z"),
      unvisited("y"),
    ]);
    expect(ordered.map((n) => n.id)).toEqual(["b", "a", "z", "y"]);
  });

  it("reports zero when nothing was ever visited, so no heading is drawn", () => {
    const { ordered, visitedCount } = partitionByVisited([unvisited("a"), unvisited("b")]);
    expect(visitedCount).toBe(0);
    expect(ordered.map((n) => n.id)).toEqual(["a", "b"]);
  });

  it("reports the full length when everything was visited", () => {
    const { visitedCount } = partitionByVisited([visited("a"), visited("b")]);
    expect(visitedCount).toBe(2);
  });

  it("handles an empty list", () => {
    expect(partitionByVisited([])).toEqual({ ordered: [], visitedCount: 0 });
  });

  it("does not mutate its input", () => {
    const input = [unvisited("a"), visited("b")];
    partitionByVisited(input);
    expect(input.map((n) => n.id)).toEqual(["a", "b"]);
  });
});
