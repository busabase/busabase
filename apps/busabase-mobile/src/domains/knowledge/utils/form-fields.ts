import type { FormBoundFieldVO, FormFieldBindingVO } from "busabase-contract/types";
import { type DateFieldOptions, getDateFieldOptions } from "busabase-core/base/date-value";
import { fromDateFieldInputText } from "~/domains/base/utils/date-input";

export type FormControlKind =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "url"
  | "email"
  | "tel"
  | "checkbox"
  | "select"
  | "multiselect";

const TEXTAREA_TYPES = new Set<FormBoundFieldVO["type"]>(["longtext", "markdown", "html"]);

export function getFormControlKind(field?: FormBoundFieldVO): FormControlKind {
  if (!field) return "text";
  if (TEXTAREA_TYPES.has(field.type)) return "textarea";
  if (field.type === "checkbox") return "checkbox";
  if (field.type === "select") return "select";
  if (field.type === "multiselect") return "multiselect";
  if (field.type === "number") return "number";
  if (field.type === "date") return "date";
  if (field.type === "email") return "email";
  if (field.type === "phone") return "tel";
  if (field.type === "url" || field.type === "embed") return "url";
  return "text";
}

/**
 * A bound date field's `options.date`. Read defensively: older servers send
 * bound fields without `options`, which reads as a plain day field.
 */
export function getFormDateOptions(field?: FormBoundFieldVO): DateFieldOptions {
  return getDateFieldOptions((field as { options?: unknown } | undefined)?.options);
}

export function formStringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

export function isEmptyFormValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim() === "") ||
    (Array.isArray(value) && value.length === 0)
  );
}

export function hasMissingRequiredFormValue(
  bindings: FormFieldBindingVO[],
  values: Record<string, unknown>,
): boolean {
  return bindings.some(
    (binding) => binding.required && isEmptyFormValue(values[binding.inputName]),
  );
}

export function buildFormSubmissionValues(
  bindings: FormFieldBindingVO[],
  fieldsBySlug: ReadonlyMap<string, FormBoundFieldVO>,
  values: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    bindings.map((binding) => {
      const value = values[binding.inputName];
      const field = fieldsBySlug.get(binding.fieldSlug);
      const kind = getFormControlKind(field);
      if (kind === "date" && typeof value === "string") {
        return [binding.inputName, fromDateFieldInputText(value, getFormDateOptions(field))];
      }
      if (kind === "number") {
        const numberValue =
          typeof value === "string" && value.trim() !== "" ? Number(value) : value;
        return [
          binding.inputName,
          typeof numberValue === "number" && Number.isFinite(numberValue)
            ? numberValue
            : (value ?? ""),
        ];
      }
      return [binding.inputName, value ?? ""];
    }),
  );
}
