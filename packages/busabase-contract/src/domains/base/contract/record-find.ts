import type { BaseFieldVO, FieldType } from "../../../types";

/** Fields searched together by the table's "Common fields" option. */
export const COMMON_RECORD_FIND_FIELD_TYPES: ReadonlySet<FieldType> = new Set([
  "text",
  "longtext",
  "markdown",
  "html",
  "number",
  "email",
  "url",
  "embed",
  "phone",
  "select",
  "multiselect",
  "ai_summary",
  "ai_tags",
  "auto_number",
]);

const EXPLICIT_RECORD_FIND_FIELD_TYPES: ReadonlySet<FieldType> = new Set([
  "code",
  "json",
  "yaml",
  "attachment",
  "relation",
]);
const FILTER_FIELD_TYPES: ReadonlySet<FieldType> = new Set([
  "checkbox",
  "date",
  "created_time",
  "updated_time",
]);
const DYNAMIC_FIELD_TYPES: ReadonlySet<FieldType> = new Set(["formula", "lookup"]);

export interface RecordFindFieldSupport {
  supported: boolean;
  default: boolean;
  reason?: "filter" | "dynamic" | "reverse" | "unsupported";
}

/** Client-safe capability metadata; relation title/ACL checks stay on the server. */
export const getRecordFindFieldSupport = (
  field: Pick<BaseFieldVO, "type" | "options">,
): RecordFindFieldSupport => {
  if (COMMON_RECORD_FIND_FIELD_TYPES.has(field.type)) {
    return { supported: true, default: true };
  }
  if (field.type === "relation" && field.options.reverseOfFieldId) {
    return { supported: false, default: false, reason: "reverse" };
  }
  if (EXPLICIT_RECORD_FIND_FIELD_TYPES.has(field.type)) {
    return { supported: true, default: false };
  }
  return {
    supported: false,
    default: false,
    reason: FILTER_FIELD_TYPES.has(field.type)
      ? "filter"
      : DYNAMIC_FIELD_TYPES.has(field.type)
        ? "dynamic"
        : "unsupported",
  };
};
