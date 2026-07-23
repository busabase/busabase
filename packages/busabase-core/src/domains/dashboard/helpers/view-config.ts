import {
  type BaseFieldVO,
  VIEW_FIELD_MAX_WIDTH,
  VIEW_FIELD_MIN_WIDTH,
  type ViewConfigVO,
  type ViewFilterOperator,
  type ViewFilterVO,
  type ViewSortVO,
} from "busabase-contract/types";

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
  const firstIndex = config.filters.findIndex((filter) => matchesViewField(filter, field));
  if (firstIndex === -1) {
    return { ...config, filters: [...config.filters, nextFilter] };
  }
  return {
    ...config,
    filters: config.filters.map((filter, index) => (index === firstIndex ? nextFilter : filter)),
  };
};

export const clearFirstViewFilter = (
  config: ViewConfigVO,
  field: Pick<BaseFieldVO, "id" | "slug">,
): ViewConfigVO => {
  const firstIndex = config.filters.findIndex((filter) => matchesViewField(filter, field));
  return firstIndex === -1
    ? config
    : {
        ...config,
        filters: config.filters.filter((_, index) => index !== firstIndex),
      };
};

export const getVisibleViewFieldSlugs = (
  config: ViewConfigVO,
  fields: Pick<BaseFieldVO, "slug">[],
): string[] => {
  if (!Array.isArray(config.visibleFieldSlugs)) {
    return fields.map((field) => field.slug);
  }
  const known = new Set(fields.map((field) => field.slug));
  return [...new Set(config.visibleFieldSlugs)].filter((slug) => known.has(slug));
};

export const hideViewField = (
  config: ViewConfigVO,
  field: Pick<BaseFieldVO, "slug">,
  fields: Pick<BaseFieldVO, "slug">[],
): ViewConfigVO => ({
  ...config,
  visibleFieldSlugs: getVisibleViewFieldSlugs(config, fields).filter((slug) => slug !== field.slug),
});

export const showViewField = (
  config: ViewConfigVO,
  field: Pick<BaseFieldVO, "slug">,
  fields: Pick<BaseFieldVO, "slug">[],
): ViewConfigVO => {
  const visible = getVisibleViewFieldSlugs(config, fields);
  return visible.includes(field.slug)
    ? config
    : { ...config, visibleFieldSlugs: [...visible, field.slug] };
};

export const showAllViewFields = (
  config: ViewConfigVO,
  fields: Pick<BaseFieldVO, "slug">[],
): ViewConfigVO => {
  const visible = getVisibleViewFieldSlugs(config, fields);
  const visibleSet = new Set(visible);
  const hidden = fields.map((field) => field.slug).filter((slug) => !visibleSet.has(slug));
  return hidden.length === 0 ? config : { ...config, visibleFieldSlugs: [...visible, ...hidden] };
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
): ViewConfigVO => ({
  ...config,
  filters: [...config.filters, { fieldId: field.id, fieldSlug: field.slug, operator }],
});

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
  return {
    ...config,
    fieldWidths: Object.keys(fieldWidths).length > 0 ? fieldWidths : undefined,
  };
};

export const resetAllViewFieldWidths = (config: ViewConfigVO): ViewConfigVO =>
  config.fieldWidths === undefined ? config : { ...config, fieldWidths: undefined };

export const moveViewField = (
  config: ViewConfigVO,
  fields: Pick<BaseFieldVO, "slug">[],
  sourceSlug: string,
  targetSlug: string,
  placement: "before" | "after",
): ViewConfigVO => {
  const current = getVisibleViewFieldSlugs(config, fields);
  if (sourceSlug === targetSlug || !current.includes(sourceSlug) || !current.includes(targetSlug)) {
    return config;
  }
  const withoutSource = current.filter((slug) => slug !== sourceSlug);
  const targetIndex = withoutSource.indexOf(targetSlug);
  withoutSource.splice(targetIndex + (placement === "after" ? 1 : 0), 0, sourceSlug);
  return { ...config, visibleFieldSlugs: withoutSource };
};
