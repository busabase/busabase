import type { ViewVO } from "busabase-contract/types";

/**
 * Views of a Base in their shared tab order — `position`, ties broken by
 * creation time (then id, so the order is total). The server already lists
 * them this way; sorting again keeps an optimistic cache write, a host's seed
 * data, or an older server that predates `position` from reshuffling the tabs.
 */
export const sortViewsByPosition = <T extends Pick<ViewVO, "position" | "createdAt" | "id">>(
  views: readonly T[],
): T[] =>
  [...views].sort(
    (left, right) =>
      (left.position ?? 0) - (right.position ?? 0) ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.id.localeCompare(right.id),
  );

/**
 * Where a bare `/base/<slug>` should land: the Base's leftmost view, keeping
 * the current query string (`?space=…`, `?demo`, …). `null` when the Base has
 * no views — the caller then keeps rendering the plain all-records grid.
 */
export const resolveDefaultViewPath = ({
  baseSlug,
  search = "",
  views,
}: {
  baseSlug: string;
  search?: string;
  views: readonly Pick<ViewVO, "position" | "createdAt" | "id" | "slug">[];
}): string | null => {
  const [first] = sortViewsByPosition(views);
  if (!first || !baseSlug) return null;
  const query = search.replace(/^\?/, "");
  return `/base/${baseSlug}/${first.slug}${query ? `?${query}` : ""}`;
};

/**
 * The optimistic twin of the server's view reorder: move `viewId` to the
 * 0-based `position` among its Base's views (clamped) and renumber that Base's
 * views 0..n-1, exactly what merging `views.changeRequest({ operation:
 * "update", position })` persists. Views of other Bases pass through untouched.
 */
export const applyOptimisticViewReorder = <
  T extends Pick<ViewVO, "baseId" | "position" | "createdAt" | "id">,
>(
  views: readonly T[],
  viewId: string,
  position: number,
): T[] => {
  const moved = views.find((view) => view.id === viewId);
  if (!moved) return [...views];
  const siblings = sortViewsByPosition(
    views.filter((view) => view.baseId === moved.baseId && view.id !== viewId),
  );
  const index = Math.max(0, Math.min(Math.trunc(position), siblings.length));
  siblings.splice(index, 0, moved);
  const nextPosition = new Map(siblings.map((view, order) => [view.id, order]));
  return views.map((view) => {
    const order = nextPosition.get(view.id);
    return order === undefined || order === view.position ? view : { ...view, position: order };
  });
};

/** A Base must keep at least one view, so its only remaining view cannot be deleted. */
export const isOnlyRemainingView = (
  views: readonly Pick<ViewVO, "baseId" | "id">[],
  view: Pick<ViewVO, "baseId" | "id">,
): boolean =>
  !views.some((candidate) => candidate.baseId === view.baseId && candidate.id !== view.id);
