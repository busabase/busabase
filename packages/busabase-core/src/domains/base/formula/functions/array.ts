// Array functions — consume `relation`/`multiselect` field values, which
// ../../field-types.ts's `coerceForFormula` passes through as string arrays
// (previously coerced to `null`; see SPEC.md's array-coercion note).
import { arity, asArray, asString, type FormulaFn, type FormulaValue, isBlank } from "./value";

export const ARRAY_FUNCTIONS: Record<string, FormulaFn> = {
  ARRAYJOIN: (args) => {
    arity("ARRAYJOIN", args, 1, 2);
    const separator = args.length > 1 ? asString(args[1]) : ", ";
    return asArray(args[0], "ARRAYJOIN").map(asString).join(separator);
  },
  ARRAYUNIQUE: (args) => {
    arity("ARRAYUNIQUE", args, 1);
    const seen = new Set<string>();
    const out: FormulaValue[] = [];
    for (const item of asArray(args[0], "ARRAYUNIQUE")) {
      const key = asString(item);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(item);
      }
    }
    return out;
  },
  ARRAYCOMPACT: (args) => {
    arity("ARRAYCOMPACT", args, 1);
    return asArray(args[0], "ARRAYCOMPACT").filter((item) => !isBlank(item));
  },
  ARRAYFLATTEN: (args) => {
    arity("ARRAYFLATTEN", args, 1, Number.POSITIVE_INFINITY);
    const out: FormulaValue[] = [];
    const flatten = (value: FormulaValue) => {
      if (Array.isArray(value)) {
        for (const item of value) flatten(item);
      } else {
        out.push(value);
      }
    };
    for (const arg of args) flatten(arg);
    return out;
  },
};
