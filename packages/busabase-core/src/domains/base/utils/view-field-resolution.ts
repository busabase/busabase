import type { BaseFieldVO, BaseVO } from "busabase-contract/types";

/**
 * Resolve which attachment field supplies the cover image. Honors the view's
 * explicit `coverFieldSlug`; otherwise falls back to the first attachment field
 * on the base (the sensible default every gallery tool uses so a fresh gallery
 * shows images without any configuration).
 */
export const resolveCoverField = (
  base: BaseVO | null,
  fields: BaseFieldVO[],
  coverFieldSlug: string | null | undefined,
): BaseFieldVO | null => {
  const attachmentFields = (base?.fields ?? fields).filter((f) => f.type === "attachment");
  if (coverFieldSlug === null) {
    // Explicitly "no cover".
    return null;
  }
  if (coverFieldSlug) {
    return attachmentFields.find((f) => f.slug === coverFieldSlug) ?? null;
  }
  return attachmentFields[0] ?? null;
};

/**
 * Resolve which date field positions records on the grid. Honors the view's
 * `dateFieldSlug`; otherwise falls back to the first date field on the base.
 */
export const resolveDateField = (
  base: BaseVO | null,
  fields: BaseFieldVO[],
  dateFieldSlug: string | null | undefined,
): BaseFieldVO | null => {
  const dateFields = (base?.fields ?? fields).filter(
    (f) => f.type === "date" || f.type === "created_time" || f.type === "updated_time",
  );
  if (dateFieldSlug) {
    return dateFields.find((f) => f.slug === dateFieldSlug) ?? null;
  }
  return dateFields[0] ?? null;
};
