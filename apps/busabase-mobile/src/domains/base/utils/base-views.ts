import type { ViewVO } from "busabase-contract/types";

/**
 * A Base's saved views in their shared tab order.
 *
 * Every Base has at least one real view, and the leftmost one (lowest
 * `position`) is the one it opens on — there is no unsaved "All" option any
 * more. The server already answers `listViews` in this order; sorting again
 * here keeps the screen right against an older server (which has no `position`
 * and orders by creation time, the same tie-break used below).
 */
export const orderViews = <T extends Pick<ViewVO, "position" | "createdAt">>(
  views: readonly T[],
): T[] =>
  [...views].sort(
    (left, right) =>
      (left.position ?? 0) - (right.position ?? 0) || left.createdAt.localeCompare(right.createdAt),
  );

/**
 * The view the screen shows: the one the user picked if it still exists,
 * otherwise the Base's first view.
 *
 * `null` only when the Base has no views at all — which should never happen,
 * but must not crash: the caller then lists every record unfiltered.
 */
export const resolveActiveView = <T extends Pick<ViewVO, "id">>(
  orderedViews: readonly T[],
  selectedViewId: string | null,
): T | null => orderedViews.find((view) => view.id === selectedViewId) ?? orderedViews[0] ?? null;

/** What the server answers when asked to delete a Base's last view. */
export const LAST_VIEW_DELETE_MESSAGE =
  "A Base must keep at least one view. Create another view before deleting this one.";

/** A Base must keep at least one view, so its last one cannot be deleted. */
export const canDeleteView = (views: readonly unknown[]): boolean => views.length > 1;
