import type { ViewVO } from "busabase-contract/types";

/** Keep the creating view with schema editing without leaking a previous Base's view. */
export function fieldDesignHref(baseSlug: string, search: string, originViewId?: string): string {
  const params = new URLSearchParams(search);
  params.delete("originViewId");
  params.delete("highlightField");
  if (originViewId) params.set("originViewId", originViewId);
  const query = params.toString();
  return `/base/${baseSlug}/design${query ? `?${query}` : ""}`;
}

export function fieldRecordsHref(
  baseSlug: string,
  search: string,
  originView?: Pick<ViewVO, "slug"> | null,
): string {
  const params = new URLSearchParams(search);
  params.delete("originViewId");
  const query = params.toString();
  return `/base/${baseSlug}${originView ? `/${originView.slug}` : ""}${query ? `?${query}` : ""}`;
}
