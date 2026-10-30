import type { AcpInputResponse } from "./types";

export interface AcpInputField {
  name: string;
  title: string;
  description?: string;
  type: "string" | "number" | "integer" | "boolean" | "array";
  required: boolean;
  options?: Array<{ value: string; label: string }>;
  defaultValue?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

function optionsOf(value: Record<string, unknown>): AcpInputField["options"] {
  const alternatives = Array.isArray(value.oneOf)
    ? value.oneOf
    : Array.isArray(value.anyOf)
      ? value.anyOf
      : undefined;
  if (alternatives) {
    return alternatives.flatMap((option) => {
      const item = record(option);
      return typeof item?.const === "string"
        ? [{ value: item.const, label: typeof item.title === "string" ? item.title : item.const }]
        : [];
    });
  }
  if (!Array.isArray(value.enum)) return undefined;
  return value.enum.flatMap((option, index) =>
    typeof option === "string"
      ? [
          {
            value: option,
            label:
              Array.isArray(value.enumNames) && typeof value.enumNames[index] === "string"
                ? value.enumNames[index]
                : option,
          },
        ]
      : [],
  );
}

/** Only ACP's flat primitive form schema is renderable. Unknown schemas stay read-only. */
export function parseAcpInputFields(schema: Record<string, unknown>): AcpInputField[] | null {
  const properties = record(schema.properties);
  if ((schema.type !== undefined && schema.type !== "object") || !properties) return null;
  const required = Array.isArray(schema.required) ? schema.required : [];
  const fields: AcpInputField[] = [];
  for (const [name, raw] of Object.entries(properties)) {
    const value = record(raw);
    if (!value || !["string", "number", "integer", "boolean", "array"].includes(String(value.type)))
      return null;
    const type = value.type as AcpInputField["type"];
    const options = optionsOf(type === "array" ? (record(value.items) ?? {}) : value);
    if (type === "array" && !options?.length) return null;
    fields.push({
      name,
      title: typeof value.title === "string" ? value.title : name,
      type,
      required: required.includes(name),
      ...(typeof value.description === "string" ? { description: value.description } : {}),
      ...(options ? { options } : {}),
      ...("default" in value ? { defaultValue: value.default } : {}),
      ...Object.fromEntries(
        ["minimum", "maximum", "minLength", "maxLength", "minItems", "maxItems"].flatMap((key) =>
          typeof value[key] === "number" ? [[key, value[key]]] : [],
        ),
      ),
    });
  }
  return fields;
}

/** Return errors keyed by field name without silently coercing user input. */
export function validateAcpInputResponse(
  schema: Record<string, unknown>,
  response: AcpInputResponse,
): Record<string, string> {
  if (response.action !== "accept") return {};
  const fields = parseAcpInputFields(schema);
  if (!fields) return { _schema: "This form is not supported by this client." };
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const value = response.content?.[field.name];
    const absent = value === undefined || value === null || value === "";
    if (absent) {
      if (field.required) errors[field.name] = "An answer is required.";
      continue;
    }
    if (field.type === "string") {
      if (typeof value !== "string") errors[field.name] = "Enter text.";
      else if (field.options && !field.options.some((option) => option.value === value))
        errors[field.name] = "Choose one of the available options.";
      else if (field.minLength !== undefined && Array.from(value).length < field.minLength)
        errors[field.name] = `Enter at least ${field.minLength} characters.`;
      else if (field.maxLength !== undefined && Array.from(value).length > field.maxLength)
        errors[field.name] = `Enter at most ${field.maxLength} characters.`;
    } else if (field.type === "number" || field.type === "integer") {
      if (
        typeof value !== "number" ||
        !Number.isFinite(value) ||
        (field.type === "integer" && !Number.isInteger(value))
      )
        errors[field.name] = field.type === "integer" ? "Enter a whole number." : "Enter a number.";
      else if (field.minimum !== undefined && value < field.minimum)
        errors[field.name] = `Enter ${field.minimum} or greater.`;
      else if (field.maximum !== undefined && value > field.maximum)
        errors[field.name] = `Enter ${field.maximum} or less.`;
    } else if (field.type === "boolean") {
      if (typeof value !== "boolean") errors[field.name] = "Choose yes or no.";
    } else if (
      !Array.isArray(value) ||
      value.some(
        (item) =>
          typeof item !== "string" || !field.options?.some((option) => option.value === item),
      )
    )
      errors[field.name] = "Choose from the available options.";
    else if (new Set(value).size !== value.length)
      errors[field.name] = "Each option can only be selected once.";
    else if (
      (field.required && value.length === 0) ||
      (field.minItems !== undefined && value.length < field.minItems)
    )
      errors[field.name] = `Choose at least ${field.minItems ?? 1} options.`;
    else if (field.maxItems !== undefined && value.length > field.maxItems)
      errors[field.name] = `Choose at most ${field.maxItems} options.`;
  }
  return errors;
}
