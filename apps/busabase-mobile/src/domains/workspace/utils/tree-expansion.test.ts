import type { NodeType } from "busabase-contract/domains";
import type { NodeVO } from "busabase-contract/types";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ancestorIdsOfActiveNode,
  expandNodes,
  getExpandedNodeIds,
  resetNodeExpansion,
  toggleNodeExpanded,
} from "./tree-expansion";

const node = (
  id: string,
  type: NodeType,
  children: NodeVO[] = [],
  parentId: string | null = null,
): NodeVO => ({
  id,
  parentId,
  type,
  slug: id,
  name: `Node ${id}`,
  description: "",
  metadata: {},
  position: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  explicitVisibility: null,
  baseId: null,
  children,
  hasChildren: children.length > 0,
});

const tree = [
  node("root", "folder", [
    node("a", "folder", [node("a1", "folder", [node("deep", "base", [], "a1")], "a")], "root"),
    node("b", "folder", [], "root"),
  ]),
];

describe("ancestorIdsOfActiveNode", () => {
  it("returns the whole chain above the active node, outermost first", () => {
    expect(ancestorIdsOfActiveNode(tree, (candidate) => candidate.id === "deep")).toEqual([
      "root",
      "a",
      "a1",
    ]);
  });

  it("excludes the active node itself, so standing on a folder does not open it", () => {
    expect(ancestorIdsOfActiveNode(tree, (candidate) => candidate.id === "a")).toEqual(["root"]);
  });

  it("returns nothing when no node matches", () => {
    expect(ancestorIdsOfActiveNode(tree, () => false)).toEqual([]);
  });
});

describe("expansion store", () => {
  beforeEach(() => {
    resetNodeExpansion();
  });

  it("starts collapsed", () => {
    expect([...getExpandedNodeIds()]).toEqual([]);
  });

  it("toggles a node open and closed again", () => {
    toggleNodeExpanded("a");
    expect(getExpandedNodeIds().has("a")).toBe(true);
    toggleNodeExpanded("a");
    expect(getExpandedNodeIds().has("a")).toBe(false);
  });

  it("expandNodes is additive and never closes what the user opened", () => {
    toggleNodeExpanded("b");
    expandNodes(["root", "a"]);
    expect([...getExpandedNodeIds()].sort()).toEqual(["a", "b", "root"]);
  });

  it("expandNodes keeps the same snapshot identity when nothing is missing", () => {
    expandNodes(["root", "a"]);
    const before = getExpandedNodeIds();
    // The auto-expand effect re-runs on every render; an unchanged snapshot
    // identity is what stops useSyncExternalStore from re-rendering forever.
    expandNodes(["root", "a"]);
    expect(getExpandedNodeIds()).toBe(before);
  });
});
