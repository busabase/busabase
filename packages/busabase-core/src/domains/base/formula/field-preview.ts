import { evaluateFormulaField, type FormulaFieldEvaluationArgs } from "./evaluation";
import { assertValidFormulaField } from "./validation";

export interface FormulaFieldPreview {
  value: unknown;
  error?: string;
}

export function previewFormulaField(args: FormulaFieldEvaluationArgs): FormulaFieldPreview {
  try {
    assertValidFormulaField(
      "formula",
      args.slug,
      { formula: { expression: args.expression } },
      args.fields,
    );
    return { value: evaluateFormulaField(args) };
  } catch (error) {
    return {
      value: null,
      error: error instanceof Error ? error.message : "Formula calculation failed",
    };
  }
}

export interface FormulaFormatOptions {
  format?: "auto" | "number" | "currency" | "percent" | "date";
  precision?: number;
  currency?: string;
}

/** Display formatting only: the stored value remains a primitive for filters, sort and APIs. */
export function formatFormulaValue(
  value: unknown,
  options?: FormulaFormatOptions,
  locale = "en",
): string {
  if (value === null || value === undefined) return "";
  const format = options?.format ?? "auto";
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    format !== "auto" &&
    format !== "date"
  ) {
    const precision = Math.min(10, Math.max(0, Math.trunc(options?.precision ?? 2)));
    try {
      return new Intl.NumberFormat(locale, {
        style: format === "number" ? "decimal" : format,
        ...(format === "currency" ? { currency: options?.currency ?? "USD" } : {}),
        minimumFractionDigits: precision,
        maximumFractionDigits: precision,
      }).format(value);
    } catch {
      return String(value);
    }
  }
  if (format === "date" && (typeof value === "string" || value instanceof Date)) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) {
      try {
        return new Intl.DateTimeFormat(locale, { timeZone: "UTC" }).format(date);
      } catch {
        return date.toISOString().slice(0, 10);
      }
    }
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value))
    return value.map((item) => formatFormulaValue(item, undefined, locale)).join(", ");
  return String(value);
}
