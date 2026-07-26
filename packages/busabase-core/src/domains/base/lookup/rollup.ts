// Pure rollup aggregation for `lookup` fields — no DB, no React, isomorphic.
// The DB-touching half (following the relation, loading the linked records'
// values) lives in ../logic/lookup-values.ts; this module only answers
// "given these N values pulled across the relation, what is the cell value?".
import type { FieldType, LookupRollup } from "busabase-contract/types";

export const LOOKUP_ROLLUPS: readonly LookupRollup[] = [
  "values",
  "count",
  "sum",
  "average",
  "min",
  "max",
  "concatenate",
] as const;

/** Rollups that reduce to a single number regardless of the target field's type. */
const NUMERIC_ROLLUPS = new Set<LookupRollup>(["count", "sum", "average", "min", "max"]);

/** Rollups that require the target field to hold numbers (`count` works on anything). */
const REQUIRES_NUMERIC_TARGET = new Set<LookupRollup>(["sum", "average", "min", "max"]);

/**
 * Field types whose values are statically known to be numbers. `formula` is not
 * in this set but is still accepted by `isRollupCompatible` — its result type
 * isn't knowable at field-create time, so a numeric rollup over it is allowed
 * and simply produces null if the value turns out non-numeric.
 */
const NUMERIC_FIELD_TYPES = new Set<FieldType>(["number", "auto_number"]);

/** Can `rollup` be applied to a lookup whose target field is `targetType`? */
export const isRollupCompatible = (rollup: LookupRollup, targetType: FieldType): boolean => {
  if (!REQUIRES_NUMERIC_TARGET.has(rollup)) return true;
  // `formula` passes: its runtime value may or may not be numeric, and a
  // non-numeric one simply rolls up to null rather than erroring.
  return NUMERIC_FIELD_TYPES.has(targetType) || targetType === "formula";
};

const toNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

/**
 * Flatten one linked record's raw value into scalars. A `multiselect`/`relation`
 * target holds an array, so looking it up across N records yields a list of
 * lists — flatten one level so rollups see a flat scalar list, matching how
 * Vika's `getFlatCellValue` behaves.
 */
const flattenValue = (value: unknown): unknown[] => {
  if (value === undefined || value === null) return [];
  return Array.isArray(value)
    ? value.filter((item) => item !== undefined && item !== null)
    : [value];
};

const stringify = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  return JSON.stringify(value) ?? "";
};

/**
 * Apply `rollup` to the values pulled across a relation.
 *
 * `rawValues` is one entry per linked record (already limited by
 * `options.lookup.limit`), in link order. Returns a JSON-serializable cell value:
 * an array for `values`, a number for the numeric rollups, a string for
 * `concatenate`. Empty input rolls up to `0` for `count` and `null` otherwise —
 * SUM over nothing is "unknown", not zero.
 */
export const applyRollup = (rawValues: readonly unknown[], rollup: LookupRollup): unknown => {
  const flat = rawValues.flatMap(flattenValue);

  if (rollup === "values") return flat;
  if (rollup === "count") return flat.length;
  if (rollup === "concatenate") return flat.map(stringify).join(", ");

  const numbers = flat.map(toNumber).filter((n): n is number => n !== null);
  if (numbers.length === 0) return null;
  if (rollup === "sum") return numbers.reduce((total, n) => total + n, 0);
  if (rollup === "average") return numbers.reduce((total, n) => total + n, 0) / numbers.length;
  if (rollup === "min") return Math.min(...numbers);
  return Math.max(...numbers);
};

/**
 * The effective value type of a lookup cell — drives display formatting
 * (a `sum` over a currency column should still render as currency).
 */
export const lookupValueKind = (rollup: LookupRollup): "array" | "number" | "string" =>
  rollup === "values" ? "array" : NUMERIC_ROLLUPS.has(rollup) ? "number" : "string";

/**
 * Whether the rollup result is still denominated in the TARGET field's unit, and
 * should therefore inherit its display formatting (currency, locale).
 *
 * True for `values`/`sum`/`average`/`min`/`max` — summing dollars gives dollars.
 * False for `count` (a row tally, not money — rendering "3" as "$3.00" would be
 * actively wrong) and `concatenate` (already a string).
 */
export const rollupPreservesTargetUnit = (rollup: LookupRollup): boolean =>
  rollup !== "count" && rollup !== "concatenate";
