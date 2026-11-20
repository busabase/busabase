/**
 * The view a record was opened from, carried on the record URL.
 *
 * Named `fromView` rather than `view`: the inbox already uses `view` for its
 * tab (`?view=review`), and a record link must not change that tab when the
 * search string is copied onto another page.
 *
 * The path stays `/base/<slug>/<recordId>`. The query is only how the Base
 * breadcrumb (and edit, save, and cancel) get back to that view. A bare
 * `/base/<slug>` still opens the Base's default view, which is a different
 * question.
 */
export const SOURCE_VIEW_PARAM = "fromView";

export function readSourceViewSlug(search: string): string | null {
  const slug = new URLSearchParams(search.replace(/^\?/, "")).get(SOURCE_VIEW_PARAM)?.trim() ?? "";
  return slug || null;
}

/** The carried slug when it still names an active view of this Base. */
export function resolveCarriedViewSlug(
  search: string,
  views: readonly { slug: string }[],
): string | null {
  const slug = readSourceViewSlug(search);
  if (!slug || !views.some((view) => view.slug === slug)) return null;
  return slug;
}

/** Base breadcrumb target: the source view when it is still active, otherwise the bare Base. */
export function baseCrumbHref(baseSlug: string, carriedViewSlug: string | null): string {
  return carriedViewSlug ? `/base/${baseSlug}/${carriedViewSlug}` : `/base/${baseSlug}`;
}

/** Put the source view on a record, edit, new, or activity href. */
export function withSourceView(path: string, viewSlug: string | null | undefined): string {
  if (!viewSlug) return path;
  const [pathname, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.set(SOURCE_VIEW_PARAM, viewSlug);
  const next = params.toString();
  return next ? `${pathname}?${next}` : pathname;
}
