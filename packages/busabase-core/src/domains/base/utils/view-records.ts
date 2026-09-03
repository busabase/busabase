import type {
  BaseFieldVO,
  FieldType,
  RecordVO,
  ViewConfigVO,
  ViewFilterVO,
} from "busabase-contract/types";
import { resolveEmbedPreview } from "./embed";

const fieldValueToString = (value: unknown): string => {
  if (value === null || value === undefined) {
    return "";
  }
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
};

const stripHtmlTags = (value: string): string =>
  value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const formatNumberField = (
  value: unknown,
  options?: { format?: "plain" | "currency"; currency?: string; locale?: string },
): string => {
  if (value === null || value === undefined || value === "") {
    return "";
  }
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) {
    return fieldValueToString(value);
  }
  if (options?.format === "currency") {
    return new Intl.NumberFormat(options.locale, {
      style: "currency",
      currency: options.currency ?? "USD",
    }).format(number);
  }
  return fieldValueToString(value);
};

const choiceLabel = (field: BaseFieldVO, value: unknown): string => {
  const choiceId = typeof value === "string" ? value : "";
  return field.options.choices?.find((choice) => choice.id === choiceId)?.name ?? choiceId;
};

const KNOWN_ACTOR_LABELS: Record<string, string> = {
  "local-admin": "Local Admin",
  "local-editor": "Local Editor",
  "local-producer": "Local Producer",
  "local-user": "Local User",
  "local-viewer": "Local Viewer",
  agent: "Agent",
  producer: "Producer",
};

const titleCaseToken = (value: string): string =>
  value ? `${value.slice(0, 1).toUpperCase()}${value.slice(1).toLowerCase()}` : "";

const prettifyHumanIdentifier = (value: string): string | null => {
  if (!/[._-]/.test(value) || !/[a-z]/i.test(value)) {
    return null;
  }
  const parts = value
    .split(/[._-]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2 || parts.some((part) => part.length > 32)) {
    return null;
  }
  return parts.map(titleCaseToken).join(" ");
};

const formatOpaqueUserId = (actorId: unknown): string => {
  const id = typeof actorId === "string" ? actorId.trim() : "";
  if (!id) return "—";
  return KNOWN_ACTOR_LABELS[id] ?? prettifyHumanIdentifier(id) ?? `User ${id.slice(0, 10)}`;
};

const previewText = (value: unknown, type?: FieldType): string => {
  if (type === "checkbox") {
    return value === true || value === "true" ? "Yes" : "No";
  }
  if (type === "auto_number") {
    const text = fieldValueToString(value);
    return text ? `#${text}` : text;
  }
  if (type === "created_by" || type === "updated_by") {
    return formatOpaqueUserId(value);
  }
  if (type === "date" && typeof value === "string") {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
  }
  if (type === "multiselect" && Array.isArray(value)) {
    return value.join(", ");
  }
  if (type === "created_time" || type === "updated_time") {
    const date = typeof value === "string" || value instanceof Date ? new Date(value) : null;
    return date && !Number.isNaN(date.getTime())
      ? date.toLocaleString()
      : fieldValueToString(value);
  }
  const text = fieldValueToString(value);
  return type === "html" ? stripHtmlTags(text) : text;
};

/**
 * Text used by authoritative server-side view filters and sorts. It mirrors
 * the dashboard cell semantics for the field types whose display differs from
 * their stored value (notably select labels, multiselect and currency).
 */
export const getViewFieldPreviewText = (field: BaseFieldVO | undefined, value: unknown): string => {
  if (!field) {
    return previewText(value);
  }
  if (field.type === "select") {
    return choiceLabel(field, value);
  }
  // A record's multiselect value is an array of choice ids; a view FILTER's
  // value is a single choice id (the filter editor writes `choice.id`). Both
  // sides pass through here — `recordMatchesViewFilter` formats the record
  // value and the filter value with this same function — so the non-array
  // branch must map its id to a label too. Guarding the whole case on
  // `Array.isArray` left the filter value as a raw id ("opt_urgent") while the
  // record side became labels ("Urgent, Later"), so equals/contains on a
  // multiselect field never matched anything.
  if (field.type === "multiselect") {
    return Array.isArray(value)
      ? value.map((item) => choiceLabel(field, item)).join(", ")
      : choiceLabel(field, value);
  }
  if (field.type === "number" && field.options.number?.format === "currency") {
    return formatNumberField(value, field.options.number);
  }
  if (field.type === "lookup") {
    const numberOptions = field.options.number;
    if (Array.isArray(value)) {
      return value
        .map((item) =>
          numberOptions && typeof item === "number"
            ? formatNumberField(item, numberOptions)
            : previewText(item),
        )
        .join(", ");
    }
    if (numberOptions && typeof value === "number") {
      return formatNumberField(value, numberOptions);
    }
  }
  if (field.type === "embed") {
    return resolveEmbedPreview(value, field)?.label ?? previewText(value, field.type);
  }
  return previewText(value, field.type);
};

/**
 * Field types whose STORED value is itself a grouping key, so a SQL GROUP BY
 * produces exactly the buckets a client would build from the same records.
 * Text is excluded (`valueText` is truncated at `VALUE_TEXT_INDEX_LIMIT`, so
 * two distinct long values can collide into one bucket), and so is date
 * (bucketing by day depends on the VIEWER's timezone, which the server doesn't
 * have — the same reasoning that keeps date out of the exact filter pushdown).
 */
export const GROUPABLE_FIELD_TYPES: ReadonlySet<string> = new Set(["select", "checkbox"]);

/**
 * Field types that project into the `valueDate` column (mirrors
 * `DATE_FIELD_TYPES` in `logic/vo.ts`, which this file cannot import without
 * creating a cycle — `resolveDateField`, `listRecordsPage`'s `dateRange`, and
 * demo mode all need the same list independently of that projection code).
 * `created_time`/`updated_time` are computed at commit time (see
 * `field-types.ts`'s `compute`) but flow through the same projection as a
 * plain `date` field once written, so a UTC range predicate applies to them
 * identically.
 */
export const DATE_RANGE_FIELD_TYPES: ReadonlySet<string> = new Set([
  "date",
  "created_time",
  "updated_time",
]);

/**
 * Normalize one raw stored value to its group key. Shared by the SQL path, the
 * evaluate-in-memory fallback and demo mode so all three bucket identically.
 */
export const groupKeyForValue = (value: unknown, fieldType: string): string | null => {
  if (fieldType === "checkbox") {
    // `recordMatchesViewFilter` treats false/"false"/null/undefined alike, so
    // an unset checkbox belongs in the "false" bucket rather than its own.
    return value === true || value === "true" ? "true" : "false";
  }
  return typeof value === "string" && value !== "" ? value : null;
};

/**
 * The minimum a record must expose for the authoritative view filter/sort below.
 * `RecordVO` satisfies it, and so does a cheap `{id, updatedAt, fields}` row read
 * straight from the commit table — which is what lets a big Base evaluate a
 * saved view without hydrating every record into a full VO first.
 */
export interface ViewEvaluableRecord {
  id: string;
  updatedAt: string;
  fields: Record<string, unknown>;
}

/** Adapt a RecordVO to the evaluable shape (lookup values already merged in). */
export const toViewEvaluableRecord = (record: RecordVO): ViewEvaluableRecord => ({
  id: record.id,
  updatedAt: record.updatedAt,
  fields: record.headCommit.payload,
});

const recordMatchesViewFilter = (
  record: ViewEvaluableRecord,
  fields: ReadonlyArray<BaseFieldVO>,
  filter: ViewFilterVO,
): boolean => {
  const value = record.fields[filter.fieldSlug];
  const field = fields.find((item) => item.slug === filter.fieldSlug);
  const text = getViewFieldPreviewText(field, value).toLowerCase();
  const expected = getViewFieldPreviewText(field, filter.value).toLowerCase();

  if (filter.operator === "contains") return text.includes(expected);
  if (filter.operator === "equals") return text === expected;
  if (filter.operator === "not_empty") return text.length > 0 && text !== "-";
  if (filter.operator === "is_empty") return text.length === 0 || text === "-";
  if (filter.operator === "is_true") return value === true || value === "true";
  if (filter.operator === "is_false") {
    return value === false || value === "false" || value === null || value === undefined;
  }
  return true;
};

const compareRecordsByViewSort = (
  left: ViewEvaluableRecord,
  right: ViewEvaluableRecord,
  fields: ReadonlyArray<BaseFieldVO>,
  config: ViewConfigVO,
): number => {
  for (const sort of config.sorts) {
    const field = fields.find((item) => item.slug === sort.fieldSlug);
    const leftValue = getViewFieldPreviewText(field, left.fields[sort.fieldSlug]);
    const rightValue = getViewFieldPreviewText(field, right.fields[sort.fieldSlug]);
    const result = leftValue.localeCompare(rightValue, undefined, {
      numeric: true,
      sensitivity: "base",
    });
    if (result !== 0) {
      return sort.direction === "asc" ? result : -result;
    }
  }
  const updatedAtResult = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
  return updatedAtResult !== 0 ? updatedAtResult : right.id.localeCompare(left.id);
};

/** Apply the complete saved-view semantics before any page is selected. */
export const applyViewConfigToRecords = (
  records: RecordVO[],
  config?: ViewConfigVO,
): RecordVO[] => {
  if (!config) {
    return records;
  }
  const filtered = records.filter((record) =>
    config.filters.every((filter) =>
      recordMatchesViewFilter(toViewEvaluableRecord(record), record.base.fields, filter),
    ),
  );
  return [...filtered].sort((left, right) =>
    compareRecordsByViewSort(
      toViewEvaluableRecord(left),
      toViewEvaluableRecord(right),
      left.base.fields,
      config,
    ),
  );
};

/**
 * The same filter + sort as `applyViewConfigToRecords`, over rows that have not
 * been hydrated into VOs. This is deliberately the SAME two functions, not a
 * parallel reimplementation — a second copy of view semantics that drifted from
 * the first would silently show a different record set on one code path.
 */
export const applyViewConfigToEvaluableRecords = <T extends ViewEvaluableRecord>(
  records: T[],
  baseFields: ReadonlyArray<BaseFieldVO>,
  config?: ViewConfigVO,
): T[] => {
  if (!config) {
    return records;
  }
  const filtered = records.filter((record) =>
    config.filters.every((filter) => recordMatchesViewFilter(record, baseFields, filter)),
  );
  return [...filtered].sort((left, right) =>
    compareRecordsByViewSort(left, right, baseFields, config),
  );
};
