/**
 * The `childId` the view switcher uses for the all-records grid. A Base with
 * `settings.defaultViewSlug` opens its bare `/base/<slug>` route on that view,
 * so the switcher needs a route that says "the grid, on purpose" and is never
 * redirected. Shadows a saved view whose slug is literally `all`.
 */
export const ALL_RECORDS_CHILD_ID = "all";

/**
 * Where a bare `/base/<slug>` route lands when the Base names a default view,
 * or `null` to stay on the all-records grid: no setting, a slug that no active
 * view carries any more, or a slug that spells the grid itself.
 */
export const resolveDefaultViewPath = ({
  baseSlug,
  defaultViewSlug,
  views,
}: {
  baseSlug: string;
  defaultViewSlug: string | null | undefined;
  views: ReadonlyArray<{ slug: string }>;
}): string | null => {
  if (!defaultViewSlug || defaultViewSlug === ALL_RECORDS_CHILD_ID) return null;
  if (!views.some((view) => view.slug === defaultViewSlug)) return null;
  return `/base/${baseSlug}/${defaultViewSlug}`;
};
