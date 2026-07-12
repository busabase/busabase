/**
 * Sidebar lazy-load: `nodes.list`'s depth-bounded fetch (`parentId`/`depth`)
 * and `nodes.isDescendant` (server-authoritative drag-and-drop cycle check).
 *
 * Builds a 4-level-deep chain under the space root — root -> A -> B -> C ->
 * D(doc) — plus an unrelated sibling folder E, and exercises:
 *  - the legacy zero-arg call still returns the FULL unbounded tree
 *  - `{ parentId: null, depth: 2 }` returns the wrapped root, 2 levels deep,
 *    with `hasChildren` correctly backfilled at the depth boundary
 *  - `{ parentId: <folder>, depth }` returns that folder's children directly
 *    (the shape a sidebar's lazy "expand" merges into `NodeVO.children`)
 *  - `nodes.isDescendant` walks the parentId chain correctly, including the
 *    self case and an unrelated branch
 */
import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";
import { busabaseDemoRouter } from "../src/router-demo";
import { seedScenario } from "./helpers/seed-scenario";

type RawClient = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

interface TestNode {
  id: string;
  slug: string;
  hasChildren?: boolean;
  children: TestNode[];
}

const findInTree = (nodes: TestNode[], slug: string): TestNode | undefined => {
  for (const node of nodes) {
    if (node.slug === slug) return node;
    const nested = findInTree(node.children, slug);
    if (nested) return nested;
  }
  return undefined;
};

describe("nodes.list depth-bounded fetch + nodes.isDescendant", () => {
  it("legacy zero-arg call returns the full unbounded tree", async () => {
    await seedScenario("lazy-load-legacy");
    const raw: RawClient = createRouterClient(busabaseRouter);

    await raw.nodes.createChangeRequest({
      autoMerge: true,
      message: "Build a deep chain",
      operations: [
        { kind: "create", ref: "a", nodeType: "folder", slug: "a", name: "A" },
        { kind: "create", ref: "b", parentNodeRef: "a", nodeType: "folder", slug: "b", name: "B" },
        { kind: "create", ref: "c", parentNodeRef: "b", nodeType: "folder", slug: "c", name: "C" },
        { kind: "create", parentNodeRef: "c", nodeType: "doc", slug: "d", name: "D" },
      ],
    });

    const tree = (await raw.nodes.list()) as TestNode[];
    // legacy shape: single wrapped root, full depth reachable in one call.
    expect(tree).toHaveLength(1);
    const d = findInTree(tree, "d");
    expect(d).toBeDefined();
    expect(d?.children).toEqual([]);
    expect(d?.hasChildren).toBe(false);
  });

  it("depth-bounded root fetch stops at the boundary with hasChildren backfilled", async () => {
    await seedScenario("lazy-load-root-bounded");
    const raw: RawClient = createRouterClient(busabaseRouter);

    await raw.nodes.createChangeRequest({
      autoMerge: true,
      message: "Build a deep chain",
      operations: [
        { kind: "create", ref: "a", nodeType: "folder", slug: "a", name: "A" },
        { kind: "create", ref: "b", parentNodeRef: "a", nodeType: "folder", slug: "b", name: "B" },
        { kind: "create", ref: "c", parentNodeRef: "b", nodeType: "folder", slug: "c", name: "C" },
        { kind: "create", parentNodeRef: "c", nodeType: "doc", slug: "d", name: "D" },
      ],
    });

    const bounded = (await raw.nodes.list({ parentId: null, depth: 2 })) as TestNode[];
    expect(bounded).toHaveLength(1); // wrapped root, same envelope as the legacy call
    const root = bounded[0];
    expect(root.hasChildren).toBe(true);

    const a = findInTree(bounded, "a");
    expect(a).toBeDefined();
    expect(a?.hasChildren).toBe(true);
    expect(a?.children).toHaveLength(1); // level 1 beneath root — fully loaded

    const b = findInTree(bounded, "b");
    expect(b).toBeDefined();
    // B sits at the depth boundary (root=0, A=1, B=2): its real child C exists
    // but isn't fetched — children stays empty, hasChildren must still be true.
    expect(b?.children).toEqual([]);
    expect(b?.hasChildren).toBe(true);

    // C (beyond the boundary) never appears in this response at all.
    expect(findInTree(bounded, "c")).toBeUndefined();
  });

  it("depth-bounded per-folder fetch returns that folder's children directly (lazy expand)", async () => {
    await seedScenario("lazy-load-folder-bounded");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const cr = await raw.nodes.createChangeRequest({
      autoMerge: true,
      message: "Build a deep chain",
      operations: [
        { kind: "create", ref: "a", nodeType: "folder", slug: "a", name: "A" },
        { kind: "create", ref: "b", parentNodeRef: "a", nodeType: "folder", slug: "b", name: "B" },
        { kind: "create", ref: "c", parentNodeRef: "b", nodeType: "folder", slug: "c", name: "C" },
        { kind: "create", parentNodeRef: "c", nodeType: "doc", slug: "d", name: "D" },
      ],
    });
    expect(cr.status).toBe("merged");

    const fullTree = (await raw.nodes.list()) as TestNode[];
    const bNode = findInTree(fullTree, "b");
    expect(bNode).toBeDefined();
    const bId = bNode?.id as string;

    // Expanding B: returns B's CHILDREN directly (not B itself), 2 levels deep.
    const expanded = (await raw.nodes.list({ parentId: bId, depth: 2 })) as TestNode[];
    expect(expanded).toHaveLength(1);
    expect(expanded[0].slug).toBe("c");
    expect(expanded[0].hasChildren).toBe(true);
    // C's own child D IS included (2 levels beneath B: C, then D).
    expect(expanded[0].children).toHaveLength(1);
    expect(expanded[0].children[0].slug).toBe("d");
    expect(expanded[0].children[0].hasChildren).toBe(false);
  });

  it("isDescendant walks the parentId chain, including self and unrelated-branch cases", async () => {
    await seedScenario("lazy-load-is-descendant");
    const raw: RawClient = createRouterClient(busabaseRouter);

    await raw.nodes.createChangeRequest({
      autoMerge: true,
      message: "Build a deep chain + an unrelated sibling",
      operations: [
        { kind: "create", ref: "a", nodeType: "folder", slug: "a", name: "A" },
        { kind: "create", ref: "b", parentNodeRef: "a", nodeType: "folder", slug: "b", name: "B" },
        { kind: "create", ref: "c", parentNodeRef: "b", nodeType: "folder", slug: "c", name: "C" },
        { kind: "create", nodeType: "folder", slug: "e", name: "E" },
      ],
    });

    const tree = (await raw.nodes.list()) as TestNode[];
    const a = findInTree(tree, "a") as TestNode;
    const b = findInTree(tree, "b") as TestNode;
    const c = findInTree(tree, "c") as TestNode;
    const e = findInTree(tree, "e") as TestNode;

    // C is a descendant of A (via B).
    expect(await raw.nodes.isDescendant({ nodeId: c.id, potentialAncestorId: a.id })).toEqual({
      isDescendant: true,
    });
    // The reverse is false — A is not a descendant of C.
    expect(await raw.nodes.isDescendant({ nodeId: a.id, potentialAncestorId: c.id })).toEqual({
      isDescendant: false,
    });
    // A node is never its own descendant.
    expect(await raw.nodes.isDescendant({ nodeId: a.id, potentialAncestorId: a.id })).toEqual({
      isDescendant: false,
    });
    // E is an unrelated top-level branch — not a descendant of B or vice versa.
    expect(await raw.nodes.isDescendant({ nodeId: e.id, potentialAncestorId: b.id })).toEqual({
      isDescendant: false,
    });
    expect(await raw.nodes.isDescendant({ nodeId: b.id, potentialAncestorId: e.id })).toEqual({
      isDescendant: false,
    });
  });
});

describe("nodes.list / nodes.isDescendant (demo mode)", () => {
  // Demo mode never touches the db (see logic/demo-store.ts) — the whole
  // seeded tree is always in memory, so `parentId`/`depth` are intentionally
  // ignored rather than reimplemented against the fixture.
  const demoClient = createRouterClient(busabaseDemoRouter);

  it("ignores parentId/depth and always returns the full seeded tree", async () => {
    // `dataset()` rebuilds fresh timestamps on every call, so compare
    // structure (ids/slugs), not full deep equality.
    const idShape = (nodes: TestNode[]): unknown =>
      nodes.map((node) => ({ id: node.id, slug: node.slug, children: idShape(node.children) }));
    const full = (await demoClient.nodes.list()) as TestNode[];
    const bounded = (await demoClient.nodes.list({ parentId: null, depth: 1 })) as TestNode[];
    expect(idShape(bounded)).toEqual(idShape(full));
  });

  it("isDescendant walks the seeded tree correctly", async () => {
    const tree = (await demoClient.nodes.list()) as TestNode[];
    const root = tree[0];
    const folderWithChild = root.children.find((node) => node.children.length > 0);
    expect(folderWithChild).toBeDefined();
    const child = (folderWithChild as TestNode).children[0];

    expect(
      await demoClient.nodes.isDescendant({
        nodeId: child.id,
        potentialAncestorId: (folderWithChild as TestNode).id,
      }),
    ).toEqual({ isDescendant: true });
    expect(
      await demoClient.nodes.isDescendant({
        nodeId: (folderWithChild as TestNode).id,
        potentialAncestorId: child.id,
      }),
    ).toEqual({ isDescendant: false });
    expect(
      await demoClient.nodes.isDescendant({ nodeId: child.id, potentialAncestorId: child.id }),
    ).toEqual({ isDescendant: false });
  });
});
