import { describe, expect, it } from "vitest";
import { createKnownNodeCache, type KnownNode } from "./known-node-cache";

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
