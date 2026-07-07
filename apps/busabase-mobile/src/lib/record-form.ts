import type { AssetAttachmentRef, BaseFieldVO, FieldType } from "busabase-contract/types";
import { getAttachmentRefs } from "./attachment";
import { stringifyFieldValue } from "./busabase-display";

/** Field types the mobile form renders an editable control for. */
const EDITABLE_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  "text",
  "longtext",
  "markdown",
  "html",
  "number",
  "date",
  "checkbox",
  "select",
  "multiselect",
  "url",
  "email",
  "phone",
  "attachment",
]);

/** System / computed field types the form shows read-only (server fills them). */
export function isEditableField(field: BaseFieldVO): boolean {
  return EDITABLE_TYPES.has(field.type);
}

export type RecordFormValue = string | boolean | string[] | AssetAttachmentRef[];

export function initialFieldValue(field: BaseFieldVO, value?: unknown): RecordFormValue {
  if (field.type === "checkbox") {
    return value === true || value === "true";
  }
  if (field.type === "multiselect") {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  }
  if (field.type === "attachment") {
    return getAttachmentRefs(value);
  }
  return stringifyFieldValue(value);
}

export function buildInitialFormValues(
  fields: BaseFieldVO[],
  source: Record<string, unknown> = {},
): Record<string, RecordFormValue> {
  return Object.fromEntries(
    fields
      .filter(isEditableField)
      .map((field) => [field.slug, initialFieldValue(field, source[field.slug])]),
  );
}

/** Convert form state into the field payload the change request API expects. */
export function normalizeFormValues(
  fields: BaseFieldVO[],
  values: Record<string, RecordFormValue>,
): Record<string, unknown> {
  return Object.fromEntries(
    fields.filter(isEditableField).map((field) => {
      const value = values[field.slug];
      if (field.type === "number") {
        const numberValue = typeof value === "string" ? Number(value) : Number.NaN;
        return [
          field.slug,
          value === "" ? null : Number.isFinite(numberValue) ? numberValue : null,
        ];
      }
      if (field.type === "checkbox") {
        return [field.slug, value === true];
      }
      if (field.type === "multiselect") {
        return [field.slug, Array.isArray(value) ? value : []];
      }
      if (field.type === "attachment") {
        return [field.slug, Array.isArray(value) ? value : []];
      }
      return [field.slug, typeof value === "string" ? value : ""];
    }),
  );
}

export function recordFormValuesEqual(
  fields: BaseFieldVO[],
  left: Record<string, RecordFormValue>,
  right: Record<string, RecordFormValue>,
) {
  return (
    JSON.stringify(normalizeFormValues(fields, left)) ===
    JSON.stringify(normalizeFormValues(fields, right))
  );
}
