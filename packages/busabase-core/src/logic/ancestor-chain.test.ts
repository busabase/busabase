import { describe, expect, it } from "vitest";
import { collectAncestorIds, MAX_ANCESTOR_DEPTH } from "./ancestor-chain";

/** `root` has no parent, standing in for the workspace root. */
const tree: Record<string, string | null> = {
  root: null,
  a: "root",
  b: "a",
  c: "b",
  leaf: "c",
  other: "root",
};
const parentOf = (id: string) => tree[id];

describe("collectAncestorIds", () => {
  it("returns the chain root-first, excluding the node itself and the root", async () => {
    expect(await collectAncestorIds("leaf", parentOf)).toEqual(["a", "b", "c"]);
    expect(await collectAncestorIds("c", parentOf)).toEqual(["a", "b"]);
  });

  it("returns [] for a node sitting directly under the root", async () => {
    expect(await collectAncestorIds("a", parentOf)).toEqual([]);
    expect(await collectAncestorIds("other", parentOf)).toEqual([]);
  });

  it("returns [] for an unknown node rather than inventing a chain", async () => {
    expect(await collectAncestorIds("nope", parentOf)).toEqual([]);
  });

  it("drops an ancestor whose own row is missing instead of emitting a dangling id", async () => {
    // `orphan`'s parent points at an id with no row behind it. `ghost` must not
    // be emitted — a caller could do nothing with it.
    const broken: Record<string, string | null | undefined> = {
      orphan: "ghost",
      ghost: undefined,
    };
    expect(await collectAncestorIds("orphan", (id) => broken[id])).toEqual([]);
  });

  it("survives a cycle instead of spinning", async () => {
    const cyclic: Record<string, string> = { x: "y", y: "z", z: "x" };
    // Every hop is a real parent, so only the visited-set guard can stop this.
    const chain = await collectAncestorIds("x", (id) => cyclic[id]);
    expect(chain.length).toBeLessThanOrEqual(3);
  });

  it("stops at the depth bound on a pathologically long chain", async () => {
    // Each node's parent is the next one up, forever — no cycle, so only the
    // bound can stop it.
    const endless = (id: string) => `n${Number(id.slice(1)) + 1}`;
    const chain = await collectAncestorIds("n0", endless);
    expect(chain).toHaveLength(MAX_ANCESTOR_DEPTH);
  });

  it("accepts an async resolver, so a database lookup fits the same walk", async () => {
    const asyncParent = async (id: string) => tree[id];
    expect(await collectAncestorIds("leaf", asyncParent)).toEqual(["a", "b", "c"]);
  });
});
