import { describe, expect, it } from "vitest";
import { computeSystemFieldValues } from "../src/domains/base/field-rules";
import type { FieldDef } from "../src/domains/base/field-types";
import { FORMULA_CATALOG } from "../src/domains/base/formula/catalog";
import { formatFormulaValue, previewFormulaField } from "../src/domains/base/formula/field-preview";
import { FORMULA_FUNCTIONS } from "../src/domains/base/formula/functions";
import { evaluateFormula, validateFormulaExpression } from "../src/domains/base/formula/index";

const fields: FieldDef[] = [
  { slug: "price", name: "Price", type: "number" },
  { slug: "quantity", name: "Quantity", type: "number" },
  { slug: "tags", name: "Tags", type: "multiselect" },
  { slug: "date", name: "Date", type: "date" },
  {
    slug: "subtotal",
    name: "Subtotal",
    type: "formula",
    options: { formula: { expression: "{price} * {quantity}" } },
  },
];
const preview = (expression: string, values: Record<string, unknown> = {}) =>
  previewFormulaField({ expression, slug: "total", fields, values });

describe("formula field delivery", () => {
  it("catalog covers every supported function including interpreter-only functions", () => {
    const expected = [
      ...Object.keys(FORMULA_FUNCTIONS),
      "ISERROR",
      "IS_ERROR",
      "RECORD_ID",
      "CREATED_TIME",
      "LAST_MODIFIED_TIME",
    ].sort();
    expect(FORMULA_CATALOG.map(({ name }) => name).sort()).toEqual(expected);
    expect(new Set(FORMULA_CATALOG.map(({ name }) => name)).size).toBe(FORMULA_CATALOG.length);
  });

  it("catalog examples parse and obey their documented argument counts", () => {
    for (const entry of FORMULA_CATALOG) {
      expect(() => validateFormulaExpression(entry.example, "total", new Map())).not.toThrow();
      // ERROR intentionally fails; examples depending on current time are not value snapshots.
      if (entry.name !== "ERROR")
        expect(() => evaluateFormula(entry.example, () => null)).not.toThrow();
    }
  });

  it("catalog arity limits match the runtime for every supported call", () => {
    for (const entry of FORMULA_CATALOG) {
      const invalidCounts = [
        ...(entry.minArgs > 0 ? [entry.minArgs - 1] : []),
        ...(Number.isFinite(entry.maxArgs) ? [entry.maxArgs + 1] : []),
      ];
      for (const count of invalidCounts) {
        const expression = `${entry.name}(${Array.from({ length: count }, () => "1").join(",")})`;
        expect(() => validateFormulaExpression(expression, "total", new Map())).toThrow(/expected/);
        expect(() => evaluateFormula(expression, () => null)).toThrow(/expected/);
      }
    }
  });

  it("rejects unknown functions and wrong argument counts before a record exists", () => {
    expect(preview("NOPE(1)").error).toMatch(/Unknown function/);
    expect(preview("ROUND()").error).toMatch(/expected 1-2/);
    expect(preview("RECORD_ID(1)").error).toMatch(/expected 0/);
    expect(preview("IF(TRUE(), 1, NOPE())").error).toMatch(/Unknown function/);
  });

  it("distinguishes legitimate blank results from calculation errors", () => {
    expect(preview("BLANK()")).toEqual({ value: null });
    expect(preview("1 / 0")).toEqual({ value: null, error: "Division by zero" });
    expect(preview("POWER(10, 1000)").error).toMatch(/finite/);
  });

  it("rejects runaway date and text calculations without freezing the editor", () => {
    expect(preview("WORKDAY(TODAY(), POWER(10, 1000))").error).toMatch(/finite/);
    expect(preview("WORKDAY(TODAY(), 1000000)").error).toMatch(/calculation limit/);
    expect(
      preview('WORKDAY_DIFF(DATETIME_PARSE("1000-01-01"), DATETIME_PARSE("9999-01-01"))').error,
    ).toMatch(/calculation limit/);
    expect(preview('REPT("test", 10000000)').error).toMatch(/calculation limit/);
    expect(preview("DATESTR(POWER(10, 1000))").error).toMatch(/expected a date/);
  });

  it("bounds oversized and deeply nested expressions with actionable errors", () => {
    expect(preview(`"${"a".repeat(10_001)}"`).error).toMatch(/10000-character/);
    expect(preview(`${"(".repeat(65)}1${")".repeat(65)}`).error).toMatch(/64-level/);
    expect(preview(`${"-".repeat(65)}1`).error).toMatch(/64-level/);
    expect(preview(Array.from({ length: 1_025 }, () => "1").join("+")).error).toMatch(/2048-token/);
  });

  it("accepts expressions exactly at documented length, token and nesting limits", () => {
    expect(preview(`"${"a".repeat(9_998)}"`).value).toHaveLength(9_998);
    expect(preview(`${"(".repeat(64)}1${")".repeat(64)}`)).toEqual({ value: 1 });
    expect(preview(Array.from({ length: 1_024 }, () => "1").join("+"))).toEqual({ value: 1_024 });
    expect(preview('REPT("x", 1000000)').value).toHaveLength(1_000_000);
  });

  it("uses the write path's numeric, array and date coercion", () => {
    expect(preview("{price} * {quantity}", { price: "12.5", quantity: 2 }).value).toBe(25);
    expect(preview('ARRAYJOIN({tags}, ";")', { tags: ["a", "b"] }).value).toBe("a;b");
    expect(preview('DATEADD({date}, 1, "days")', { date: "2026-01-01" }).value).toBe(
      "2026-01-02T00:00:00.000Z",
    );
  });

  it("recalculates chained formulas from source values instead of stale stored results", () => {
    const values = { price: 12.5, quantity: 2, subtotal: 999 };
    const formula = {
      slug: "total",
      name: "Total",
      type: "formula" as const,
      options: { formula: { expression: "{subtotal} + 5" } },
    };
    const defs = [...fields, formula];
    const result = previewFormulaField({
      expression: formula.options.formula.expression,
      slug: formula.slug,
      fields: defs,
      values,
    });
    const stored = computeSystemFieldValues({
      defs,
      values,
      mode: "update",
      actorId: "actor",
      timestampIso: "2026-01-01T00:00:00.000Z",
    });
    expect(result).toEqual({ value: 30 });
    expect(stored.total).toBe(result.value);
  });

  it("propagates dependency errors instead of interpreting their null result as zero", () => {
    const defs: FieldDef[] = [
      ...fields,
      {
        slug: "broken",
        name: "Broken",
        type: "formula",
        options: { formula: { expression: "1 / 0" } },
      },
    ];
    expect(
      previewFormulaField({
        expression: "{broken} + 1",
        slug: "total",
        fields: defs,
        values: { broken: null },
      }).error,
    ).toMatch(/zero/);
    const stored = computeSystemFieldValues({
      defs: [
        ...defs,
        {
          slug: "total",
          name: "Total",
          type: "formula",
          options: { formula: { expression: "{broken} + 1" } },
        },
      ],
      mode: "update",
      actorId: "actor",
      timestampIso: "2026-01-01T00:00:00.000Z",
    });
    expect(stored.total).toBeNull();
  });

  it("recovers a chained error when source data is repaired and recognizes invalid dependency results", () => {
    const defs: FieldDef[] = [
      ...fields,
      {
        slug: "rate",
        name: "Rate",
        type: "formula",
        options: { formula: { expression: "{price} / {quantity}" } },
      },
      {
        slug: "total",
        name: "Total",
        type: "formula",
        options: { formula: { expression: "{rate} * 2" } },
      },
      {
        slug: "infinite",
        name: "Infinite",
        type: "formula",
        options: { formula: { expression: "POWER(10, 1000)" } },
      },
      {
        slug: "invalid_date",
        name: "Invalid date",
        type: "formula",
        options: { formula: { expression: 'DATEADD({date}, POWER(10, 100), "days")' } },
      },
    ];
    const args = {
      expression: "{rate} * 2",
      slug: "total",
      fields: defs,
      values: { price: 12, quantity: 0 },
    };
    expect(previewFormulaField(args).error).toBe("Division by zero");
    const repaired = { ...args, values: { price: 12, quantity: 3, rate: null } };
    expect(previewFormulaField(repaired)).toEqual({ value: 8 });
    expect(
      computeSystemFieldValues({
        defs,
        values: repaired.values,
        mode: "update",
        actorId: "actor",
        timestampIso: "2026-01-01T00:00:00.000Z",
      }).total,
    ).toBe(8);
    expect(previewFormulaField({ ...args, expression: "ISERROR({infinite})" })).toEqual({
      value: true,
    });
    expect(previewFormulaField({ ...args, expression: "T({infinite})" }).error).toMatch(/finite/);
    expect(
      previewFormulaField({
        ...args,
        expression: "ISERROR({invalid_date})",
        values: { date: "2026-01-01" },
      }),
    ).toEqual({ value: true });
    expect(
      previewFormulaField({
        ...args,
        expression: "T({invalid_date})",
        values: { date: "2026-01-01" },
      }).error,
    ).toMatch(/valid date/);
  });

  it("keeps stable slug references when display names are renamed or localized", () => {
    const values = { price: 12.5, quantity: 2 };
    const renamed = fields.map((field) => ({
      ...field,
      name: { en: `Renamed ${field.slug}`, "zh-CN": `重命名 ${field.slug}` },
    }));
    expect(
      previewFormulaField({
        expression: "{price} * {quantity}",
        slug: "total",
        fields: renamed,
        values,
      }),
    ).toEqual({ value: 25 });
    expect(
      previewFormulaField({ expression: "{Renamed price}", slug: "total", fields: renamed, values })
        .error,
    ).toMatch(/Unknown field/);
    expect(values).toEqual({ price: 12.5, quantity: 2 });
  });

  it("uses record context for metadata functions", () => {
    const args = {
      slug: "total",
      fields,
      values: {},
      recordId: "rec-123",
      createdAtIso: "2026-01-01T00:00:00.000Z",
      updatedAtIso: "2026-02-01T00:00:00.000Z",
    };
    expect(previewFormulaField({ ...args, expression: "RECORD_ID()" }).value).toBe("rec-123");
    expect(previewFormulaField({ ...args, expression: "CREATED_TIME()" }).value).toBe(
      args.createdAtIso,
    );
    expect(previewFormulaField({ ...args, expression: "LAST_MODIFIED_TIME()" }).value).toBe(
      args.updatedAtIso,
    );
  });

  it("rejects missing fields, self references and dependency cycles", () => {
    expect(preview("{absent}").error).toMatch(/Unknown field/);
    expect(preview("{total}").error).toMatch(/itself/);
    const defs: FieldDef[] = [
      { slug: "a", name: "A", type: "formula", options: { formula: { expression: "{b}" } } },
    ];
    expect(
      previewFormulaField({ expression: "{a}", slug: "b", fields: defs, values: {} }).error,
    ).toMatch(/cycle/);
  });
});

describe("formula result display", () => {
  it("formats numbers, currencies and percentages without modifying input values", () => {
    const value = 0.125;
    expect(formatFormulaValue(value, { format: "percent", precision: 1 }, "en-US")).toBe("12.5%");
    expect(
      formatFormulaValue(12.5, { format: "currency", currency: "USD", precision: 2 }, "en-US"),
    ).toBe("$12.50");
    expect(formatFormulaValue(12.5, { format: "number", precision: 3 }, "en-US")).toBe("12.500");
    expect(value).toBe(0.125);
  });

  it("preserves other result types and formats dates deterministically in UTC", () => {
    expect(formatFormulaValue(null)).toBe("");
    expect(formatFormulaValue(false)).toBe("false");
    expect(formatFormulaValue("hello", { format: "currency" })).toBe("hello");
    expect(formatFormulaValue([1, "two", true])).toBe("1, two, true");
    expect(formatFormulaValue("2026-01-01T00:00:00.000Z", { format: "date" }, "en-US")).toBe(
      "1/1/2026",
    );
  });

  it("keeps timestamps and day calculations stable across offsets and daylight-saving boundaries", () => {
    const expression = 'DATEADD({date}, 1, "days")';
    const timestamp = "2026-03-08T01:30:00-08:00";
    expect(preview(expression, { date: timestamp })).toEqual({ value: "2026-03-09T09:30:00.000Z" });
    expect(preview("DATESTR({date})", { date: "2026-01-01T00:30:00+08:00" })).toEqual({
      value: "2025-12-31",
    });
    expect(formatFormulaValue("2026-01-01T00:30:00+08:00", { format: "date" }, "en-US")).toBe(
      "12/31/2025",
    );
    expect(preview("DATESTR({date})", { date: "2026-01-01" })).toEqual({ value: "2026-01-01" });
  });

  it("preserves every primitive stored value while readers choose different display locales", () => {
    const values = Object.freeze([12.345, "plain text", false, null, "2026-01-01T00:00:00.000Z"]);
    const formats = ["auto", "number", "currency", "percent", "date"] as const;
    for (const format of formats) {
      for (const value of values) {
        expect(() =>
          formatFormulaValue(value, { format, precision: 2, currency: "CNY" }, "zh-CN"),
        ).not.toThrow();
        expect(() =>
          formatFormulaValue(value, { format, precision: 2, currency: "EUR" }, "de-DE"),
        ).not.toThrow();
      }
    }
    expect(values).toEqual([12.345, "plain text", false, null, "2026-01-01T00:00:00.000Z"]);
    expect(formatFormulaValue(12.345, { format: "number", precision: 2 }, "de-DE")).toBe("12,35");
    expect(formatFormulaValue(12.345, { format: "number", precision: 2 }, "not_a_locale")).toBe(
      "12.345",
    );
  });
});
