import type { BaseFieldVO, FieldType } from "busabase-contract/types";
import { iStringParse } from "openlib/i18n/i-string";
import { isSystemFieldType } from "../../base/field-types";
import { fromText, isUnconvertibleFieldType } from "../../base/utils/field-conversion";

/**
 * Turn a clipboard paste into records.
 *
 * Deliberately TSV-first. A spreadsheet copy puts TAB-separated text on the
 * clipboard, and tabs cannot appear inside a cell, so splitting on them is
 * exact. Comma-separated text is accepted only when the paste contains no tab at
 * all, and even then it is split naively — quoted CSV with embedded commas or
 * newlines is NOT parsed. That is a deliberate refusal rather than a silent
 * mangle: shredding a quoted address field into three columns is worse than
 * telling the user to paste from a spreadsheet.
 */

/** Matches the endpoint's own `records` cap, so the UI can say so before submitting. */
export const PASTE_MAX_ROWS = 1000;

export interface PasteColumn {
  /** Header text exactly as pasted. */
  header: string;
  /** The field it was matched to, or null when unmatched/unsupported. */
  field: BaseFieldVO | null;
  /** Why the column can't be imported, when it can't. */
  unsupportedReason: "unmatched" | "system" | "unconvertible" | null;
}

export interface ParsedPaste {
  columns: PasteColumn[];
  /** One entry per data row, keyed by field slug. Unsupported columns are absent. */
  rows: Array<Record<string, unknown>>;
  /** Raw cells per row, parallel to `columns`, for the preview table. */
  rawRows: string[][];
  /** True when the paste was split on commas rather than tabs. */
  commaSeparated: boolean;
}

const splitLines = (text: string): string[] =>
  text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0);

/** Case-, space- and punctuation-insensitive, so "Due Date" matches `due_date`. */
const normalizeHeader = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");

const matchField = (header: string, fields: ReadonlyArray<BaseFieldVO>): BaseFieldVO | null => {
  const key = normalizeHeader(header);
  if (!key) return null;
  return (
    fields.find((field) => normalizeHeader(field.slug) === key) ??
    fields.find((field) => normalizeHeader(iStringParse(field.name)) === key) ??
    null
  );
};

const cellToValue = (raw: string, field: BaseFieldVO): unknown => {
  const text = raw.trim();
  if (text === "") return null;
  try {
    // Ask the shared converter rather than re-deriving per-type coercion here —
    // it is the same module the server's conversion path uses, so a cell that
    // imports cleanly reads back the way the grid renders it.
    return fromText(text, field.type as FieldType, {
      choices: field.options?.choices,
    });
  } catch {
    return null;
  }
};

export function parsePastedTable(
  text: string,
  fields: ReadonlyArray<BaseFieldVO>,
): ParsedPaste | null {
  const lines = splitLines(text);
  if (lines.length < 2) return null;

  const commaSeparated = !lines[0]?.includes("\t");
  const separator = commaSeparated ? "," : "\t";
  const headers = (lines[0] ?? "").split(separator).map((cell) => cell.trim());

  const columns: PasteColumn[] = headers.map((header) => {
    const field = matchField(header, fields);
    if (!field) return { header, field: null, unsupportedReason: "unmatched" };
    if (isSystemFieldType(field.type)) {
      return { header, field: null, unsupportedReason: "system" };
    }
    // Never re-list the unconvertible types by hand — ask the converter. A stale
    // hardcoded copy of exactly that set is what once nulled a whole column.
    if (isUnconvertibleFieldType(field.type as FieldType)) {
      return { header, field: null, unsupportedReason: "unconvertible" };
    }
    return { header, field, unsupportedReason: null };
  });

  const rawRows = lines.slice(1).map((line) => {
    const cells = line.split(separator);
    // Pad/trim so every row lines up with the header, instead of shifting values
    // into the wrong column when a trailing cell is empty.
    return headers.map((_, index) => cells[index]?.trim() ?? "");
  });

  const rows = rawRows.map((cells) =>
    Object.fromEntries(
      columns
        .map((column, index) =>
          column.field ? [column.field.slug, cellToValue(cells[index] ?? "", column.field)] : null,
        )
        .filter((entry): entry is [string, unknown] => entry !== null),
    ),
  );

  return { columns, rows, rawRows, commaSeparated };
}
