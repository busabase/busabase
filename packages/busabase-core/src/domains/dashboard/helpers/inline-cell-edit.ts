import type { BaseFieldVO, FieldType } from "busabase-contract/types";
import { validateRecordFields } from "../../base/field-rules";
import { type FieldInputKind, fieldInputKind, isReadOnlyFieldDef } from "../../base/field-types";
import {
  getDateFieldOptions,
  toDateInputValue,
  toDateTimeInputValue,
} from "../../base/utils/date-value";
import { isListPayloadOmitted } from "../utils/list-payload-preview";
import { getEditorFieldValue, normalizeEditorFieldValue, resolveChoiceValue } from "./field";
import { fieldValueToString } from "./format";
import { TABLE_CELL_PREVIEW_MAX_CHARS } from "./table-cell-preview";

/**
 * In-cell editing for the Base grid, the pure half. The value rules are the
 * record edit form's, not a copy of them:
 *
 * - which control a field gets is the form's (`fieldInputKind`, the field-type
 *   registry the form's `RecordFieldInput` switches on);
 * - what an editor opens with is the form's (`getEditorFieldValue`);
 * - what is sent is the form's (`normalizeEditorFieldValue`, then
 *   `validateRecordFields` — the same pair the form runs on submit).
 *
 * The grid adds only what a one-line cell needs on top: a short list of field
 * types that fit in a cell, reading a price typed the way the cell displays it
 * (`$1,299.50`), and a localized reason when a value is refused.
 */

/** The editor a grid cell opens in place — the form's control kind for that field. */
export type InlineCellEditorKind = Extract<
  FieldInputKind,
  "text" | "number" | "select" | "checkbox" | "date" | "url" | "email" | "tel"
>;

/**
 * Field types that edit in place. Deliberately a short list: long text, JSON,
 * attachments, relations, people and AI/computed fields need more room or a
 * picker the grid cannot hold, so those cells keep opening the record.
 */
const INLINE_FIELD_TYPES: ReadonlySet<FieldType> = new Set<FieldType>([
  "text",
  "number",
  "select",
  "checkbox",
  "date",
  "url",
  "email",
  "phone",
]);

export const getInlineCellEditorKind = (field: BaseFieldVO): InlineCellEditorKind | null =>
  isReadOnlyFieldDef(field) || !INLINE_FIELD_TYPES.has(field.type)
    ? null
    : (fieldInputKind(field.type) as InlineCellEditorKind);

/**
 * Whether THIS value can be edited in a one-line cell without losing anything.
 * A value the list response left out (only the record holds it) must never be
 * edited from its placeholder, and a text value longer than the cell preview is
 * not "single-line" any more — both open the record instead.
 */
export const canEditCellValueInline = (field: BaseFieldVO, value: unknown): boolean => {
  const kind = getInlineCellEditorKind(field);
  if (!kind || isListPayloadOmitted(value)) return false;
  if (kind === "text" || kind === "url" || kind === "email" || kind === "tel") {
    if (value === null || value === undefined) return true;
    return typeof value === "string" && value.length <= TABLE_CELL_PREVIEW_MAX_CHARS;
  }
  if (kind === "select") {
    return value === null || value === undefined || typeof value === "string";
  }
  return true;
};

/**
 * The text a one-line text/number editor opens with: what the record form's
 * input would show for this value.
 */
export const toInlineCellDraft = (field: BaseFieldVO, value: unknown): string => {
  const draft = getEditorFieldValue(field, value);
  return typeof draft === "string" ? draft : fieldValueToString(draft);
};

/**
 * Textareas expose LF even when their value contains CRLF/CR. Preserve the raw
 * unchanged prefix/suffix so editing one part does not rewrite other line endings.
 */
export const preserveInlineTextLineEndings = (previous: string, next: string): string => {
  if (!previous.includes("\r")) return next;
  const normalized = previous.replace(/\r\n?/g, "\n");
  let prefix = 0;
  while (
    prefix < normalized.length &&
    prefix < next.length &&
    normalized[prefix] === next[prefix]
  ) {
    prefix += 1;
  }
  let suffix = 0;
  while (
    suffix < normalized.length - prefix &&
    suffix < next.length - prefix &&
    normalized[normalized.length - suffix - 1] === next[next.length - suffix - 1]
  ) {
    suffix += 1;
  }
  const rawOffset = (offset: number) => {
    let raw = 0;
    for (let index = 0; index < offset; index += 1) {
      raw += previous[raw] === "\r" && previous[raw + 1] === "\n" ? 2 : 1;
    }
    return raw;
  };
  return (
    previous.slice(0, rawOffset(prefix)) +
    next.slice(prefix, next.length - suffix) +
    previous.slice(rawOffset(normalized.length - suffix))
  );
};

const CURRENCY_SYMBOLS = /[$€£¥₩₫₹¢]/g;
const CURRENCY_CODE_EDGES = /^[A-Z]{3}(?=[\d.+-])|(?<=[\d.])[A-Z]{3}$/g;
const GROUPED_THOUSANDS = /^[-+]?\d{1,3}(,\d{3})+(\.\d+)?$/;
const PLAIN_NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i;

/**
 * A number as people type it into a price cell: `129`, `129.5`, `$1,299.50`,
 * `1 299`, `USD 24`. Thousands separators are only dropped when they really
 * group thousands (`1,299`), never guessed (`1,5` is refused rather than read
 * as 15 or 1.5). Returns `null` for anything that is not one number.
 */
export const parseNumberDraft = (text: string): number | null => {
  const compact = text
    .trim()
    .replace(/[\s\u00a0\u202f]/g, "")
    .replace(CURRENCY_SYMBOLS, "")
    .replace(CURRENCY_CODE_EDGES, "");
  const ungrouped = GROUPED_THOUSANDS.test(compact) ? compact.replace(/,/g, "") : compact;
  if (!PLAIN_NUMBER.test(ungrouped)) return null;
  const value = Number(ungrouped);
  return Number.isFinite(value) ? value : null;
};

/** Why a draft was refused, keyed to localized copy in the grid. */
export type InlineCellDraftError =
  | "required"
  | "number"
  | "email"
  | "url"
  | "phone"
  | "date"
  | "choice"
  | "invalid";

export type InlineCellDraftResult =
  | { ok: true; value: unknown }
  | { ok: false; error: InlineCellDraftError };

const errorForKind: Record<InlineCellEditorKind, InlineCellDraftError> = {
  text: "invalid",
  number: "number",
  select: "choice",
  checkbox: "invalid",
  date: "date",
  url: "url",
  email: "email",
  tel: "phone",
};

/**
 * Turn what an in-cell editor produced into the value to store, exactly as the
 * record form would on submit: `normalizeEditorFieldValue`, then
 * `validateRecordFields`. The select and date editors are the form's own
 * controls and already produce a stored value (a choice id, a `YYYY-MM-DD` day
 * or a zoned time); the one-line text editor produces text, which gets the two
 * cell-only courtesies first:
 *
 * - a number may be typed as the cell shows it (`$1,299.50`), which the form's
 *   `type="number"` input could not accept anyway;
 * - a URL, email or phone is trimmed, as the form's `type="url"` / `"email"`
 *   inputs already do for it (pasted values often carry a stray space).
 */
export const parseInlineCellDraft = (field: BaseFieldVO, draft: unknown): InlineCellDraftResult => {
  const kind = getInlineCellEditorKind(field);
  if (!kind) return { ok: false, error: "invalid" };
  let input = draft;
  if (typeof draft === "string") {
    const trimmed = draft.trim();
    if (!trimmed) {
      // An all-blank entry clears the cell (so it cannot satisfy "required").
      input = "";
    } else if (kind === "number") {
      const parsed = parseNumberDraft(draft);
      // Refuse rather than let `Number()` guess (`0x10`, `1,5`).
      if (parsed === null) return { ok: false, error: "number" };
      input = parsed;
    } else if (kind === "url" || kind === "email" || kind === "tel") {
      input = trimmed;
    }
  }
  const value = normalizeEditorFieldValue(field, input);
  const [failure] = validateRecordFields({ [field.slug]: value }, [field]);
  if (failure) {
    const empty = value === null || value === "";
    return { ok: false, error: empty && field.required ? "required" : errorForKind[kind] };
  }
  return { ok: true, value };
};

/** The wall-clock text a date value shows in its field's zone, for comparison. */
const dateComparisonKey = (field: BaseFieldVO, value: unknown): string => {
  const options = getDateFieldOptions(field.options);
  return options.includeTime
    ? toDateTimeInputValue(value, options.timezone)
    : toDateInputValue(value);
};

/** True when committing `next` (an already-normalized value) would not change what the cell stores. */
export const isSameInlineCellValue = (
  field: BaseFieldVO,
  current: unknown,
  next: unknown,
): boolean => {
  const kind = getInlineCellEditorKind(field);
  if (kind === "checkbox") {
    return normalizeEditorFieldValue(field, current) === normalizeEditorFieldValue(field, next);
  }
  const blank = (value: unknown) => value === null || value === undefined || value === "";
  if (blank(current) && blank(next)) return true;
  if (kind === "number") {
    return !blank(current) && normalizeEditorFieldValue(field, current) === next;
  }
  if (kind === "select") {
    if (typeof current !== "string" || typeof next !== "string") return false;
    const choices = field.options.choices ?? [];
    return (resolveChoiceValue(current, choices).choice?.id ?? current) === next;
  }
  if (kind === "date") {
    return dateComparisonKey(field, current) === dateComparisonKey(field, next);
  }
  return fieldValueToString(current) === fieldValueToString(next);
};
