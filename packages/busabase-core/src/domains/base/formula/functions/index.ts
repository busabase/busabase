// Function registry, merged from per-category files (see SPEC.md's function
// catalog checklist for what's covered and what's deliberately deferred).
// RECORD_ID / CREATED_TIME / LAST_MODIFIED_TIME and ISERROR / IS_ERROR are
// NOT here — they're special-cased directly in ../interpreter.ts because
// they need something other than a plain evaluated-args array (record
// bookkeeping, and lazy/caught evaluation, respectively).
import { ARRAY_FUNCTIONS } from "./array";
import { DATE_TIME_FUNCTIONS } from "./date-time";
import { LOGICAL_FUNCTIONS } from "./logical";
import { NUMERIC_FUNCTIONS } from "./numeric";
import { TEXT_FUNCTIONS } from "./text";
import type { FormulaFn } from "./value";

export const FORMULA_FUNCTIONS: Record<string, FormulaFn> = {
  ...NUMERIC_FUNCTIONS,
  ...LOGICAL_FUNCTIONS,
  ...TEXT_FUNCTIONS,
  ...DATE_TIME_FUNCTIONS,
  ...ARRAY_FUNCTIONS,
};

export type { FormulaFn, FormulaValue } from "./value";
export { arity, asArray, asDate, asNumber, asString, isBlank, isTruthy } from "./value";
