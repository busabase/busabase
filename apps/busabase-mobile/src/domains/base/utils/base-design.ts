import type { FieldType } from "busabase-contract/types";

export const CREATABLE_FIELD_TYPES: readonly FieldType[] = [
  "text",
  "longtext",
  "markdown",
  "html",
  "code",
  "number",
  "date",
  "checkbox",
  "select",
  "multiselect",
  "url",
  "embed",
  "email",
  "phone",
  "attachment",
  "auto_number",
];

const CHOICE_FIELD_TYPES: ReadonlySet<FieldType> = new Set(["select", "multiselect"]);

export const isChoiceFieldType = (type: FieldType): boolean => CHOICE_FIELD_TYPES.has(type);

export const toBaseDesignSlug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export const buildChoiceFieldOptions = (choices: string[]) => ({
  choices: choices.map((label) => ({ id: toBaseDesignSlug(label) || label, name: label })),
});
