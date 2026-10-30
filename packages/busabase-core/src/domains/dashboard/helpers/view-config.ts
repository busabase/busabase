import {
  type BaseFieldVO,
  flattenViewFilters,
  getAutoShowNewFields,
  getVisibleViewFieldSlugs,
  isViewFilterGroup,
  VIEW_FIELD_MAX_WIDTH,
  VIEW_FIELD_MIN_WIDTH,
  type ViewConfigVO,
  type ViewFilterConditionVO,
  type ViewFilterOperator,
  type ViewFilterVO,
  type ViewSortVO,
} from "busabase-contract/types";
import { getPrimaryField } from "../../base/utils/primary-field";

type ViewFieldIdentity = Pick<BaseFieldVO, "position" | "slug">;

export { getAutoShowNewFields, getVisibleViewFieldSlugs } from "busabase-contract/types";

export const matchesViewField = (
  item: { fieldId?: string; fieldSlug: string },
  field: Pick<BaseFieldVO, "id" | "slug">,
) => (item.fieldId ? item.fieldId === field.id : item.fieldSlug === field.slug);

export const setPrimaryViewSort = (
  config: ViewConfigVO,
  field: Pick<BaseFieldVO, "id" | "slug">,
  direction: ViewSortVO["direction"],
): ViewConfigVO => ({
  ...config,
  sorts: [
    { direction, fieldId: field.id, fieldSlug: field.slug },
    ...config.sorts.filter((sort) => !matchesViewField(sort, field)),
  ],
});

export const clearViewSort = (
  config: ViewConfigVO,
  field: Pick<BaseFieldVO, "id" | "slug">,
): ViewConfigVO => ({
  ...config,
  sorts: config.sorts.filter((sort) => !matchesViewField(sort, field)),
});

export const replaceFirstViewFilter = (
  config: ViewConfigVO,
  field: Pick<BaseFieldVO, "id" | "slug">,
  nextFilter: ViewFilterVO,
): ViewConfigVO => {
  let replaced = false;
  const replace = (conditions: ViewFilterConditionVO[]): ViewFilterConditionVO[] =>
    conditions.map((condition) => {
      if (isViewFilterGroup(condition))
        return { ...condition, conditions: replace(condition.conditions) };
      if (!replaced && matchesViewField(condition, field)) {
        replaced = true;
        return nextFilter;
      }
      return condition;
    });
  const filters = replace(config.filters);
  return { ...config, filters: replaced ? filters : [...filters, nextFilter] };
};

export const clearFirstViewFilter = (
  config: ViewConfigVO,
  field: Pick<BaseFieldVO, "id" | "slug">,
): ViewConfigVO => {
  let removed = false;
  const remove = (conditions: ViewFilterConditionVO[]): ViewFilterConditionVO[] =>
    conditions.flatMap<ViewFilterConditionVO>((condition) => {
      if (isViewFilterGroup(condition)) {
        const children = remove(condition.conditions);
        return children.length ? [{ ...condition, conditions: children }] : [];
      }
      if (!removed && matchesViewField(condition, field)) {
        removed = true;
        return [];
      }
      return [condition];
    });
  const filters = remove(config.filters);
  return removed ? { ...config, filters } : config;
};

export const getViewFilterCount = (config: ViewConfigVO): number =>
  flattenViewFilters(config.filters).length;

/** Immutable path update shared by nested UI controls. Empty groups are pruned. */
export const updateViewFilterPath = (
  config: ViewConfigVO,
  path: readonly number[],
  update: (condition: ViewFilterConditionVO) => ViewFilterConditionVO | null,
): ViewConfigVO => {
  const visit = (conditions: ViewFilterConditionVO[], depth: number): ViewFilterConditionVO[] =>
    conditions.flatMap<ViewFilterConditionVO>((condition, index) => {
      if (index !== path[depth]) return [condition];
      const next =
        depth === path.length - 1
          ? update(condition)
          : isViewFilterGroup(condition)
            ? { ...condition, conditions: visit(condition.conditions, depth + 1) }
            : condition;
      return next && (!isViewFilterGroup(next) || next.conditions.length) ? [next] : [];
    });
  return { ...config, filters: visit(config.filters, 0) };
};

const uniqueKnownFieldSlugs = (slugs: string[], fields: ViewFieldIdentity[]): string[] => {
  const known = new Set(fields.map((field) => field.slug));
  return [...new Set(slugs)].filter((slug) => known.has(slug));
};

const sameFieldSlugs = (left: string[] | null | undefined, right: string[]): boolean =>
  Array.isArray(left) &&
  left.length === right.length &&
  left.every((slug, index) => slug === right[index]);

export const canonicalizeViewFieldConfig = (
  config: ViewConfigVO,
  fields: ViewFieldIdentity[],
): ViewConfigVO => {
  // Never snapshot a live view merely because its order or widths were edited.
  let canonical = config;
  if (!getAutoShowNewFields(config) && Array.isArray(config.visibleFieldSlugs)) {
    const visibleFieldSlugs = getVisibleViewFieldSlugs(config, fields);
    if (!sameFieldSlugs(config.visibleFieldSlugs, visibleFieldSlugs)) {
      canonical = { ...canonical, visibleFieldSlugs };
    }
  }
  if (Array.isArray(config.fieldOrderSlugs)) {
    const primarySlug = getPrimaryField({ fields })?.slug;
    const ordered = uniqueKnownFieldSlugs(config.fieldOrderSlugs, fields).filter(
      (slug) => slug !== primarySlug,
    );
    const fieldOrderSlugs = primarySlug ? [primarySlug, ...ordered] : ordered;
    if (!sameFieldSlugs(config.fieldOrderSlugs, fieldOrderSlugs)) {
      canonical = { ...canonical, fieldOrderSlugs };
    }
  }
  if (Array.isArray(config.hiddenFieldSlugs)) {
    const primarySlug = getPrimaryField({ fields })?.slug;
    const hiddenFieldSlugs = uniqueKnownFieldSlugs(config.hiddenFieldSlugs, fields).filter(
      (slug) => slug !== primarySlug,
    );
    if (!sameFieldSlugs(config.hiddenFieldSlugs, hiddenFieldSlugs)) {
      canonical = { ...canonical, hiddenFieldSlugs };
    }
  }
  return canonical;
};

export const setAutoShowNewFields = (
  config: ViewConfigVO,
  fields: ViewFieldIdentity[],
  enabled: boolean,
): ViewConfigVO => {
  const canonical = canonicalizeViewFieldConfig(config, fields);
  const visibleFieldSlugs = getVisibleViewFieldSlugs(canonical, fields);
  const visible = new Set(visibleFieldSlugs);
  return {
    ...canonical,
    autoShowNewFields: enabled,
    // Turning automatic fields on affects future fields, not existing hidden ones.
    hiddenFieldSlugs: fields.map((field) => field.slug).filter((slug) => !visible.has(slug)),
    visibleFieldSlugs,
    fieldOrderSlugs: [
      ...visibleFieldSlugs,
      ...uniqueKnownFieldSlugs(canonical.fieldOrderSlugs ?? [], fields).filter(
        (slug) => !visible.has(slug),
      ),
    ],
  };
};

export const hideViewField = (
  config: ViewConfigVO,
  field: Pick<BaseFieldVO, "slug">,
  fields: ViewFieldIdentity[],
): ViewConfigVO => {
  const canonical = canonicalizeViewFieldConfig(config, fields);
  if (
    getPrimaryField({ fields })?.slug === field.slug ||
    !fields.some((item) => item.slug === field.slug)
  ) {
    return canonical;
  }
  if (getAutoShowNewFields(canonical)) {
    return {
      ...canonical,
      autoShowNewFields: true,
      hiddenFieldSlugs: [...new Set([...(canonical.hiddenFieldSlugs ?? []), field.slug])],
    };
  }
  return {
    ...canonical,
    visibleFieldSlugs: getVisibleViewFieldSlugs(canonical, fields).filter(
      (slug) => slug !== field.slug,
    ),
  };
};

export const showViewField = (
  config: ViewConfigVO,
  field: Pick<BaseFieldVO, "slug">,
  fields: ViewFieldIdentity[],
): ViewConfigVO => {
  const canonical = canonicalizeViewFieldConfig(config, fields);
  const visible = getVisibleViewFieldSlugs(canonical, fields);
  if (getAutoShowNewFields(canonical)) {
    return visible.includes(field.slug) || !fields.some((item) => item.slug === field.slug)
      ? canonical
      : {
          ...canonical,
          hiddenFieldSlugs: (canonical.hiddenFieldSlugs ?? []).filter(
            (slug) => slug !== field.slug,
          ),
        };
  }
  return visible.includes(field.slug) || !fields.some((item) => item.slug === field.slug)
    ? canonical
    : { ...canonical, visibleFieldSlugs: [...visible, field.slug] };
};

export const showAllViewFields = (
  config: ViewConfigVO,
  fields: ViewFieldIdentity[],
): ViewConfigVO => {
  const canonical = canonicalizeViewFieldConfig(config, fields);
  const visible = getVisibleViewFieldSlugs(canonical, fields);
  const visibleSet = new Set(visible);
  const hidden = fields.map((field) => field.slug).filter((slug) => !visibleSet.has(slug));
  if (getAutoShowNewFields(canonical)) {
    return hidden.length === 0 ? canonical : { ...canonical, hiddenFieldSlugs: [] };
  }
  return hidden.length === 0
    ? canonical
    : { ...canonical, visibleFieldSlugs: [...visible, ...hidden] };
};

export const clearAllViewFilters = (config: ViewConfigVO): ViewConfigVO =>
  config.filters.length === 0 ? config : { ...config, filters: [] };

export const clearAllViewSorts = (config: ViewConfigVO): ViewConfigVO =>
  config.sorts.length === 0 ? config : { ...config, sorts: [] };

export const clearViewFilterAt = (config: ViewConfigVO, index: number): ViewConfigVO =>
  index < 0 || index >= config.filters.length
    ? config
    : { ...config, filters: config.filters.filter((_, itemIndex) => itemIndex !== index) };

export const clearViewSortAt = (config: ViewConfigVO, index: number): ViewConfigVO =>
  index < 0 || index >= config.sorts.length
    ? config
    : { ...config, sorts: config.sorts.filter((_, itemIndex) => itemIndex !== index) };

export const addViewFilter = (
  config: ViewConfigVO,
  field: Pick<BaseFieldVO, "id" | "slug">,
  operator: ViewFilterOperator,
): ViewConfigVO =>
  flattenViewFilters(config.filters).length >= 100
    ? config
    : {
        ...config,
        filters: [...config.filters, { fieldId: field.id, fieldSlug: field.slug, operator }],
      };

export const updateViewFilterAt = (
  config: ViewConfigVO,
  index: number,
  filter: ViewFilterVO,
): ViewConfigVO =>
  index < 0 || index >= config.filters.length
    ? config
    : {
        ...config,
        filters: config.filters.map((current, itemIndex) =>
          itemIndex === index ? filter : current,
        ),
      };

export const addViewSort = (
  config: ViewConfigVO,
  field: Pick<BaseFieldVO, "id" | "slug">,
  direction: ViewSortVO["direction"] = "asc",
): ViewConfigVO => ({
  ...config,
  sorts: [...config.sorts, { direction, fieldId: field.id, fieldSlug: field.slug }],
});

export const updateViewSortAt = (
  config: ViewConfigVO,
  index: number,
  sort: ViewSortVO,
): ViewConfigVO =>
  index < 0 || index >= config.sorts.length
    ? config
    : {
        ...config,
        sorts: config.sorts.map((current, itemIndex) => (itemIndex === index ? sort : current)),
      };

export const moveViewSort = (
  config: ViewConfigVO,
  index: number,
  direction: "up" | "down",
): ViewConfigVO => {
  const targetIndex = index + (direction === "up" ? -1 : 1);
  if (
    index < 0 ||
    index >= config.sorts.length ||
    targetIndex < 0 ||
    targetIndex >= config.sorts.length
  ) {
    return config;
  }
  const sorts = [...config.sorts];
  [sorts[index], sorts[targetIndex]] = [sorts[targetIndex], sorts[index]];
  return { ...config, sorts };
};

export const clampViewFieldWidth = (width: number): number =>
  Math.min(VIEW_FIELD_MAX_WIDTH, Math.max(VIEW_FIELD_MIN_WIDTH, Math.round(width)));

export const setViewFieldWidth = (
  config: ViewConfigVO,
  fieldSlug: string,
  width: number,
): ViewConfigVO => ({
  ...config,
  fieldWidths: {
    ...config.fieldWidths,
    [fieldSlug]: clampViewFieldWidth(width),
  },
});

export const resetViewFieldWidth = (config: ViewConfigVO, fieldSlug: string): ViewConfigVO => {
  if (config.fieldWidths?.[fieldSlug] === undefined) {
    return config;
  }
  const fieldWidths = { ...config.fieldWidths };
  delete fieldWidths[fieldSlug];
  return { ...config, fieldWidths };
};

// Clear with `{}`, never `undefined`: view updates are patches, and an undefined key
// is dropped from the request, so the stored widths would survive the reset.
export const resetAllViewFieldWidths = (config: ViewConfigVO): ViewConfigVO =>
  config.fieldWidths === undefined ? config : { ...config, fieldWidths: {} };

export const moveViewField = (
  config: ViewConfigVO,
  fields: ViewFieldIdentity[],
  sourceSlug: string,
  targetSlug: string,
  placement: "before" | "after",
): ViewConfigVO => {
  const current = getVisibleViewFieldSlugs(config, fields);
  const primarySlug = getPrimaryField({ fields })?.slug;
  if (sourceSlug === targetSlug || !current.includes(sourceSlug) || !current.includes(targetSlug)) {
    return canonicalizeViewFieldConfig(config, fields);
  }
  if (sourceSlug === primarySlug || (targetSlug === primarySlug && placement === "before")) {
    return canonicalizeViewFieldConfig(config, fields);
  }
  const withoutSource = current.filter((slug) => slug !== sourceSlug);
  const targetIndex = withoutSource.indexOf(targetSlug);
  withoutSource.splice(targetIndex + (placement === "after" ? 1 : 0), 0, sourceSlug);
  const visibleSet = new Set(current);
  const hiddenOrder = uniqueKnownFieldSlugs(
    [...(config.fieldOrderSlugs ?? []), ...fields.map((field) => field.slug)],
    fields,
  ).filter((slug) => !visibleSet.has(slug));
  return { ...config, fieldOrderSlugs: [...withoutSource, ...hiddenOrder] };
};
