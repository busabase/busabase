import { describe, expect, it } from "vitest";
import {
  FIELD_TYPE_ORDER,
  FIELD_TYPES,
  fieldCategory,
  fieldColumnWidth,
  fieldDisplayKind,
  fieldInputKind,
  fieldLabel,
  fieldLinkPrefix,
  isAiFieldType,
  isHiddenOnCreate,
  isSystemFieldType,
  SYSTEM_FIELD_TYPES,
} from "../src/domains/base/field-types";
import type { FieldType } from "../src/types";

const ALL_FIELD_TYPES = Object.keys(FIELD_TYPES) as FieldType[];

const VALID_INPUT_KINDS = new Set([
  "text",
  "textarea",
  "number",
  "date",
  "url",
  "embed",
  "email",
  "tel",
  "checkbox",
  "select",
  "multiselect",
  "relation",
  "attachment",
  "tags",
  "computed",
]);

describe("FIELD_TYPES registry — complete & well-formed for every field type", () => {
  it("has exactly 25 field types", () => {
    expect(ALL_FIELD_TYPES).toHaveLength(25);
  });

  it("structured text fields validate their syntax and reuse code display", () => {
    const jsonDef = { slug: "data", type: "json", name: "Data" } as never;
    const jsonValidate = FIELD_TYPES.json.validate;
    expect(jsonValidate?.('{"ok":true}', jsonDef)).toBeNull();
    expect(jsonValidate?.("[1,2,3]", jsonDef)).toBeNull();
    expect(jsonValidate?.("{bad json", jsonDef)).toMatch(/valid JSON/);
    expect(jsonValidate?.(42, jsonDef)).toMatch(/must be text/);
    expect(fieldDisplayKind("json")).toBe("code");

    const yamlDef = { slug: "config", type: "yaml", name: "Config" } as never;
    const yamlValidate = FIELD_TYPES.yaml.validate;
    expect(yamlValidate?.("ok: true\nitems:\n  - 1", yamlDef)).toBeNull();
    expect(yamlValidate?.("bad: [", yamlDef)).toMatch(/valid YAML/);
    expect(yamlValidate?.(42, yamlDef)).toMatch(/must be text/);
    expect(fieldDisplayKind("yaml")).toBe("code");

    const codeJsonDef = {
      slug: "payload",
      type: "code",
      name: "Payload",
      options: { code: { language: "json" } },
    } as never;
    const codeYamlDef = {
      slug: "config",
      type: "code",
      name: "Config",
      options: { code: { language: "yaml" } },
    } as never;
    const codeTsDef = {
      slug: "snippet",
      type: "code",
      name: "Snippet",
      options: { code: { language: "typescript" } },
    } as never;
    expect(FIELD_TYPES.code.validate?.('{"ok":true}', codeJsonDef)).toBeNull();
    expect(FIELD_TYPES.code.validate?.("{bad json", codeJsonDef)).toMatch(/valid JSON/);
    expect(FIELD_TYPES.code.validate?.("ok: true", codeYamlDef)).toBeNull();
    expect(FIELD_TYPES.code.validate?.("bad: [", codeYamlDef)).toMatch(/valid YAML/);
    expect(FIELD_TYPES.code.validate?.("{bad json", codeTsDef)).toBeNull();
    expect(FIELD_TYPES.code.validate?.("bad: [", codeTsDef)).toBeNull();
  });

  it.each(ALL_FIELD_TYPES)("%s has a consistent, well-formed spec", (type) => {
    const spec = FIELD_TYPES[type];
    expect(spec.type).toBe(type); // key matches its own type
    expect(spec.label.trim().length).toBeGreaterThan(0);
    expect(VALID_INPUT_KINDS.has(spec.input)).toBe(true);
    expect(spec.columnWidth).toMatch(/^minmax\(/);
    // Helpers agree with the spec.
    expect(fieldLabel(type)).toBe(spec.label);
    expect(fieldInputKind(type)).toBe(spec.input);
    expect(fieldColumnWidth(type)).toBe(spec.columnWidth);
  });

  it("system field types are exactly those with a compute fn", () => {
    for (const type of ALL_FIELD_TYPES) {
      expect(isSystemFieldType(type)).toBe(Boolean(FIELD_TYPES[type].compute));
    }
    expect([...SYSTEM_FIELD_TYPES].sort()).toEqual(
      ["auto_number", "created_by", "created_time", "updated_by", "updated_time"].sort(),
    );
  });

  it("system fields render read-only (input = computed); none are editable", () => {
    for (const type of SYSTEM_FIELD_TYPES) {
      expect(FIELD_TYPES[type].input).toBe("computed");
    }
  });

  it("categorizes fields as input / system / ai consistently", () => {
    const aiTypes = ["ai_summary", "ai_tags"];
    for (const type of ALL_FIELD_TYPES) {
      const expected = isSystemFieldType(type) ? "system" : aiTypes.includes(type) ? "ai" : "input";
      expect(fieldCategory(type)).toBe(expected);
      expect(isAiFieldType(type)).toBe(aiTypes.includes(type));
      // System + AI fields are hidden on create; user-input fields are not.
      expect(isHiddenOnCreate(type)).toBe(expected !== "input");
    }
  });

  it("AI fields are editable (not computed) and overridable", () => {
    expect(fieldInputKind("ai_summary")).toBe("textarea");
    expect(fieldInputKind("ai_tags")).toBe("tags");
    expect(isSystemFieldType("ai_summary")).toBe(false);
    expect(isSystemFieldType("ai_tags")).toBe(false);
  });

  it("maps every field type to a valid display kind", () => {
    const validKinds = new Set([
      "checkbox",
      "chips",
      "attachment",
      "relation",
      "markdown",
      "html",
      "code",
      "embed",
      "link",
      "plain",
    ]);
    for (const type of ALL_FIELD_TYPES) {
      expect(validKinds.has(fieldDisplayKind(type)), `${type} display kind`).toBe(true);
    }
    // Spot-check the cross-type groupings the components rely on.
    expect(["select", "multiselect", "ai_tags"].map(fieldDisplayKind)).toEqual([
      "chips",
      "chips",
      "chips",
    ]);
    expect(["url", "email", "phone"].map(fieldDisplayKind)).toEqual(["link", "link", "link"]);
    expect(fieldDisplayKind("embed")).toBe("embed");
    expect(fieldDisplayKind("text")).toBe("plain");
  });

  it("link fields carry the right href prefix", () => {
    expect(fieldLinkPrefix("url")).toBe("");
    expect(fieldLinkPrefix("email")).toBe("mailto:");
    expect(fieldLinkPrefix("phone")).toBe("tel:");
    expect(fieldLinkPrefix("text")).toBe(""); // non-link → no prefix
  });

  it("FIELD_TYPE_ORDER lists every field type exactly once", () => {
    expect([...FIELD_TYPE_ORDER].sort()).toEqual([...ALL_FIELD_TYPES].sort());
    expect(new Set(FIELD_TYPE_ORDER).size).toBe(FIELD_TYPE_ORDER.length);
  });

  it("every non-system, non-attachment type can validate a value", () => {
    // attachment has no shape rule by design; system fields are never validated.
    for (const type of ALL_FIELD_TYPES) {
      if (isSystemFieldType(type) || type === "attachment") continue;
      expect(typeof FIELD_TYPES[type].validate, `${type} validate`).toBe("function");
    }
  });
});
