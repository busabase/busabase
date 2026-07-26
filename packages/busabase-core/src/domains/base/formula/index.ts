// Busabase's Formula field engine: lexer → parser → AST → tree-walking
// interpreter, the same layering bika/vikadata's formula_parser uses (see
// SPEC.md for the full parity plan and what's ported vs. deliberately
// deferred). Chained formulas (a formula referencing another formula field)
// ARE supported: `dependency.ts` ports a generic directed-graph + Kahn's
// topological sort (bika's `FieldDirectedGraph`) for cycle detection and
// dependency-first recompute ordering — see field-ops.ts (validation) and
// domains/base/logic/merge/record.ts (compute ordering) for where it's used.
import { collectFieldRefs } from "./ast";
import { FormulaSelfRefError, FormulaUnknownFieldError } from "./errors";
import type { FormulaValue } from "./functions";
import { evaluateAst, type FieldResolver, type FormulaRecordContext } from "./interpreter";
import { parseFormula } from "./parser";

export type { AstNode } from "./ast";
export {
  buildFieldGraph,
  detectFieldCycle,
  type FormulaFieldLike,
  topologicalFieldOrder,
} from "./dependency";
export * from "./errors";
export type { FormulaValue } from "./functions";
export type { FieldResolver, FormulaRecordContext } from "./interpreter";
export { parseFormula } from "./parser";

/** Parse + evaluate `expression` against `resolveField`. Throws FormulaError subclasses. */
export function evaluateFormula(
  expression: string,
  resolveField: FieldResolver,
  recordContext?: FormulaRecordContext,
): FormulaValue {
  return evaluateAst(parseFormula(expression), resolveField, recordContext);
}

/**
 * A formula's result can be a `Date` (e.g. DATEADD/TODAY/DATETIME_PARSE) or
 * an array containing dates — neither survives a jsonb storage round-trip
 * as a usable value (a bare `Date` serializes to `{}` through some storage
 * paths, not its ISO string), so recursively convert to ISO strings before
 * a formula's result is stored — same convention the `date` field type
 * already uses for its own values. Two callers need this: `field-types.ts`'s
 * `computeFormula` (the real write path) AND any demo/seed scenario that
 * pre-bakes formula values with `evaluateFormula` directly (the seed path
 * bypasses `computeFormula` entirely — see SPEC.md), so it's exported here
 * rather than kept private to one caller.
 */
export function serializeFormulaResult(value: FormulaValue): FormulaValue {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(serializeFormulaResult);
  return value;
}

/**
 * Structural validation for a formula field's own `expression` (run when the
 * field is created/edited, not per-record): every `{slug}` it references must
 * exist on the base and must not be the formula field itself. Referencing
 * ANOTHER formula field is allowed (chaining) — whole-graph cycle detection
 * across the base's fields is a SEPARATE check (see `detectFieldCycle`),
 * because a single expression can't see whether IT introduces a cycle
 * spanning other formulas; only the full graph can.
 */
export function validateFormulaExpression(
  expression: string,
  ownSlug: string,
  siblingTypeBySlug: ReadonlyMap<string, string>,
): void {
  const refs = collectFieldRefs(parseFormula(expression));
  for (const slug of refs) {
    if (slug === ownSlug) {
      throw new FormulaSelfRefError(slug);
    }
    if (!siblingTypeBySlug.has(slug)) {
      throw new FormulaUnknownFieldError(slug);
    }
  }
}
