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
const isEmpty = (value: unknown): boolean => value === undefined || value === null || value === "";

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
  return !Number.isNaN(new Date(value).getTime());
};

/** Choice membership accepts either the choice id or its display name. */
const choiceMatches = (value: unknown, def: FieldDef): boolean => {
  const choices = def.options?.choices;
  if (!choices || choices.length === 0) return true; // unconstrained
  return choices.some((choice) => choice.id === value || choice.name === value);
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

// ── reusable validators ──────────────────────────────────────────────────────
const textValidator = (value: unknown, def: FieldDef) =>
  typeof value === "string" ? null : `${fieldDisplayName(def)} must be text`;

const numberValidator = (value: unknown, def: FieldDef) =>
  isNumeric(value) ? null : `${fieldDisplayName(def)} must be a number`;

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
    validate: textValidator,
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
  "attachment",
  "relation",
  "number",
  "date",
  "checkbox",
  "select",
  "multiselect",
  "url",
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
  url: "link",
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
