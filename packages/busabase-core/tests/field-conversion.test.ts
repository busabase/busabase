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

  it("longtext / markdown / html / code / json / yaml / email / url / phone → same string", () => {
    for (const t of [
      "longtext",
      "markdown",
      "html",
      "code",
      "json",
      "yaml",
      "email",
      "url",
      "embed",
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

  it("→ longtext / markdown / html / code / json / yaml: returns same string", () => {
    for (const t of ["longtext", "markdown", "html", "code", "json", "yaml"] as FieldType[]) {
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

  it("→ embed: valid http(s) url passes through", () => {
    expect(fromText("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "embed")).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
  });

  it("→ embed: invalid format → null", () => {
    expect(fromText("not-a-url", "embed")).toBeNull();
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

// ── edge branches (audit follow-up: full per-type coverage) ───────────────────

describe("toText edge branches", () => {
  it("date → Date instance serialized to ISO", () => {
    const d = new Date("2026-03-01T10:00:00.000Z");
    expect(toText(d, "date")).toBe("2026-03-01T10:00:00.000Z");
  });

  it("date → non-string/non-Date value stringified", () => {
    expect(toText(1740823200000, "date")).toBe("1740823200000");
  });

  it("select → non-string value stringified", () => {
    expect(toText(42, "select", { choices })).toBe("42");
  });

  it("select → without choices the raw value passes through", () => {
    expect(toText("ch1", "select")).toBe("ch1");
  });

  it("multiselect → non-array value stringified", () => {
    expect(toText("solo", "multiselect", { choices })).toBe("solo");
  });

  it("multiselect → without choices joins the raw ids", () => {
    expect(toText(["a", "b"], "multiselect")).toBe("a, b");
  });

  it("multiselect → unknown ids kept verbatim among labels", () => {
    expect(toText(["ch1", "ghost"], "multiselect", { choices })).toBe("Red, ghost");
  });

  it("ai_tags → non-array value stringified", () => {
    expect(toText(99, "ai_tags")).toBe("99");
  });
});

describe("fromText edge branches", () => {
  it("→ ai_summary: passthrough", () => {
    expect(fromText("summary text", "ai_summary")).toBe("summary text");
  });

  it("→ phone: valid number passes, garbage → null", () => {
    expect(fromText("+1 (555) 123-4567", "phone")).toBe("+1 (555) 123-4567");
    expect(fromText("abc", "phone")).toBeNull();
  });

  it("→ number: empty/whitespace string → null", () => {
    expect(fromText("", "number")).toBeNull();
    expect(fromText("   ", "number")).toBeNull();
  });

  it("→ date: empty string → null", () => {
    expect(fromText("", "date")).toBeNull();
  });

  it("→ select: without choices → null", () => {
    expect(fromText("Red", "select")).toBeNull();
  });

  it("→ multiselect: empty string → empty array", () => {
    expect(fromText("", "multiselect", { choices })).toEqual([]);
  });

  it("→ multiselect: without choices returns trimmed parts", () => {
    expect(fromText("one, two , ,three", "multiselect")).toEqual(["one", "two", "three"]);
  });

  it("→ ai_tags: comma-split into trimmed tags", () => {
    expect(fromText("alpha, beta ,, gamma", "ai_tags")).toEqual(["alpha", "beta", "gamma"]);
  });

  it("→ ai_tags: empty string → empty array", () => {
    expect(fromText("", "ai_tags")).toEqual([]);
  });
});

describe("convertFieldValue edge branches", () => {
  it("system source type → throws", () => {
    expect(() => convertFieldValue("2026-01-01", "created_time", "text")).toThrow(
      ConversionNotSupportedError,
    );
  });

  it("attachment source type → throws", () => {
    expect(() => convertFieldValue([], "attachment", "text")).toThrow(ConversionNotSupportedError);
  });
});
