import type { BaseFieldVO } from "busabase-contract/types";
import { buildFieldGraph } from "../formula/dependency";
import { evaluateFormulaField } from "../formula/evaluation";
import type { LookupResolution } from "./lookup-values";

/** Lookup values and every formula which transitively reads them are read-time values. */
export const lookupDependentFieldSlugs = (fields: ReadonlyArray<BaseFieldVO>): Set<string> => {
  const graph = buildFieldGraph(fields);
  const pending = fields.filter((field) => field.type === "lookup").map((field) => field.slug);
  const affected = new Set(pending);
  for (let index = 0; index < pending.length; index++) {
    const source = pending[index];
    if (!source) continue;
    for (const dependent of graph.neighbors(source)) {
      if (affected.has(dependent)) continue;
      affected.add(dependent);
      pending.push(dependent);
    }
  }
  return affected;
};

/** Never persist an ACL-dependent result, or manufacture a source record edit. */
export const applyLookupFormulas = (
  fields: ReadonlyArray<BaseFieldVO>,
  payload: Record<string, unknown>,
  lookups: LookupResolution,
  record: { id: string; createdAt: Date; updatedAt: Date },
): Record<string, unknown> => {
  const values = { ...payload, ...lookups.values };
  const dynamic = lookupDependentFieldSlugs(fields);
  const graph = buildFieldGraph(fields);
  const unavailable = new Set(
    Object.entries(lookups.computedFields)
      .filter(([, computed]) => computed.status === "invalid" || computed.status === "inaccessible")
      .map(([slug]) => slug),
  );
  // Mark the whole dependent chain before evaluation: null arithmetic must not
  // turn an inaccessible total into a confidently wrong remaining budget.
  const markUnavailable = (slug: string) => {
    const pending = [slug];
    for (let index = 0; index < pending.length; index++) {
      const source = pending[index];
      if (!source) continue;
      for (const dependent of graph.neighbors(source)) {
        if (unavailable.has(dependent)) continue;
        unavailable.add(dependent);
        pending.push(dependent);
      }
    }
  };
  for (const slug of unavailable) markUnavailable(slug);
  const bySlug = new Map(fields.map((field) => [field.slug, field]));
  const order = graph.topologicalSort();
  for (const slug of order ?? dynamic) {
    const field = bySlug.get(slug);
    if (!field || field.type !== "formula" || !dynamic.has(slug)) continue;
    const expression = field.options.formula?.expression;
    if (!order || unavailable.has(slug) || !expression) {
      values[slug] = null;
      continue;
    }
    try {
      values[slug] = evaluateFormulaField({
        expression,
        slug,
        fields,
        values,
        recordId: record.id,
        createdAtIso: record.createdAt.toISOString(),
        updatedAtIso: record.updatedAt.toISOString(),
      });
    } catch {
      values[slug] = null;
      markUnavailable(slug);
    }
  }
  return values;
};
