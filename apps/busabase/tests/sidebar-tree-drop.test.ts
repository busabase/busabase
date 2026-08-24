import { resolveTreeDrop, type TreeDropRow } from "openlib/ui/dashboard/tree-drop";
import { describe, expect, it } from "vitest";

/**
 * Unit cover for the sidebar's drop-position maths.
 *
 * It lives in `apps/busabase/tests/` rather than next to the source in
 * `packages/openlib` because openlib has no test runner of its own — its
 * existing `*.test.ts` files are never executed by anything. Putting it here
 * means it actually runs (`pnpm --filter busabase test`). The e2e counterpart
 * that drives real pointer events is
 * `apps/busabase/tests/e2e/sidebar-drag-reorder.spec.ts`.
 *
 * The scenario below is the exact geometry measured live in the browser while
 * the old flat-`SortableContext` implementation was mid-drag, which is what
 * made an in-folder reorder silently move the node out to the workspace root.
 */

/** A folder header at y=192 (h=32) with four 28px children stacked under it. */
const folderWithChildren = (): TreeDropRow[] => [
  { id: "folder", top: 192, height: 32, isContainer: true, depth: 0 },
  { id: "child-1", top: 224, height: 28, isContainer: false, depth: 1 },
  { id: "child-2", top: 252, height: 28, isContainer: false, depth: 1 },
  { id: "child-3", top: 280, height: 28, isContainer: false, depth: 1 },
  { id: "child-4", top: 308, height: 28, isContainer: false, depth: 1 },
];

describe("resolveTreeDrop", () => {
  it("resolves the row the pointer is inside, not the nearest one", () => {
    const rows = folderWithChildren();
    // 226 is 2px into the FIRST CHILD. The folder header's centre (208) is only
    // 18px away while the child's centre (238) is 12px away — a margin thin
    // enough that a nearest-centre rule flipped between the two from frame to
    // frame. Containment has no such ambiguity.
    expect(resolveTreeDrop(rows, 226)).toEqual({ targetId: "child-1", position: "before" });
  });

  it("offers before/after on a leaf and never 'inside'", () => {
    const rows = folderWithChildren();
    expect(resolveTreeDrop(rows, 226)?.position).toBe("before");
    // Dead centre of a leaf is still a reorder, because a leaf has no inside.
    expect(resolveTreeDrop(rows, 238)?.position).toBe("before");
    expect(resolveTreeDrop(rows, 250)?.position).toBe("after");
  });

  it("offers 'inside' only in the middle band of a container row", () => {
    const rows = folderWithChildren();
    // Folder spans 192..224. Outer 25% each side = reorder, middle 50% = reparent.
    expect(resolveTreeDrop(rows, 194)).toEqual({ targetId: "folder", position: "before" });
    expect(resolveTreeDrop(rows, 208)).toEqual({ targetId: "folder", position: "inside" });
    expect(resolveTreeDrop(rows, 222)).toEqual({ targetId: "folder", position: "after" });
  });

  it("returns null outside every row instead of snapping to the closest", () => {
    const rows = folderWithChildren();
    // Well above the tree and well below it. The old nearest-centre detection
    // would have happily picked the first/last row from here.
    expect(resolveTreeDrop(rows, 40)).toBeNull();
    expect(resolveTreeDrop(rows, 900)).toBeNull();
  });

  it("prefers the deepest row when rows overlap", () => {
    // A caller that measures an ancestor wrapper as well as the row inside it
    // must still resolve to the row the user is visually pointing at.
    const rows: TreeDropRow[] = [
      { id: "outer", top: 100, height: 200, isContainer: true, depth: 0 },
      { id: "inner", top: 140, height: 28, isContainer: false, depth: 2 },
    ];
    expect(resolveTreeDrop(rows, 150)?.targetId).toBe("inner");
  });

  it("ignores zero-height rows", () => {
    // A collapsed/unmounted row can report a 0-height rect; it must not swallow
    // every pointer position that happens to share its top edge.
    const rows: TreeDropRow[] = [
      { id: "ghost", top: 224, height: 0, isContainer: false, depth: 1 },
      { id: "real", top: 224, height: 28, isContainer: false, depth: 1 },
    ];
    expect(resolveTreeDrop(rows, 224)?.targetId).toBe("real");
  });
});
