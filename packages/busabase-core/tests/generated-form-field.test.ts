import type { FieldType, FormBoundFieldVO } from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import { generatedFormControlKind } from "../src/domains/form/components/generated-form-field";

const field = (type: FieldType): FormBoundFieldVO => ({
  slug: type,
  name: type,
  type,
  choices: [],
});

describe("generatedFormControlKind", () => {
  it.each([
    ["text", "text"],
    ["longtext", "textarea"],
    ["number", "number"],
    ["date", "date"],
    ["checkbox", "checkbox"],
    ["select", "select"],
    ["multiselect", "multiselect"],
    ["url", "url"],
    ["email", "email"],
    ["phone", "tel"],
  ] satisfies Array<[FieldType, string]>)('maps Base field type "%s" to "%s"', (type, kind) => {
    expect(generatedFormControlKind(field(type))).toBe(kind);
  });

  it("uses a text control while Base metadata is unavailable", () => {
    expect(generatedFormControlKind()).toBe("text");
  });
});
