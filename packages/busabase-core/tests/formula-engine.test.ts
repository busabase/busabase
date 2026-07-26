import { describe, expect, it } from "vitest";
import {
  evaluateFormula,
  FormulaSelfRefError,
  FormulaSyntaxError,
  FormulaUnknownFieldError,
  validateFormulaExpression,
} from "../src/domains/base/formula";

const resolve = (values: Record<string, number | string | boolean | null>) => (slug: string) => {
  if (!(slug in values)) throw new Error(`unexpected field ref in test: ${slug}`);
  return values[slug];
};

describe("formula engine", () => {
  it("evaluates arithmetic with correct precedence", () => {
    expect(evaluateFormula("2 + 3 * 4", resolve({}))).toBe(14);
    expect(evaluateFormula("(2 + 3) * 4", resolve({}))).toBe(20);
    expect(evaluateFormula("10 / 4", resolve({}))).toBe(2.5);
    expect(evaluateFormula("-5 + 2", resolve({}))).toBe(-3);
  });

  it("resolves field references and coerces types", () => {
    const out = evaluateFormula("{price} * {qty}", resolve({ price: 12.5, qty: 4 }));
    expect(out).toBe(50);
  });

  it("supports currency-style cross-rate math", () => {
    // price_usd + price_hkd/7.8 + price_jpy/150, rounded to 2dp
    const out = evaluateFormula(
      "ROUND({price_usd} + {price_hkd} / 7.8 + {price_jpy} / 150, 2)",
      resolve({ price_usd: 10, price_hkd: 78, price_jpy: 1500 }),
    );
    expect(out).toBe(30);
  });

  it("supports SUM/MIN/MAX/ABS/ROUND", () => {
    expect(evaluateFormula("SUM({a}, {b}, {c})", resolve({ a: 1, b: 2, c: 3 }))).toBe(6);
    expect(evaluateFormula("MIN({a}, {b})", resolve({ a: 5, b: 2 }))).toBe(2);
    expect(evaluateFormula("MAX({a}, {b})", resolve({ a: 5, b: 2 }))).toBe(5);
    expect(evaluateFormula("ABS(-7)", resolve({}))).toBe(7);
    expect(evaluateFormula("ROUND(3.14159, 2)", resolve({}))).toBe(3.14);
  });

  it("supports IF/AND/OR/NOT and comparisons", () => {
    expect(evaluateFormula('IF({a} > 10, "high", "low")', resolve({ a: 15 }))).toBe("high");
    expect(evaluateFormula('IF({a} > 10, "high", "low")', resolve({ a: 5 }))).toBe("low");
    expect(evaluateFormula("AND({a} > 0, {b} > 0)", resolve({ a: 1, b: 1 }))).toBe(true);
    expect(evaluateFormula("OR({a} > 0, {b} > 0)", resolve({ a: -1, b: 1 }))).toBe(true);
    expect(evaluateFormula("NOT({a} > 0)", resolve({ a: -1 }))).toBe(true);
  });

  it("supports string concatenation with &", () => {
    expect(
      evaluateFormula('{ticker} & " - " & {name}', resolve({ ticker: "AAPL", name: "Apple" })),
    ).toBe("AAPL - Apple");
  });

  it("throws FormulaSyntaxError on malformed expressions", () => {
    expect(() => evaluateFormula("2 +", resolve({}))).toThrow(FormulaSyntaxError);
    expect(() => evaluateFormula("(2 + 3", resolve({}))).toThrow(FormulaSyntaxError);
    expect(() => evaluateFormula("{unclosed", resolve({}))).toThrow(FormulaSyntaxError);
  });

  it("throws on division by zero", () => {
    expect(() => evaluateFormula("1 / 0", resolve({}))).toThrow(/Division by zero/);
  });

  describe("validateFormulaExpression", () => {
    const siblings = new Map([
      ["price", "number"],
      ["derived", "formula"],
    ]);

    it("passes for a valid reference to a non-formula sibling", () => {
      expect(() => validateFormulaExpression("{price} * 2", "total", siblings)).not.toThrow();
    });

    it("rejects a self-reference", () => {
      expect(() => validateFormulaExpression("{total} * 2", "total", siblings)).toThrow(
        FormulaSelfRefError,
      );
    });

    it("rejects referencing an unknown field", () => {
      expect(() => validateFormulaExpression("{nope} * 2", "total", siblings)).toThrow(
        FormulaUnknownFieldError,
      );
    });

    it("allows referencing another formula field (chaining) — cycle detection is a separate, whole-graph check", () => {
      expect(() => validateFormulaExpression("{derived} * 2", "total", siblings)).not.toThrow();
    });
  });
});
