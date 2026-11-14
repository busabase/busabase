import type { ViewVO } from "busabase-contract/types";
import { RECORD_PREVIEW_PARAM } from "./record-preview-url";

/** Keep the creating view with schema editing without leaking a previous Base's view. */
export function fieldDesignHref(baseSlug: string, search: string, originViewId?: string): string {
  const params = new URLSearchParams(search);
  params.delete("originViewId");
  params.delete("highlightField");
  params.delete(RECORD_PREVIEW_PARAM);
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
  params.delete(RECORD_PREVIEW_PARAM);
  const query = params.toString();
  return `/base/${baseSlug}${originView ? `/${originView.slug}` : ""}${query ? `?${query}` : ""}`;
}
