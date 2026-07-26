import type { NodeType } from "busabase-contract/domains";
import type { NodeVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import { flattenMoveTargets } from "./node-move-targets";

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
  baseId: null,
  children,
  hasChildren: children.length > 0,
});

describe("flattenMoveTargets", () => {
  it("keeps only container-capable nodes, pre-order and depth-indented", () => {
    const tree = [
      node("root", "folder", [
        node("a", "folder", [node("a1", "folder", [], "a")], "root"),
        node("doc", "doc", [], "root"),
        node("b", "folder", [], "root"),
      ]),
    ];

    expect(flattenMoveTargets(tree, "never-matches")).toEqual([
      { id: "root", name: "Node root", depth: 0 },
      { id: "a", name: "Node a", depth: 1 },
      { id: "a1", name: "Node a1", depth: 2 },
      { id: "b", name: "Node b", depth: 1 },
    ]);
  });

  it("excludes the moved node and every one of its descendants", () => {
    const tree = [
      node("root", "folder", [
        node("a", "folder", [node("a1", "folder", [node("a2", "folder", [], "a1")], "a")], "root"),
        node("b", "folder", [], "root"),
      ]),
    ];

    // Moving `a` must not offer `a`, `a1`, or `a2` — re-parenting a folder
    // under its own descendant would orphan the subtree in a cycle.
    expect(flattenMoveTargets(tree, "a").map((row) => row.id)).toEqual(["root", "b"]);
  });

  it("returns nothing when the only container is the node being moved", () => {
    expect(flattenMoveTargets([node("solo", "folder")], "solo")).toEqual([]);
  });

  it("skips leaf types entirely", () => {
    const tree = [node("root", "folder", [node("base", "base", [], "root")], null)];
    expect(flattenMoveTargets(tree, "base").map((row) => row.id)).toEqual(["root"]);
  });
});
