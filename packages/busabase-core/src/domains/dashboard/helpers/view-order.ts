import type { ViewVO } from "busabase-contract/types";

/**
 * A cached result can be fetched while still refetching after a settings save.
 * Wait for that request before redirecting, or the old default wins the race.
 * A first failure still releases the route to its existing fallback.
 */
export const isDefaultViewSettingsSettled = (query: {
  isFetched: boolean;
  isFetching: boolean;
  failureCount: number;
}): boolean => (query.isFetched && !query.isFetching) || query.failureCount > 0;

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
 * Where a bare `/base/<slug>` should land.
 *
 * `defaultViewSlug` wins when it names one of `views`. Otherwise the leftmost
 * view does — tab order stays the default, and the setting is only how a Base
 * opens somewhere else. A slug that matches nothing is ignored, same as
 * leaving the setting unset. The current query string (`?space=…`, `?demo`,
 * …) is kept. `null` when the Base has no views — the caller then keeps
 * rendering the plain all-records grid.
 */
export const resolveDefaultViewPath = ({
  baseSlug,
  defaultViewSlug,
  search = "",
  views,
}: {
  baseSlug: string;
  defaultViewSlug?: string | null;
  search?: string;
  views: readonly Pick<ViewVO, "position" | "createdAt" | "id" | "slug">[];
}): string | null => {
  const ordered = sortViewsByPosition(views);
  const preferred = defaultViewSlug
    ? ordered.find((view) => view.slug === defaultViewSlug)
    : undefined;
  const target = preferred ?? ordered[0];
  if (!target || !baseSlug) return null;
  const query = search.replace(/^\?/, "");
  return `/base/${baseSlug}/${target.slug}${query ? `?${query}` : ""}`;
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
