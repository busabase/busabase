import { isListPayloadOmitted } from "../utils/list-payload-preview";

export const TABLE_CELL_PREVIEW_MAX_CHARS = 240;

/** Longer link values fall back to the record page instead of entering an href. */
export const TABLE_CELL_LINK_MAX_CHARS = 4_096;

export interface TableCellPreview {
  text: string;
  truncated: boolean;
  omitted: boolean;
}

const omittedPreview = (): TableCellPreview => ({
  text: "",
  truncated: false,
  omitted: true,
});

/**
 * Bound a value before any whitespace/HTML/regex formatting runs. Long strings
 * are sliced first; JSON-like values are written until the budget runs out, so
 * a huge nested array is never serialized in full and a small one stays exact.
 */
export const buildTableCellPreview = (
  value: unknown,
  maxChars = TABLE_CELL_PREVIEW_MAX_CHARS,
): TableCellPreview => {
  if (isListPayloadOmitted(value)) {
    return omittedPreview();
  }
  if (value === null || value === undefined) {
    return { text: "", truncated: false, omitted: false };
  }
  if (typeof value === "string") {
    return {
      text: normalizePreviewText(value.slice(0, maxChars + 1), maxChars),
      truncated: value.length > maxChars,
      omitted: false,
    };
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return {
      text: normalizePreviewText(String(value), maxChars),
      truncated: false,
      omitted: false,
    };
  }

  const writer: PreviewWriter = { text: "", maxChars, ancestors: new WeakSet() };
  writeJsonPreview(value, writer);
  return {
    text: normalizePreviewText(writer.text.slice(0, maxChars + 1), maxChars),
    truncated: hasOverflowed(writer),
    omitted: false,
  };
};

const normalizePreviewText = (source: string, maxChars: number): string =>
  source.replace(/\s+/g, " ").trim().slice(0, maxChars);

interface PreviewWriter {
  text: string;
  maxChars: number;
  ancestors: WeakSet<object>;
}

const hasOverflowed = (writer: PreviewWriter) => writer.text.length > writer.maxChars;

const isOmittedByJson = (value: unknown) =>
  value === undefined || typeof value === "function" || typeof value === "symbol";

/** Matches JSON.stringify output, but stops as soon as the preview budget is spent. */
const writeJsonPreview = (value: unknown, writer: PreviewWriter): void => {
  if (hasOverflowed(writer)) return;
  if (value === null || isOmittedByJson(value)) {
    writer.text += "null";
    return;
  }
  if (typeof value === "string") {
    // One extra character past the budget is enough to report the overflow.
    writer.text += JSON.stringify(value.slice(0, writer.maxChars - writer.text.length + 1));
    return;
  }
  if (typeof value === "bigint") {
    writer.text += String(value);
    return;
  }
  if (typeof value !== "object" || value instanceof Date) {
    writer.text += JSON.stringify(value);
    return;
  }
  if (writer.ancestors.has(value)) {
    writer.text += '"[Circular]"';
    return;
  }
  writer.ancestors.add(value);
  if (Array.isArray(value)) {
    writer.text += "[";
    for (const [index, item] of value.entries()) {
      if (hasOverflowed(writer)) break;
      if (index > 0) writer.text += ",";
      writeJsonPreview(item, writer);
    }
    writer.text += "]";
  } else {
    writer.text += "{";
    let separator = "";
    for (const key in value) {
      if (hasOverflowed(writer)) break;
      if (!Object.hasOwn(value, key)) continue;
      const item = (value as Record<string, unknown>)[key];
      if (isOmittedByJson(item)) continue;
      writer.text += `${separator}${JSON.stringify(key)}:`;
      separator = ",";
      writeJsonPreview(item, writer);
    }
    writer.text += "}";
  }
  writer.ancestors.delete(value);
};
