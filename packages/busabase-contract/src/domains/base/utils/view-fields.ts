import type { BaseFieldVO, ViewConfigVO } from "../types";

type ViewFieldIdentity = Pick<BaseFieldVO, "position" | "slug">;

/** Legacy explicit lists remain curated until their owner enables automatic fields. */
export const getAutoShowNewFields = (config: ViewConfigVO): boolean =>
  config.autoShowNewFields ?? !Array.isArray(config.visibleFieldSlugs);

/** Shared by web and native clients so saved views select and order the same fields. */
export const getVisibleViewFieldSlugs = (
  config: ViewConfigVO,
  fields: readonly ViewFieldIdentity[],
): string[] => {
  // Match the record-title rule: the lowest-position active field is primary.
  const primarySlug = fields.reduce<ViewFieldIdentity | undefined>(
    (primary, field) => (!primary || field.position < primary.position ? field : primary),
    undefined,
  )?.slug;
  const hidden = new Set(config.hiddenFieldSlugs ?? []);
  const visible = new Set(
    getAutoShowNewFields(config)
      ? fields.filter((field) => !hidden.has(field.slug)).map((field) => field.slug)
      : (config.visibleFieldSlugs ?? fields.map((field) => field.slug)),
  );
  const known = new Set(fields.map((field) => field.slug));
  const order = [
    ...(config.fieldOrderSlugs ?? config.visibleFieldSlugs ?? []),
    ...fields.map((field) => field.slug),
  ];
  const ordered = [...new Set(order)].filter(
    (slug) => known.has(slug) && visible.has(slug) && slug !== primarySlug,
  );
  return primarySlug ? [primarySlug, ...ordered] : ordered;
};
