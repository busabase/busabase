import type { AgentInputResponse } from "busabase-contract/domains/agents/types";

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

function validateValue(value: unknown, schema: Record<string, unknown>): boolean {
  if (Array.isArray(schema.enum) && !schema.enum.some((candidate) => candidate === value))
    return false;
  if (Array.isArray(schema.oneOf)) {
    if (!schema.oneOf.some((candidate) => record(candidate)?.const === value)) return false;
  }
  if (
    Array.isArray(schema.anyOf) &&
    !schema.anyOf.some((candidate) => record(candidate)?.const === value)
  )
    return false;
  if (schema.type === "string") {
    if (typeof value !== "string") return false;
    if (typeof schema.minLength === "number" && Array.from(value).length < schema.minLength)
      return false;
    if (typeof schema.maxLength === "number" && Array.from(value).length > schema.maxLength)
      return false;
    if (typeof schema.pattern === "string") {
      try {
        if (!new RegExp(schema.pattern).test(value)) return false;
      } catch {
        return false;
      }
    }
    if (schema.format === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return false;
    if (schema.format === "uri") {
      try {
        new URL(value);
      } catch {
        return false;
      }
    }
    return true;
  }
  if (schema.type === "number" || schema.type === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) return false;
    if (schema.type === "integer" && !Number.isInteger(value)) return false;
    if (typeof schema.minimum === "number" && value < schema.minimum) return false;
    if (typeof schema.maximum === "number" && value > schema.maximum) return false;
    return true;
  }
  if (schema.type === "boolean") return typeof value === "boolean";
  if (schema.type === "array") {
    if (!Array.isArray(value)) return false;
    if (typeof schema.minItems === "number" && value.length < schema.minItems) return false;
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) return false;
    if (schema.uniqueItems === true && new Set(value).size !== value.length) return false;
    const items = record(schema.items);
    return Boolean(items && value.every((item) => validateValue(item, items)));
  }
  return false;
}

/** Validate again at the server boundary; a browser form is not an authority. */
export function assertAgentInputResponse(
  schema: Record<string, unknown>,
  response: AgentInputResponse,
): void {
  if (response.action !== "accept") return;
  const properties = record(schema.properties);
  const content = response.content ?? {};
  if ((schema.type !== undefined && schema.type !== "object") || !properties)
    throw new Error("This agent requested an unsupported form.");
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const field of required) {
    if (typeof field !== "string" || !(field in content))
      throw new Error(`Answer the required field: ${String(field)}.`);
  }
  for (const [key, value] of Object.entries(content)) {
    const property = record(properties[key]);
    if (!property || !validateValue(value, property)) throw new Error(`Invalid answer for ${key}.`);
  }
}
