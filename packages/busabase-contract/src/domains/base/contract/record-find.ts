import type { BaseFieldVO, FieldType, ViewConfigVO } from "../../../types";
import { getVisibleViewFieldSlugs } from "../utils/view-fields";

/**
 * Field types eligible for the default find scope: a find without a chosen
 * field searches every field of these types that the saved View shows (see
 * `getDefaultRecordFindFields`). Other supported types must be chosen.
 */
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

/**
 * The default find scope, shared by the server and the web table so the rows a
 * find keeps and the cells it marks agree: eligible field types shown in the
 * saved View, in Base order. Without a View (a view-less Base shows every
 * field), every eligible field is searched. Hidden fields are only searched
 * when the person chooses one explicitly.
 */
export const getDefaultRecordFindFields = <
  Field extends Pick<BaseFieldVO, "position" | "slug" | "type">,
>(
  fields: readonly Field[],
  viewConfig?: ViewConfigVO | null,
): Field[] => {
  const visible = viewConfig ? new Set(getVisibleViewFieldSlugs(viewConfig, fields)) : null;
  return fields.filter(
    (field) =>
      COMMON_RECORD_FIND_FIELD_TYPES.has(field.type) && (!visible || visible.has(field.slug)),
  );
};
