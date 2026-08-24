/**
 * Pure drop resolution for a TREE rendered as a vertical list of rows.
 *
 * Why this exists as its own (React-free, DOM-free) module:
 *
 * The sidebar used to hand the whole node tree to dnd-kit's
 * `SortableContext` + `verticalListSortingStrategy` and read the drop position
 * off `over.rect`. That strategy is built for a ONE-DIMENSIONAL list: while you
 * drag, it translates every row to preview a flat-list reorder. Measured live
 * on the busabase sidebar mid-drag, a folder header sitting at `top: 192` was
 * pushed to `top: 258` and its first child from `226` to `294` — the whole tree
 * shifted ~66px. `closestCenter` then compared those SHIFTED rects, so the
 * parent folder header routinely won the collision over the sibling row the
 * pointer was actually on. A "before"/"after" drop on a folder header means
 * "become a sibling OF THE FOLDER", i.e. reparent to the folder's parent — so
 * reordering two children inside a folder silently moved the node out to the
 * workspace root. Reproduced 3/3 on a fresh seed, and identically on the very
 * first version of the feature: it was never a regression, it shipped this way.
 *
 * The fix is to stop asking a list strategy to reason about a tree. Rows are
 * plain droppables that never move during a drag, and this function resolves
 * the drop from ONE coordinate system: the live pointer position against the
 * rows' own (untranslated) rects. Keeping it here — pure, no `@dnd-kit`
 * imports — is what makes it unit-testable without a browser, and reusable by
 * the other tree-with-drag surface in the monorepo
 * (`buda-core`'s agents sidebar), which has the same flat-SortableContext
 * shape but its own data model and mutations.
 */

/** Drop position relative to the row the pointer was released over. */
export type NavDropPosition = "before" | "after" | "inside";

/**
 * One candidate drop row, as measured from the DOM at drag time. `top`/`height`
 * are viewport coordinates (`getBoundingClientRect`), the SAME space the
 * pointer's `clientY` lives in — mixing the two spaces is precisely the bug
 * this module exists to remove, so callers must not pass transformed rects.
 */
export interface TreeDropRow {
  id: string;
  top: number;
  height: number;
  /**
   * Whether this row can contain children, i.e. whether an "inside" band is
   * offered at all. A leaf only ever gets "before"/"after".
   */
  isContainer: boolean;
  /**
   * Depth in the tree (0 = top level). Used only to break ties between two
   * equally-plausible rows, see `resolveTreeDrop`.
   */
  depth: number;
}

export interface TreeDropTarget {
  targetId: string;
  position: NavDropPosition;
}

/**
 * Fraction of a container row's height, measured from each edge, that reads as
 * "before"/"after" rather than "inside". The middle 50% of a folder row is its
 * reparent band; the outer 25% top and bottom are reorder bands.
 */
const CONTAINER_EDGE_BAND = 0.25;

/**
 * Resolve which row the pointer is over and which band of it, from untranslated
 * rects and a live pointer position.
 *
 * Returns `null` when the pointer is outside every row — the caller should
 * treat that as "no drop target" rather than snapping to the nearest row.
 * `closestCenter`-style nearest-match is exactly what let a drag drifting
 * through the gutter land on an unrelated row.
 *
 * Rows may overlap (a folder header's rect is nested inside nothing, but a
 * caller could legitimately measure an ancestor wrapper). When several rows
 * contain the pointer, the DEEPEST wins — the innermost row is the one the
 * user is visually pointing at.
 */
export function resolveTreeDrop(rows: TreeDropRow[], pointerY: number): TreeDropTarget | null {
  let best: TreeDropRow | null = null;
  for (const row of rows) {
    if (row.height <= 0) continue;
    if (pointerY < row.top || pointerY >= row.top + row.height) continue;
    if (!best || row.depth > best.depth) best = row;
  }
  if (!best) return null;
  const relativeY = (pointerY - best.top) / best.height;
  if (best.isContainer && relativeY > CONTAINER_EDGE_BAND && relativeY < 1 - CONTAINER_EDGE_BAND) {
    return { targetId: best.id, position: "inside" };
  }
  return { targetId: best.id, position: relativeY <= 0.5 ? "before" : "after" };
}
