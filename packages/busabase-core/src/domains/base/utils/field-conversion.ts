// Pure, isomorphic field-type conversion via text as intermediate form.
// No DB, no React, no server-only imports — safe to use on both client and server.
import type { FieldType } from "busabase-contract/types";
import { isSystemFieldType } from "../field-types";

export interface FieldConversionOptions {
  choices?: ReadonlyArray<{ id: string; name: string; color?: string }>;
}

export class ConversionNotSupportedError extends Error {
  readonly fromType: FieldType;
  readonly toType: FieldType;

  constructor(fromType: FieldType, toType: FieldType) {
    super(`Cannot convert from "${fromType}" to "${toType}"`);
    this.name = "ConversionNotSupportedError";
    this.fromType = fromType;
    this.toType = toType;
  }
}

const UNCONVERTIBLE_FROM: ReadonlySet<FieldType> = new Set(["relation", "attachment"]);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const URL_RE = /^https?:\/\//;

/**
 * Convert a field value to its text representation.
 * Returns null for unconvertible types (relation, attachment, system fields)
 * and for null/undefined input.
 */
export function toText(
  value: unknown,
  fromType: FieldType,
  options?: FieldConversionOptions,
): string | null {
  if (value === null || value === undefined) return null;

  // system fields and relation/attachment: cannot convert out (except to null)
  if (isSystemFieldType(fromType)) return null;
  if (UNCONVERTIBLE_FROM.has(fromType)) return null;

  switch (fromType) {
    case "text":
    case "longtext":
    case "markdown":
    case "html":
    case "code":
    case "json":
    case "yaml":
    case "email":
    case "url":
    case "phone":
    case "ai_summary":
      return typeof value === "string" ? value : String(value);

    case "number":
      return String(value);

    case "checkbox":
      return value ? "true" : "false";

    case "date":
      // Accept ISO strings or Date objects
      if (typeof value === "string") return value;
      if (value instanceof Date) return value.toISOString();
      return String(value);

    case "select": {
      if (typeof value !== "string") return String(value);
      const choice = options?.choices?.find((c) => c.id === value);
      // If we have choices and the id matched, return the label; otherwise passthrough
      return choice ? choice.name : value;
    }

    case "multiselect":
    case "ai_tags": {
      if (!Array.isArray(value)) return String(value);
      if (fromType === "multiselect" && options?.choices) {
        const labels = (value as string[]).map((id) => {
          const choice = options.choices?.find((c) => c.id === id);
          return choice ? choice.name : id;
        });
        return labels.join(", ");
      }
      return (value as string[]).join(", ");
    }

    default:
      return null;
  }
}

/**
 * Convert a text string to a target field type value.
 * Throws ConversionNotSupportedError for relation, attachment, and system fields.
 * Returns null when conversion fails (invalid format, no matching choice, etc.).
 */
export function fromText(
  text: string | null,
  toType: FieldType,
  options?: FieldConversionOptions,
): unknown {
  if (isSystemFieldType(toType)) {
    throw new ConversionNotSupportedError("text" as FieldType, toType);
  }
  if (toType === "relation" || toType === "attachment") {
    throw new ConversionNotSupportedError("text" as FieldType, toType);
  }

  if (text === null || text === undefined) return null;

  switch (toType) {
    case "text":
    case "longtext":
    case "markdown":
    case "html":
    case "code":
    case "json":
    case "yaml":
    case "ai_summary":
      return text;

    case "email":
      return EMAIL_RE.test(text) ? text : null;

    case "url":
      return URL_RE.test(text) ? text : null;

    case "phone":
      // basic: non-empty string with at least 6 digits/separators
      return /^\+?[\d\s().-]{6,}$/.test(text) ? text : null;

    case "number": {
      const trimmed = text.trim();
      if (trimmed === "") return null;
      const n = Number(trimmed);
      return Number.isFinite(n) ? n : null;
    }

    case "checkbox": {
      const lower = text.toLowerCase().trim();
      if (lower === "true" || lower === "1" || lower === "yes") return true;
      return false;
    }

    case "date": {
      if (!text) return null;
      const d = new Date(text);
      return Number.isNaN(d.getTime()) ? null : d.toISOString();
    }

    case "select": {
      if (!options?.choices) return null;
      const lower = text.toLowerCase().trim();
      const choice = options.choices.find((c) => c.name.toLowerCase() === lower);
      return choice ? choice.id : null;
    }

    case "multiselect": {
      if (!text) return [];
      const parts = text
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (!options?.choices) return parts;
      const lower = (name: string) => name.toLowerCase();
      return parts
        .map((part) => options.choices?.find((c) => lower(c.name) === lower(part)))
        .filter((c): c is NonNullable<typeof c> => c !== undefined)
        .map((c) => c.id);
    }

    case "ai_tags": {
      if (!text) return [];
      return text
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    }

    default:
      return null;
  }
}

/**
 * Convert a field value from one type to another, using text as the intermediate form.
 * Throws ConversionNotSupportedError if either side is unconvertible (relation,
 * attachment, system fields).
 */
export function convertFieldValue(
  value: unknown,
  fromType: FieldType,
  toType: FieldType,
  options?: FieldConversionOptions,
): unknown {
  if (fromType === toType) return value;

  // Validate toType before doing any work
  if (isSystemFieldType(toType) || toType === "relation" || toType === "attachment") {
    throw new ConversionNotSupportedError(fromType, toType);
  }
  if (isSystemFieldType(fromType) || UNCONVERTIBLE_FROM.has(fromType)) {
    throw new ConversionNotSupportedError(fromType, toType);
  }

  if (value === null || value === undefined) return null;

  const text = toText(value, fromType, options);
  return fromText(text, toType, options);
}
