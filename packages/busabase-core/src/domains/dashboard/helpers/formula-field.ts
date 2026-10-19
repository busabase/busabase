import type { BaseFieldVO } from "busabase-contract/types";
import { collectFieldRefs } from "../../base/formula/ast";
import { parseFormula } from "../../base/formula/parser";

export interface FormulaFieldOptions {
  expression: string;
  format?: "auto" | "number" | "currency" | "percent" | "date";
  precision?: number;
  currency?: string;
}

/** Downstream fields, including transitive dependencies, in display order. */
export function formulaDependentFields(fields: BaseFieldVO[], slug: string): BaseFieldVO[] {
  const impacted = new Set([slug]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const field of fields) {
      if (field.type !== "formula" || impacted.has(field.slug)) continue;
      try {
        const refs = collectFieldRefs(parseFormula(field.options.formula?.expression ?? ""));
        if ([...refs].some((ref) => impacted.has(ref))) {
          impacted.add(field.slug);
          changed = true;
        }
      } catch {
        // A legacy invalid formula must not break the settings dialog.
      }
    }
  }
  return fields.filter((field) => field.slug !== slug && impacted.has(field.slug));
}

export function formulaFieldDraftKey(scope: string, baseId: string): string {
  return `busabase:formula-draft:v1:${encodeURIComponent(scope)}:${encodeURIComponent(baseId)}`;
}

export interface FormulaFieldDraft {
  operation: "add" | "edit";
  fieldId?: string;
  originalExpression?: string;
  name: BaseFieldVO["name"];
  slug: string;
  formula: FormulaFieldOptions;
}

export function readFormulaFieldDraft(key: string): FormulaFieldDraft | null {
  try {
    const data: unknown = JSON.parse(sessionStorage.getItem(key) ?? "null");
    if (!data || typeof data !== "object") return null;
    const draft = data as FormulaFieldDraft;
    if (
      (draft.operation !== "add" && draft.operation !== "edit") ||
      typeof draft.slug !== "string" ||
      !draft.formula ||
      typeof draft.formula.expression !== "string" ||
      (typeof draft.name !== "string" &&
        (typeof draft.name !== "object" ||
          !draft.name ||
          Array.isArray(draft.name) ||
          Object.values(draft.name).some((item) => typeof item !== "string"))) ||
      (draft.operation === "edit" && typeof draft.fieldId !== "string")
    )
      return null;
    const { format, precision, currency } = draft.formula;
    if (format !== undefined && !["auto", "number", "currency", "percent", "date"].includes(format))
      return null;
    if (
      precision !== undefined &&
      (!Number.isInteger(precision) || precision < 0 || precision > 10)
    )
      return null;
    if (currency !== undefined && !/^[A-Z]{3}$/.test(currency)) return null;
    return draft;
  } catch {
    return null;
  }
}

export function writeFormulaFieldDraft(key: string, draft: FormulaFieldDraft | null): void {
  try {
    if (draft) sessionStorage.setItem(key, JSON.stringify(draft));
    else sessionStorage.removeItem(key);
  } catch {
    // Storage can be disabled by the host; editing and submission still work.
  }
}
