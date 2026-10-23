import { registerNodeType } from "busabase-contract/domains";
import type { NodeVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import { buildNavItems, nodeHref } from "./nav-tree";

// No built-in type is hidden or a container without a detail screen, so declare one of each.
registerNodeType({
  type: "test-hidden",
  label: "Hidden",
  icon: "file",
  capabilities: { hasDetail: true, hidden: true },
  operations: [],
});
registerNodeType({
  type: "test-bare-container",
  label: "Bare container",
  icon: "folder",
  capabilities: { container: true },
  operations: [],
});

const node = (
  overrides: Partial<NodeVO> & Pick<NodeVO, "id" | "slug" | "name" | "type">,
): NodeVO => ({
  baseId: null,
  children: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  description: "",
  explicitVisibility: null,
  icon: null,
  metadata: {},
  parentId: null,
  position: 0,
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("nodeHref", () => {
  it("addresses a Base by slug under /base and everything else by /{type}/{slug}", () => {
    expect(nodeHref({ type: "base", slug: "posts" })).toBe("/base/posts");
    expect(nodeHref({ type: "folder", slug: "growth" })).toBe("/folder/growth");
    expect(nodeHref({ type: "doc", slug: "spec" })).toBe("/doc/spec");
  });

  it("has no route for a Base without a slug or a type with no detail screen", () => {
    expect(nodeHref({ type: "base", slug: "" })).toBeNull();
    expect(nodeHref({ type: "not-a-node-type", slug: "x" })).toBeNull();
  });
});

describe("buildNavItems", () => {
  const tree = [
    node({
      id: "f1",
      slug: "f1",
      name: "F1",
      type: "folder",
      hasChildren: true,
      children: [
        node({
          id: "f2",
          slug: "f2",
          name: "F2",
          type: "folder",
          hasChildren: true,
          // A `nodes.list` depth boundary: more below, none loaded yet.
          children: [node({ id: "f3", slug: "f3", name: "F3", type: "folder", hasChildren: true })],
        }),
        node({ id: "d", slug: "d", name: "Doc", type: "doc" }),
      ],
    }),
  ];

  it("nests containers at every depth and keeps the lazy boundary expandable", () => {
    const [f1] = buildNavItems(tree);
    expect(f1).toMatchObject({ id: "f1", title: "F1", url: "/folder/f1", hasChildren: true });
    const [f2, doc] = f1?.items ?? [];
    expect(f2).toMatchObject({ id: "f2", url: "/folder/f2", hasChildren: true });
    expect(doc).toMatchObject({ id: "d", title: "Doc", url: "/doc/d" });
    // A leaf carries none of the folder fields.
    expect(doc).not.toHaveProperty("items");
    expect(doc).not.toHaveProperty("hasChildren");
    // The boundary folder has no loaded rows but still reads as a folder.
    const [f3] = f2?.items ?? [];
    expect(f3).toMatchObject({ id: "f3", hasChildren: true, items: [] });
  });

  it("derives hasChildren from the loaded children when the node does not say", () => {
    const [withKids] = buildNavItems([
      node({ id: "a", slug: "a", name: "A", type: "folder", children: [tree[0] as NodeVO] }),
    ]);
    const [alone] = buildNavItems([node({ id: "b", slug: "b", name: "B", type: "folder" })]);
    expect(withKids?.hasChildren).toBe(true);
    expect(alone?.hasChildren).toBe(false);
  });

  it("marks the folders whose children are being fetched", () => {
    const [f1] = buildNavItems(tree, { loadingNodeIds: new Set(["f2"]) });
    expect(f1?.isLoadingChildren).toBe(false);
    expect(f1?.items?.[0]?.isLoadingChildren).toBe(true);
  });

  it("drops hidden types, types with no detail screen and rows the host excludes, at any depth", () => {
    const rows = buildNavItems(
      [
        node({ id: "h", slug: "h", name: "Hidden", type: "test-hidden" }),
        node({ id: "u", slug: "u", name: "Unknown", type: "not-a-node-type" }),
        node({
          id: "f",
          slug: "f",
          name: "F",
          type: "folder",
          children: [
            node({ id: "k", slug: "k", name: "Kept", type: "doc" }),
            node({ id: "x", slug: "x", name: "Excluded", type: "doc" }),
          ],
        }),
      ],
      { include: (n) => n.id !== "x" },
    );
    expect(rows.map((row) => row.id)).toEqual(["f"]);
    expect(rows[0]?.items?.map((row) => row.id)).toEqual(["k"]);
  });

  it("keeps a container that has no detail screen, as a row with no link", () => {
    const [row] = buildNavItems([
      node({ id: "c", slug: "c", name: "C", type: "test-bare-container" }),
    ]);
    expect(row).toMatchObject({ id: "c", url: "" });
  });

  it("layers the host's decoration over every row with its shape and href", () => {
    const seen: Array<[string, string, string | null]> = [];
    const rows = buildNavItems(tree, {
      decorate: (n, shape, href) => {
        seen.push([n.id, shape, href]);
        return { badge: `${shape}:${n.id}` };
      },
    });
    // Every row is decorated exactly once; the order of the calls is not part of the contract.
    expect(seen).toHaveLength(4);
    expect(seen).toEqual(
      expect.arrayContaining([
        ["f1", "container", "/folder/f1"],
        ["f2", "container", "/folder/f2"],
        ["f3", "container", "/folder/f3"],
        ["d", "leaf", "/doc/d"],
      ]),
    );
    expect(rows[0]?.badge).toBe("container:f1");
    expect(rows[0]?.items?.[1]?.badge).toBe("leaf:d");
  });

  it("builds the same rows with no options as a host that adds nothing", () => {
    expect(buildNavItems(tree, {})).toEqual(buildNavItems(tree));
  });
});
