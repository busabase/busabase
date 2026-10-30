import type { BaseFieldVO, BaseVO, ViewVO } from "busabase-contract/types";
import { flattenViewFilters } from "busabase-contract/types";
import type { iString } from "openlib/i18n/i-string";
import { collectFieldRefs } from "../../base/formula/ast";
import { parseFormula } from "../../base/formula/parser";

export type FieldDependency = {
  kind: "viewFilter" | "viewSort" | "viewDisplay" | "formula" | "lookup" | "relation";
  name: iString;
  base: BaseVO;
  view?: ViewVO;
};

/** Structured references available from the visible Base and saved-view APIs. */
export function getFieldDependencies(
  field: BaseFieldVO,
  bases: readonly BaseVO[],
  views: readonly ViewVO[],
): FieldDependency[] {
  const ownBase = bases.find((base) => base.id === field.baseId);
  if (!ownBase) return [];
  const dependencies: FieldDependency[] = [];
  const add = (kind: FieldDependency["kind"], name: iString, base: BaseVO, view?: ViewVO) => {
    dependencies.push({ kind, name, base, view });
  };
  const matchesViewField = (entry: { fieldId?: string; fieldSlug: string }) =>
    entry.fieldId ? entry.fieldId === field.id : entry.fieldSlug === field.slug;

  for (const view of views) {
    if (view.baseId !== field.baseId || view.status !== "active") continue;
    if (flattenViewFilters(view.config.filters).some(matchesViewField))
      add("viewFilter", view.name, ownBase, view);
    if (view.config.sorts.some(matchesViewField)) add("viewSort", view.name, ownBase, view);
    const config = view.config;
    if (
      config.visibleFieldSlugs?.includes(field.slug) ||
      config.fieldOrderSlugs?.includes(field.slug) ||
      config.hiddenFieldSlugs?.includes(field.slug) ||
      config.fieldWidths?.[field.slug] !== undefined ||
      [
        config.coverFieldSlug,
        config.stackByFieldSlug,
        config.dateFieldSlug,
        config.startFieldSlug,
        config.endFieldSlug,
      ].includes(field.slug)
    ) {
      add("viewDisplay", view.name, ownBase, view);
    }
  }

  for (const base of bases) {
    for (const candidate of base.fields) {
      if (candidate.id === field.id) continue;
      if (base.id === field.baseId && candidate.type === "formula") {
        const expression = candidate.options.formula?.expression;
        if (expression) {
          try {
            if (collectFieldRefs(parseFormula(expression)).includes(field.slug)) {
              add("formula", candidate.name, base);
            }
          } catch {
            // Invalid legacy expressions cannot be identified reliably.
          }
        }
      }
      if (candidate.type === "lookup") {
        const lookup = candidate.options.lookup;
        if (!lookup) continue;
        const sourceRelation = base.fields.find(
          (item) => item.type === "relation" && item.slug === lookup.relationFieldSlug,
        );
        const usesRelation = base.id === field.baseId && sourceRelation?.id === field.id;
        const usesTarget =
          sourceRelation?.options.targetBaseId === field.baseId &&
          lookup.targetFieldSlug === field.slug;
        if (usesRelation || usesTarget) add("lookup", candidate.name, base);
      }
      if (candidate.type === "relation" && candidate.options.inverseFieldId === field.id) {
        add("relation", candidate.name, base);
      }
    }
  }
  return dependencies;
}
