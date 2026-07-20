// Single source of truth for base field types — isomorphic (no DB, no React) so
// both the server (validation + computed values) and the client UI (input kind,
// label, column width, read-only) are driven by ONE registry instead of parallel
// switch/if chains scattered across handlers and the dashboard.
//
// Server orchestration lives in field-rules.ts (loops over defs, calls spec.validate
// / spec.compute). The client maps spec.input → a component. Add a field type here
// once and every layer picks it up.
import type { FieldType } from "busabase-contract/types";
import { type iString, iStringParse, type LocaleType } from "openlib/i18n/i-string";
import { parseDocument } from "yaml";
import { validateEmbedUrl } from "./utils/embed";

/** Minimal field-definition shape both the VO and the persisted row satisfy. */
export interface FieldDef {
  slug: string;
  /** Display name — plain string or locale-keyed record; render via fieldDisplayName. */
  name: iString;
  type: FieldType;
  required?: boolean;
  options?: {
    choices?: ReadonlyArray<{ id: string; name: string; color?: string }>;
    multiple?: boolean;
    targetBaseId?: string;
    /** Per-field limits for `attachment` columns (all optional; see attachmentValidator). */
    attachment?: {
      maxFiles?: number;
      allowedMimeTypes?: ReadonlyArray<string>;
      maxFileSize?: number;
    };
    code?: {
      language?: string;
    };
    embed?: {
      aspectRatio?: "16:9" | "4:3" | "1:1";
      height?: number;
      providers?: ReadonlyArray<string>;
    };
  } | null;
}

/** Which editor the UI renders for a field type. "computed" → read-only display. */
export type FieldInputKind =
  | "text"
  | "textarea"
  | "number"
  | "date"
  | "url"
  | "email"
  | "tel"
  | "checkbox"
  | "select"
  | "multiselect"
  | "relation"
  | "attachment"
  | "tags"
  | "computed";

/** Context handed to a system field's value computation at merge time. */
export interface SystemComputeCtx {
  mode: "create" | "update";
  actorId: string;
  timestampIso: string;
  existing: Record<string, unknown>;
  slug: string;
  nextAutoNumber: (slug: string) => number | null;
}

export interface FieldTypeSpec {
  type: FieldType;
  /** Human label — used by the field-type picker and the graph view. */
  label: string;
  /** CSS grid column width for the table view. */
  columnWidth: string;
  /** Which editor the UI renders. */
  input: FieldInputKind;
  /**
   * Validate a NON-EMPTY value; return an error message or null when valid.
   * Empty/required handling is done by the caller, not here.
   */
  validate?: (value: unknown, def: FieldDef) => string | null;
  /**
   * Server-managed value computation. Presence of `compute` is what makes a type
   * a "system" field: read-only in the UI and stripped from client input.
   */
  compute?: (ctx: SystemComputeCtx) => unknown;
}

/**
 * Resolve a field's display name to a string. Server-side messages have no user
 * locale, so this uses iStringParse's default fallback (requested → any → en).
 */
export const fieldDisplayName = (def: Pick<FieldDef, "name">, locale?: LocaleType): string =>
  iStringParse(def.name, locale);

// ── value predicates (shared by the per-type validators) ─────────────────────
// An empty array (`[]`) carries no meaningful value for array-shaped field types
// (attachment / multiselect / relation) — treat it the same as omitted/null/""
// so a required field can't be satisfied by explicitly submitting an empty list.
// This is the single shared gate for every type's "required" check (see
// `isEmptyFieldValue` export below, used by validateRecordFields in
// field-rules.ts), so this one change covers all array-shaped types uniformly.
// A NON-required array field submitting `[]` is unaffected: isEmpty only gates
// the required-check, so it still passes through with no error, same as `undefined`.
const isEmpty = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  value === "" ||
  (Array.isArray(value) && value.length === 0);

const isNumeric = (value: unknown): boolean => {
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string" && value.trim() !== "") return Number.isFinite(Number(value));
  return false;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_RE = /^\+?[\d\s().-]{6,}$/;

const isValidUrl = (value: unknown): boolean => {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
};

const isValidDate = (value: unknown): boolean => {
  if (typeof value !== "string" && typeof value !== "number") return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  // Reject year <= 0 (e.g. "0000-01-01", or a negative ISO-8601 extended year like
  // "-000001-01-01"). JS's Date constructor happily parses both, but this app only
  // accepts plain ISO date strings — not Postgres's BC/extended-year notation — and
  // Postgres's timestamp columns reject or mis-handle these on insert, surfacing as an
  // unclassified 500 instead of a clean validation error. Use getUTCFullYear() (not
  // getFullYear()) so the check isn't sensitive to the server's local timezone offset.
  return date.getUTCFullYear() > 0;
};

/** Choice membership accepts either the choice id or its display name. */
const choiceMatches = (value: unknown, def: FieldDef): boolean => {
  const choices = def.options?.choices;
  if (!choices || choices.length === 0) return true; // unconstrained
  return choices.some((choice) => choice.id === value || choice.name === value);
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

/**
 * Absolute per-file ceiling for attachment values, mirroring the upload guard
 * (open-domains/attachments `MAX_FILE_SIZE` = 25MB). Duplicated as a local constant
 * so this registry stays isomorphic — importing the server-only upload logic would
 * leak it into the client bundle.
 */
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/**
 * Human-readable byte size for an error message. `Math.round(bytes / (1024*1024))`
 * rounds every sub-~512KB limit down to "0MB" — meaningless to whoever configured a
 * small limit (e.g. a 1KB test fixture, or a deliberately tight icon-upload cap).
 * Picks KB for anything under 1MB so the number stays legible.
 */
const formatByteSize = (bytes: number): string => {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  }
  return `${Math.round(bytes / (1024 * 1024))}MB`;
};

/**
 * An inline attachment cell entry. New Busabase refs carry an `assetId` (and
 * keep `attachmentId` for storage lookup); legacy refs used `id` as the
 * attachment id. Accept both so imported/API records still index into Assets.
 */
const isAttachmentRef = (
  value: unknown,
): value is {
  attachmentId?: string;
  assetId?: string;
  id?: string;
  url: string;
  fileName: string;
  mimeType: string;
  size: number;
} => {
  if (typeof value !== "object" || value === null) return false;
  const ref = value as Record<string, unknown>;
  const hasId =
    typeof ref.id === "string" ||
    typeof ref.assetId === "string" ||
    typeof ref.attachmentId === "string";
  return (
    hasId &&
    typeof ref.url === "string" &&
    typeof ref.fileName === "string" &&
    typeof ref.mimeType === "string" &&
    typeof ref.size === "number" &&
    Number.isFinite(ref.size) &&
    ref.size >= 0
  );
};

// ── reusable validators ──────────────────────────────────────────────────────
const textValidator = (value: unknown, def: FieldDef) =>
  typeof value === "string" ? null : `${fieldDisplayName(def)} must be text`;

/**
 * Cheap pre-check for pathological bracket/brace nesting depth, run BEFORE
 * `JSON.parse` — a single pass over the raw text, string-literal-aware so
 * brackets inside quoted JSON string values aren't miscounted.
 *
 * Why this exists: `JSON.parse` on a deeply-nested-but-well-formed string
 * (e.g. 10,000 levels of `[[[[...]]]]`) succeeds fine in V8 — it does NOT
 * throw, so jsonValidator's own try/catch below never fires. The crash
 * happens much later in the write path: `normalizeFieldValue` (logic/vo.ts)
 * parses the string into a real nested-array structure for the `valueJson`
 * jsonb column, and drizzle-orm's jsonb column serialization
 * (`mapToDriverValue` → `JSON.stringify`) then blows the call stack with an
 * unclassified `RangeError` when the record is written — surfacing as a raw
 * 500, not a clean validation error. Rejecting over-deep input here, before
 * any parsing is attempted, keeps a pathologically nested value from ever
 * reaching that downstream re-serialization.
 */
const MAX_JSON_NESTING_DEPTH = 1000;

const exceedsMaxNestingDepth = (value: string, maxDepth: number): boolean => {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < value.length; i++) {
    const char = value[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === "[" || char === "{") {
      depth++;
      if (depth > maxDepth) return true;
    } else if (char === "]" || char === "}") {
      depth--;
    }
  }
  return false;
};

/** JSON is stored as raw text like `code`, but must parse before merge/commit. */
const jsonValidator = (value: unknown, def: FieldDef) => {
  if (typeof value !== "string") return `${fieldDisplayName(def)} must be text`;
  if (exceedsMaxNestingDepth(value, MAX_JSON_NESTING_DEPTH)) {
    return `${fieldDisplayName(def)} is nested too deeply (max ${MAX_JSON_NESTING_DEPTH} levels)`;
  }
  try {
    JSON.parse(value);
    return null;
  } catch {
    return `${fieldDisplayName(def)} must be valid JSON`;
  }
};

/** YAML is stored as raw text like `code`, but must parse before merge/commit. */
const yamlValidator = (value: unknown, def: FieldDef) => {
  if (typeof value !== "string") return `${fieldDisplayName(def)} must be text`;
  try {
    const document = parseDocument(value);
    return document.errors.length === 0 ? null : `${fieldDisplayName(def)} must be valid YAML`;
  } catch {
    return `${fieldDisplayName(def)} must be valid YAML`;
  }
};

const codeValidator = (value: unknown, def: FieldDef) => {
  const language = def.options?.code?.language?.toLowerCase();
  if (language === "json") {
    return jsonValidator(value, def);
  }
  if (language === "yaml" || language === "yml") {
    return yamlValidator(value, def);
  }
  return textValidator(value, def);
};

const numberValidator = (value: unknown, def: FieldDef) =>
  isNumeric(value) ? null : `${fieldDisplayName(def)} must be a number`;

/**
 * Match a concrete mimeType against an `allowedMimeTypes` entry. Supports exact
 * equality plus a single trailing `/*` wildcard (e.g. `"image/*"` matching any
 * `image/...` mimeType) — the common `"type/*"` convention also used by the
 * browser `accept` attribute. Deliberately minimal: not a general glob engine.
 */
const mimeTypeMatches = (mimeType: string, pattern: string): boolean => {
  if (pattern === mimeType) return true;
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -1); // "image/*" -> "image/"
    return mimeType.startsWith(prefix);
  }
  return false;
};

/**
 * Validate an `attachment` cell — an Airtable-style ARRAY of attachment refs
 * (empty array = no files). Enforces the field's `options.attachment` limits
 * (maxFiles / allowedMimeTypes / maxFileSize) plus the absolute 25MB ceiling.
 */
const attachmentValidator = (value: unknown, def: FieldDef): string | null => {
  const name = fieldDisplayName(def);
  if (!Array.isArray(value)) return `${name} must be a list of attachments`;
  if (!value.every(isAttachmentRef)) return `${name} has an invalid attachment`;

  const opts = def.options?.attachment;
  if (opts?.maxFiles !== undefined && value.length > opts.maxFiles) {
    return `${name} allows at most ${opts.maxFiles} file${opts.maxFiles === 1 ? "" : "s"}`;
  }

  const allowed = opts?.allowedMimeTypes;
  if (allowed && allowed.length > 0) {
    const bad = value.find(
      (ref) => !allowed.some((pattern) => mimeTypeMatches(ref.mimeType, pattern)),
    );
    if (bad) return `${name} does not allow files of type ${bad.mimeType}`;
  }

  const limit = Math.min(opts?.maxFileSize ?? MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_BYTES);
  if (value.some((ref) => ref.size > limit)) {
    return `${name} has a file larger than the ${formatByteSize(limit)} limit`;
  }

  return null;
};

// ── computed-value helpers (system fields) ───────────────────────────────────
const computeCreatedTime = (c: SystemComputeCtx) =>
  c.mode === "create" ? c.timestampIso : (c.existing[c.slug] ?? c.timestampIso);
const computeCreatedBy = (c: SystemComputeCtx) =>
  c.mode === "create" ? c.actorId : (c.existing[c.slug] ?? c.actorId);
const computeAutoNumber = (c: SystemComputeCtx) =>
  c.mode === "create" ? c.nextAutoNumber(c.slug) : (c.existing[c.slug] ?? c.nextAutoNumber(c.slug));

/**
 * The field-type registry. One entry per FieldType — the `Record<FieldType, …>`
 * makes it a compile error to forget a type.
 */
export const FIELD_TYPES: Record<FieldType, FieldTypeSpec> = {
  text: {
    type: "text",
    label: "text",
    input: "text",
    columnWidth: "minmax(128px,180px)",
    validate: textValidator,
  },
  longtext: {
    type: "longtext",
    label: "long text",
    input: "textarea",
    columnWidth: "minmax(128px,420px)",
    validate: textValidator,
  },
  markdown: {
    type: "markdown",
    label: "markdown",
    input: "textarea",
    columnWidth: "minmax(128px,420px)",
    validate: textValidator,
  },
  html: {
    type: "html",
    label: "html",
    input: "textarea",
    columnWidth: "minmax(128px,420px)",
    validate: textValidator,
  },
  code: {
    type: "code",
    label: "code",
    input: "textarea",
    columnWidth: "minmax(128px,420px)",
    validate: codeValidator,
  },
  json: {
    type: "json",
    label: "json",
    input: "textarea",
    columnWidth: "minmax(128px,420px)",
    validate: jsonValidator,
  },
  yaml: {
    type: "yaml",
    label: "yaml",
    input: "textarea",
    columnWidth: "minmax(128px,420px)",
    validate: yamlValidator,
  },
  number: {
    type: "number",
    label: "number",
    input: "number",
    columnWidth: "minmax(128px,180px)",
    validate: numberValidator,
  },
  checkbox: {
    type: "checkbox",
    label: "checkbox",
    input: "checkbox",
    columnWidth: "minmax(92px,112px)",
    validate: (value, def) =>
      typeof value === "boolean" ? null : `${fieldDisplayName(def)} must be true or false`,
  },
  date: {
    type: "date",
    label: "date",
    input: "date",
    columnWidth: "minmax(116px,150px)",
    validate: (value, def) =>
      isValidDate(value) ? null : `${fieldDisplayName(def)} must be a valid date`,
  },
  email: {
    type: "email",
    label: "email",
    input: "email",
    columnWidth: "minmax(180px,260px)",
    validate: (value, def) =>
      typeof value === "string" && EMAIL_RE.test(value)
        ? null
        : `${fieldDisplayName(def)} must be a valid email`,
  },
  url: {
    type: "url",
    label: "url",
    input: "url",
    columnWidth: "minmax(180px,260px)",
    validate: (value, def) =>
      isValidUrl(value) ? null : `${fieldDisplayName(def)} must be a valid URL`,
  },
  embed: {
    type: "embed",
    label: "embed",
    input: "url",
    columnWidth: "minmax(220px,320px)",
    validate: validateEmbedUrl,
  },
  phone: {
    type: "phone",
    label: "phone",
    input: "tel",
    columnWidth: "minmax(180px,260px)",
    validate: (value, def) =>
      typeof value === "string" && PHONE_RE.test(value)
        ? null
        : `${fieldDisplayName(def)} must be a valid phone number`,
  },
  select: {
    type: "select",
    label: "select",
    input: "select",
    columnWidth: "minmax(140px,220px)",
    validate: (value, def) =>
      typeof value === "string" && choiceMatches(value, def)
        ? null
        : `${fieldDisplayName(def)} must be one of its options`,
  },
  multiselect: {
    type: "multiselect",
    label: "multi-select",
    input: "multiselect",
    columnWidth: "minmax(140px,220px)",
    validate: (value, def) =>
      Array.isArray(value) && value.every((v) => typeof v === "string" && choiceMatches(v, def))
        ? null
        : `${fieldDisplayName(def)} must be a list of its options`,
  },
  relation: {
    type: "relation",
    label: "relation",
    input: "relation",
    columnWidth: "minmax(180px,280px)",
    validate: (value, def) =>
      typeof value === "string" || isStringArray(value)
        ? null
        : `${fieldDisplayName(def)} must be a record id or a list of record ids`,
  },
  attachment: {
    type: "attachment",
    label: "file",
    input: "attachment",
    columnWidth: "minmax(128px,180px)",
    validate: attachmentValidator,
  },
  ai_summary: {
    type: "ai_summary",
    label: "AI summary",
    input: "textarea",
    columnWidth: "minmax(220px,320px)",
    validate: textValidator,
  },
  ai_tags: {
    type: "ai_tags",
    // AI-generated but manually overridable — edited via a tag input.
    label: "AI tags",
    input: "tags",
    columnWidth: "minmax(140px,220px)",
    validate: (value, def) =>
      isStringArray(value) ? null : `${fieldDisplayName(def)} must be a list of tags`,
  },
  created_time: {
    type: "created_time",
    label: "created at",
    input: "computed",
    columnWidth: "minmax(116px,150px)",
    compute: computeCreatedTime,
  },
  updated_time: {
    type: "updated_time",
    label: "updated at",
    input: "computed",
    columnWidth: "minmax(116px,150px)",
    compute: (c) => c.timestampIso,
  },
  created_by: {
    type: "created_by",
    label: "created by",
    input: "computed",
    columnWidth: "minmax(128px,180px)",
    compute: computeCreatedBy,
  },
  updated_by: {
    type: "updated_by",
    label: "updated by",
    input: "computed",
    columnWidth: "minmax(128px,180px)",
    compute: (c) => c.actorId,
  },
  auto_number: {
    type: "auto_number",
    label: "auto #",
    input: "computed",
    columnWidth: "minmax(128px,180px)",
    compute: computeAutoNumber,
  },
};

/** Order fields appear in the field-type picker. */
export const FIELD_TYPE_ORDER: FieldType[] = [
  "text",
  "longtext",
  "markdown",
  "html",
  "code",
  "json",
  "yaml",
  "attachment",
  "relation",
  "number",
  "date",
  "checkbox",
  "select",
  "multiselect",
  "url",
  "embed",
  "email",
  "phone",
  "created_time",
  "updated_time",
  "created_by",
  "updated_by",
  "auto_number",
  "ai_summary",
  "ai_tags",
];

export const fieldSpec = (type: FieldType): FieldTypeSpec => FIELD_TYPES[type];
export const fieldLabel = (type: FieldType): string => FIELD_TYPES[type].label;
export const fieldInputKind = (type: FieldType): FieldInputKind => FIELD_TYPES[type].input;
export const fieldColumnWidth = (type: FieldType): string => FIELD_TYPES[type].columnWidth;

/** A field whose value the server computes — read-only in the UI, stripped from input. */
export const isSystemFieldType = (type: FieldType): boolean => Boolean(FIELD_TYPES[type].compute);

/** AI-generated fields (manually overridable, but not user-entered on create). */
export const isAiFieldType = (type: FieldType): boolean =>
  type === "ai_summary" || type === "ai_tags";

/**
 * How a field is sourced:
 * - "input"  → the user fills it (shown everywhere).
 * - "system" → the server computes it (read-only; hidden on create).
 * - "ai"     → an agent generates it (editable override; hidden on create).
 */
export const fieldCategory = (type: FieldType): "input" | "system" | "ai" =>
  isSystemFieldType(type) ? "system" : isAiFieldType(type) ? "ai" : "input";

/** Hidden from the create form — there is nothing to enter yet (system + AI fields). */
export const isHiddenOnCreate = (type: FieldType): boolean => fieldCategory(type) !== "input";

/**
 * How a field VALUE is rendered (read views / table cells). Lets the display
 * components dispatch on one registry-provided kind instead of per-type `if`s —
 * a new field type that fits an existing kind needs no component change.
 * "chips" is detected via choices, "plain" is the collapsible-text fallback.
 */
export type FieldDisplayKind =
  | "checkbox"
  | "chips"
  | "attachment"
  | "relation"
  | "markdown"
  | "html"
  | "code"
  | "embed"
  | "link"
  | "plain";

const DISPLAY_KIND: Partial<Record<FieldType, FieldDisplayKind>> = {
  checkbox: "checkbox",
  select: "chips",
  multiselect: "chips",
  ai_tags: "chips",
  attachment: "attachment",
  relation: "relation",
  markdown: "markdown",
  html: "html",
  code: "code",
  // Structured text fields reuse the code display kind with pinned preview languages.
  json: "code",
  yaml: "code",
  url: "link",
  embed: "embed",
  email: "link",
  phone: "link",
};

export const fieldDisplayKind = (type: FieldType): FieldDisplayKind =>
  DISPLAY_KIND[type] ?? "plain";

/** Href prefix for "link" display fields (url → none, email → mailto:, phone → tel:). */
const LINK_PREFIX: Partial<Record<FieldType, string>> = {
  url: "",
  email: "mailto:",
  phone: "tel:",
};

export const fieldLinkPrefix = (type: FieldType): string => LINK_PREFIX[type] ?? "";

/** The set of server-managed (computed) field types. */
export const SYSTEM_FIELD_TYPES: ReadonlySet<FieldType> = new Set(
  (Object.keys(FIELD_TYPES) as FieldType[]).filter(isSystemFieldType),
);

export { isEmpty as isEmptyFieldValue };
