import { describe, expect, it } from "vitest";
import {
  ConversionNotSupportedError,
  convertFieldValue,
  fromText,
  toText,
} from "../src/domains/base/utils/field-conversion";
import type { FieldType } from "../src/types";

// ── helpers ──────────────────────────────────────────────────────────────────

const choices = [
  { id: "ch1", name: "Red", color: "red" },
  { id: "ch2", name: "Blue", color: "blue" },
  { id: "ch3", name: "Green", color: "green" },
];

// ── toText ────────────────────────────────────────────────────────────────────

describe("toText", () => {
  it("text → same string", () => {
    expect(toText("hello world", "text")).toBe("hello world");
  });

  it("longtext / markdown / html / code / email / url / phone → same string", () => {
    for (const t of [
      "longtext",
      "markdown",
      "html",
      "code",
      "email",
      "url",
      "phone",
    ] as FieldType[]) {
      expect(toText("value", t)).toBe("value");
    }
  });

  it("number → string", () => {
    expect(toText(42, "number")).toBe("42");
    expect(toText(3.14, "number")).toBe("3.14");
    expect(toText(0, "number")).toBe("0");
  });

  it("checkbox true → 'true'", () => {
    expect(toText(true, "checkbox")).toBe("true");
  });

  it("checkbox false → 'false'", () => {
    expect(toText(false, "checkbox")).toBe("false");
  });

  it("date → ISO 8601 string", () => {
    const result = toText("2024-03-15T10:30:00.000Z", "date");
    expect(result).toBe("2024-03-15T10:30:00.000Z");
  });

  it("select → choice label (not id)", () => {
    expect(toText("ch1", "select", { choices })).toBe("Red");
    expect(toText("ch2", "select", { choices })).toBe("Blue");
  });

  it("select with unknown id → the value itself (passthrough)", () => {
    expect(toText("unknown_id", "select", { choices })).toBe("unknown_id");
  });

  it("multiselect → comma-joined labels", () => {
    expect(toText(["ch1", "ch3"], "multiselect", { choices })).toBe("Red, Green");
  });

  it("multiselect with empty array → empty string", () => {
    expect(toText([], "multiselect", { choices })).toBe("");
  });

  it("ai_summary → same string", () => {
    expect(toText("summary text", "ai_summary")).toBe("summary text");
  });

  it("ai_tags → comma-joined", () => {
    expect(toText(["tag1", "tag2"], "ai_tags")).toBe("tag1, tag2");
  });

  it("relation → null", () => {
    expect(toText("rec_123", "relation")).toBeNull();
  });

  it("attachment → null", () => {
    expect(toText([{ id: "f1" }], "attachment")).toBeNull();
  });

  it("system fields → null", () => {
    for (const t of [
      "created_time",
      "updated_time",
      "created_by",
      "updated_by",
      "auto_number",
    ] as FieldType[]) {
      expect(toText("anything", t)).toBeNull();
    }
  });

  it("null value → null", () => {
    expect(toText(null, "text")).toBeNull();
    expect(toText(null, "number")).toBeNull();
  });
});

// ── fromText ──────────────────────────────────────────────────────────────────

describe("fromText", () => {
  // text-family: passthrough
  it("→ text: returns same string", () => {
    expect(fromText("hello", "text")).toBe("hello");
  });

  it("→ longtext / markdown / html / code: returns same string", () => {
    for (const t of ["longtext", "markdown", "html", "code"] as FieldType[]) {
      expect(fromText("content", t)).toBe("content");
    }
  });

  it("→ email: valid email passes through", () => {
    expect(fromText("user@example.com", "email")).toBe("user@example.com");
  });

  it("→ email: invalid format → null", () => {
    expect(fromText("not-an-email", "email")).toBeNull();
  });

  it("→ url: valid url passes through", () => {
    expect(fromText("https://example.com", "url")).toBe("https://example.com");
  });

  it("→ url: invalid format → null", () => {
    expect(fromText("not-a-url", "url")).toBeNull();
  });

  it("→ number: valid numeric string → number", () => {
    expect(fromText("42", "number")).toBe(42);
    expect(fromText("3.14", "number")).toBe(3.14);
    expect(fromText("0", "number")).toBe(0);
  });

  it("→ number: non-numeric → null", () => {
    expect(fromText("abc", "number")).toBeNull();
    expect(fromText("12px", "number")).toBeNull();
  });

  it("→ checkbox: 'true' → true", () => {
    expect(fromText("true", "checkbox")).toBe(true);
  });

  it("→ checkbox: '1' → true", () => {
    expect(fromText("1", "checkbox")).toBe(true);
  });

  it("→ checkbox: 'yes' → true", () => {
    expect(fromText("yes", "checkbox")).toBe(true);
  });

  it("→ checkbox: 'false' → false", () => {
    expect(fromText("false", "checkbox")).toBe(false);
  });

  it("→ checkbox: '0' → false", () => {
    expect(fromText("0", "checkbox")).toBe(false);
  });

  it("→ checkbox: empty string → false", () => {
    expect(fromText("", "checkbox")).toBe(false);
  });

  it("→ date: valid ISO string → same ISO string", () => {
    const iso = "2024-03-15T10:30:00.000Z";
    expect(fromText(iso, "date")).toBe(iso);
  });

  it("→ date: invalid string → null", () => {
    expect(fromText("garbage date", "date")).toBeNull();
    expect(fromText("not-a-date", "date")).toBeNull();
  });

  it("→ select: matching choice name → choice id", () => {
    expect(fromText("Red", "select", { choices })).toBe("ch1");
    expect(fromText("Blue", "select", { choices })).toBe("ch2");
  });

  it("→ select: case-insensitive match", () => {
    expect(fromText("red", "select", { choices })).toBe("ch1");
    expect(fromText("BLUE", "select", { choices })).toBe("ch2");
  });

  it("→ select: no match → null (conflict)", () => {
    expect(fromText("Purple", "select", { choices })).toBeNull();
  });

  it("→ multiselect: comma-split → matching ids", () => {
    const result = fromText("Red, Green", "multiselect", { choices });
    expect(result).toEqual(["ch1", "ch3"]);
  });

  it("→ multiselect: items with no match are skipped", () => {
    const result = fromText("Red, Purple, Blue", "multiselect", { choices });
    expect(result).toEqual(["ch1", "ch2"]);
  });

  it("→ multiselect: all no match → empty array", () => {
    expect(fromText("Purple, Yellow", "multiselect", { choices })).toEqual([]);
  });

  it("→ relation: throws ConversionNotSupportedError", () => {
    expect(() => fromText("rec_123", "relation")).toThrow(ConversionNotSupportedError);
  });

  it("→ attachment: throws ConversionNotSupportedError", () => {
    expect(() => fromText("file.pdf", "attachment")).toThrow(ConversionNotSupportedError);
  });

  it("→ system fields: throws ConversionNotSupportedError", () => {
    for (const t of [
      "created_time",
      "updated_time",
      "created_by",
      "updated_by",
      "auto_number",
    ] as FieldType[]) {
      expect(() => fromText("value", t)).toThrow(ConversionNotSupportedError);
    }
  });

  it("null text → null for scalar types", () => {
    expect(fromText(null, "text")).toBeNull();
    expect(fromText(null, "number")).toBeNull();
    expect(fromText(null, "checkbox")).toBeNull();
  });
});

// ── round-trips ───────────────────────────────────────────────────────────────

describe("round-trip: convertFieldValue", () => {
  it("same type → value unchanged", () => {
    expect(convertFieldValue("hello", "text", "text")).toBe("hello");
    expect(convertFieldValue(42, "number", "number")).toBe(42);
  });

  it("number → text → number preserves value", () => {
    const result = convertFieldValue(42, "number", "text");
    expect(result).toBe("42");
    const back = convertFieldValue("42", "text", "number");
    expect(back).toBe(42);
  });

  it("checkbox → text → checkbox preserves true", () => {
    const text = convertFieldValue(true, "checkbox", "text");
    expect(text).toBe("true");
    const back = convertFieldValue(text, "text", "checkbox");
    expect(back).toBe(true);
  });

  it("checkbox → text → checkbox preserves false", () => {
    const text = convertFieldValue(false, "checkbox", "text");
    expect(text).toBe("false");
    const back = convertFieldValue(text, "text", "checkbox");
    expect(back).toBe(false);
  });

  it("select → text → select preserves value when choice exists", () => {
    const text = convertFieldValue("ch1", "select", "text", { choices });
    expect(text).toBe("Red");
    const back = convertFieldValue(text, "text", "select", { choices });
    expect(back).toBe("ch1");
  });

  it("relation → any: throws ConversionNotSupportedError", () => {
    expect(() => convertFieldValue("rec_123", "relation", "text")).toThrow(
      ConversionNotSupportedError,
    );
  });

  it("any → relation: throws ConversionNotSupportedError", () => {
    expect(() => convertFieldValue("hello", "text", "relation")).toThrow(
      ConversionNotSupportedError,
    );
  });

  it("any → system field: throws ConversionNotSupportedError", () => {
    expect(() => convertFieldValue("hello", "text", "auto_number")).toThrow(
      ConversionNotSupportedError,
    );
  });

  it("null value → null for all convertible types", () => {
    expect(convertFieldValue(null, "text", "number")).toBeNull();
    expect(convertFieldValue(null, "number", "text")).toBeNull();
    expect(convertFieldValue(null, "checkbox", "text")).toBeNull();
  });
});

// ── previewConversion result shape ────────────────────────────────────────────

describe("ConversionNotSupportedError", () => {
  it("has fromType and toType properties", () => {
    const err = new ConversionNotSupportedError("relation", "text");
    expect(err.fromType).toBe("relation");
    expect(err.toType).toBe("text");
    expect(err.message).toContain("relation");
  });
});
