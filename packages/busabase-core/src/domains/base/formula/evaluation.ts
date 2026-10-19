import type { FieldType } from "busabase-contract/types";
import type { FieldDef } from "../field-types";
import {
  FormulaCycleError,
  FormulaError,
  FormulaEvalError,
  FormulaUnknownFieldError,
} from "./errors";
import type { FormulaValue } from "./functions/value";
import { evaluateFormula, serializeFormulaResult } from "./index";
import type { FormulaRecordContext } from "./interpreter";

export const coerceForFormula = (rawValue: unknown, type: FieldType): FormulaValue => {
  if (rawValue === undefined || rawValue === null) return null;
  if (type === "number") {
    const number = typeof rawValue === "number" ? rawValue : Number(rawValue);
    return Number.isFinite(number) ? number : null;
  }
  if (type === "checkbox") return Boolean(rawValue);
  if (type === "date" || type === "created_time" || type === "updated_time") {
    const date = new Date(rawValue as string | number);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  if (type === "relation" || type === "multiselect") {
    return Array.isArray(rawValue) ? (rawValue as FormulaValue[]) : null;
  }
  if (
    typeof rawValue === "string" ||
    typeof rawValue === "number" ||
    typeof rawValue === "boolean"
  ) {
    return rawValue;
  }
  return null;
};

export interface FormulaFieldEvaluationArgs {
  expression: string;
  slug: string;
  fields: ReadonlyArray<FieldDef>;
  values: Record<string, unknown>;
  recordId?: string | null;
  createdAtIso?: string | null;
  updatedAtIso?: string | null;
}

/** Shared by stored computation and editor preview; never uses stale formula dependencies. */
export function evaluateFormulaField(args: FormulaFieldEvaluationArgs): FormulaValue {
  const fields = new Map(args.fields.map((field) => [field.slug, field]));
  const cache = new Map<string, FormulaValue>();
  const visiting: string[] = [args.slug];
  const context: FormulaRecordContext = {
    recordId: args.recordId ?? null,
    createdAtIso: args.createdAtIso ?? null,
    lastModifiedIso: args.updatedAtIso ?? null,
  };
  const assertValidResult = (value: FormulaValue): void => {
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new FormulaEvalError("Formula result is not a finite number");
    }
    if (value instanceof Date && Number.isNaN(value.getTime())) {
      throw new FormulaEvalError("Formula result is not a valid date");
    }
    if (Array.isArray(value)) value.forEach(assertValidResult);
  };
  const resolve = (slug: string): FormulaValue => {
    const field = fields.get(slug);
    if (!field) throw new FormulaUnknownFieldError(slug);
    if (field.type !== "formula") return coerceForFormula(args.values[slug], field.type);
    if (cache.has(slug)) return cache.get(slug) ?? null;
    if (visiting.includes(slug)) throw new FormulaCycleError([...visiting, slug]);
    if (visiting.length >= 128) {
      throw new FormulaEvalError("Formula dependencies exceed the 128-level calculation limit");
    }
    const expression = field.options?.formula?.expression;
    if (!expression)
      throw new FormulaError(`Formula field requires options.formula.expression: ${slug}`);
    visiting.push(slug);
    try {
      const result = evaluateFormula(expression, resolve, context);
      assertValidResult(result);
      cache.set(slug, result);
      return result;
    } finally {
      visiting.pop();
    }
  };
  const result = evaluateFormula(args.expression, resolve, context);
  assertValidResult(result);
  return serializeFormulaResult(result);
}
