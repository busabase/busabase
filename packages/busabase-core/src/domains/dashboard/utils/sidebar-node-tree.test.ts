import type { NodeVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import { getSidebarTopLevelNodes } from "./sidebar-node-tree";

const makeNode = (overrides: Partial<NodeVO> = {}): NodeVO => ({
  id: "node",
  parentId: "parent",
  type: "folder",
  slug: "node",
  name: "Node",
  description: "",
  metadata: {},
  explicitVisibility: null,
  position: 0,
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
  baseId: null,
  children: [],
  ...overrides,
});

describe("getSidebarTopLevelNodes", () => {
  it("unwraps the workspace root for a complete administrator tree", () => {
    const child = makeNode({ id: "projects", parentId: "root", name: "Projects" });
    const root = makeNode({
      id: "root",
      parentId: null,
      name: "Renamed system root",
      slug: "not-a-root-slug",
      children: [child],
    });

    expect(getSidebarTopLevelNodes([root])).toEqual([child]);
  });

  it("unwraps the root and retains ACL-promoted nodes beside it", () => {
    const rootChild = makeNode({
      id: "handbook",
      parentId: "root",
      type: "doc",
      name: "Handbook",
    });
    const root = makeNode({ id: "root", parentId: null, children: [rootChild] });
    const promoted = makeNode({
      id: "forecast",
      parentId: "hidden-private-folder",
      type: "doc",
      name: "Shared Forecast",
    });

    expect(getSidebarTopLevelNodes([root, promoted])).toEqual([rootChild, promoted]);
  });

  it("does not unwrap a sole real folder promoted from a hidden parent", () => {
    const nestedChild = makeNode({ id: "nested-doc", type: "doc" });
    const promotedFolder = makeNode({
      id: "promoted-folder",
      parentId: "hidden-private-folder",
      children: [nestedChild],
    });

    expect(getSidebarTopLevelNodes([promotedFolder])).toEqual([promotedFolder]);
  });

  it("returns an empty tree unchanged", () => {
    expect(getSidebarTopLevelNodes([])).toEqual([]);
  });
});
