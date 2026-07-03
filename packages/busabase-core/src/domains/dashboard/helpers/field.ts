import type { BaseFieldVO, ChangeRequestVO, FieldType, RecordVO } from "busabase-contract/types";
import type { AttachmentRef } from "open-domains/attachments/types";
import { iStringParse } from "openlib/i18n/i-string";
import { FIELD_TYPE_ORDER } from "../../base/field-types";
import { fieldValueToString, formatActorLabel, formatNumberField } from "./format";
import { stripHtmlTags } from "./html";
import type { FieldChip } from "./view-types";

// Field-type picker order — sourced from the registry (single source of truth).
export const fieldTypeOptions: FieldType[] = FIELD_TYPE_ORDER;

export const createDefaultFieldOptions = (
  fieldType: FieldType,
  targetBaseId: string,
  multiple: boolean,
) => {
  if (fieldType === "relation") {
    return { multiple, targetBaseId };
  }
  if (fieldType === "select" || fieldType === "multiselect") {
    return {
      choices: [
        { id: "todo", name: "Todo", color: "slate" },
        { id: "active", name: "Active", color: "amber" },
        { id: "done", name: "Done", color: "emerald" },
      ],
    };
  }
  if (fieldType === "ai_summary" || fieldType === "ai_tags") {
    return { ai: { model: "gpt-5-mini", reviewRequired: true, sourceFieldIds: [] } };
  }
  return undefined;
};

export const getChoiceLabel = (field: BaseFieldVO, value: unknown) => {
  const choiceId = typeof value === "string" ? value : "";
  return field.options.choices?.find((choice) => choice.id === choiceId)?.name ?? choiceId;
};

// Static (Tailwind-scannable) class strings per named choice color, dark-mode aware.
export const CHOICE_BADGE_CLASS: Record<string, string> = {
  slate:
    "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800/50 dark:text-slate-200",
  gray: "border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-700 dark:bg-gray-800/50 dark:text-gray-200",
  red: "border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300",
  rose: "border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-300",
  orange:
    "border-orange-200 bg-orange-50 text-orange-700 dark:border-orange-900 dark:bg-orange-950/40 dark:text-orange-300",
  amber:
    "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300",
  yellow:
    "border-yellow-200 bg-yellow-50 text-yellow-700 dark:border-yellow-900 dark:bg-yellow-950/40 dark:text-yellow-300",
  emerald:
    "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300",
  green:
    "border-green-200 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300",
  teal: "border-teal-200 bg-teal-50 text-teal-700 dark:border-teal-900 dark:bg-teal-950/40 dark:text-teal-300",
  cyan: "border-cyan-200 bg-cyan-50 text-cyan-700 dark:border-cyan-900 dark:bg-cyan-950/40 dark:text-cyan-300",
  blue: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-300",
  indigo:
    "border-indigo-200 bg-indigo-50 text-indigo-700 dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300",
  violet:
    "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-900 dark:bg-violet-950/40 dark:text-violet-300",
  purple:
    "border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-900 dark:bg-purple-950/40 dark:text-purple-300",
  pink: "border-pink-200 bg-pink-50 text-pink-700 dark:border-pink-900 dark:bg-pink-950/40 dark:text-pink-300",
};

export const getChoiceBadgeClass = (color?: string) =>
  (color ? CHOICE_BADGE_CLASS[color] : undefined) ?? CHOICE_BADGE_CLASS.slate;

// Chip-able fields (select / multiselect / ai_tags) → labelled, color-tagged chips.
export const getFieldChipEntries = (field: BaseFieldVO, value: unknown): FieldChip[] => {
  const findChoice = (id: string) => field.options.choices?.find((choice) => choice.id === id);
  if (field.type === "select") {
    const choiceId = typeof value === "string" ? value : "";
    if (!choiceId) {
      return [];
    }
    const choice = findChoice(choiceId);
    return [{ label: choice?.name ?? choiceId, color: choice?.color }];
  }
  if (field.type === "multiselect" && Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string" && item.length > 0)
      .map((item) => {
        const choice = findChoice(item);
        return { label: choice?.name ?? item, color: choice?.color };
      });
  }
  if (field.type === "ai_tags" && Array.isArray(value)) {
    return value
      .filter((item): item is string => typeof item === "string" && item.length > 0)
      .map((item) => ({ label: item }));
  }
  return [];
};

export const getFieldPreviewText = (field: BaseFieldVO | undefined, value: unknown) => {
  if (!field) {
    return fieldPreviewText(value);
  }
  if (field.type === "select") {
    return getChoiceLabel(field, value);
  }
  if (field.type === "multiselect" && Array.isArray(value)) {
    return value.map((item) => getChoiceLabel(field, item)).join(", ");
  }
  if (field.type === "number" && field.options.number?.format === "currency") {
    return formatNumberField(value, field.options.number);
  }
  return fieldPreviewText(value, field.type);
};

export const fieldPreviewText = (value: unknown, type?: FieldType) => {
  if (type === "checkbox") {
    return value === true || value === "true" ? "Yes" : "No";
  }
  if (type === "created_by" || type === "updated_by") {
    return formatActorLabel(value);
  }
  if (type === "auto_number") {
    const text = fieldValueToString(value);
    return text ? `#${text}` : text;
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

export const getRelationRecordIds = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  }
  if (typeof value === "string" && value.length > 0) {
    return [value];
  }
  return [];
};

/** Parse an `attachment` field value (array of denormalized refs) defensively. */
export const getAttachmentRefs = (value: unknown): AttachmentRef[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(
    (item): item is AttachmentRef =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as AttachmentRef).url === "string" &&
      typeof (item as AttachmentRef).fileName === "string",
  );
};

export const isRecordTitleField = (field: BaseFieldVO) =>
  ["title", "name", "subject"].includes(field.slug);

export const isRecordLongField = (field: BaseFieldVO, value: unknown) => {
  if (["longtext", "markdown", "html", "code", "ai_summary"].includes(field.type)) {
    return true;
  }
  if (["body", "content", "description", "summary"].includes(field.slug)) {
    return true;
  }
  return fieldValueToString(value).length > 180;
};

export const getFieldName = (changeRequest: ChangeRequestVO, fieldSlug: string) => {
  const name = changeRequest.base?.fields.find((field) => field.slug === fieldSlug)?.name;
  return name ? iStringParse(name) : fieldSlug;
};

export const getRecordFieldType = (record: RecordVO, fieldSlug: string) =>
  record.base.fields.find((field) => field.slug === fieldSlug)?.type;
