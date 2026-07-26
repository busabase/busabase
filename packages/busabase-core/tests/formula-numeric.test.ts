import { describe, expect, it } from "vitest";
import { evaluateFormula } from "../src/domains/base/formula";

const resolve =
  (values: Record<string, number | string | boolean | null> = {}) =>
  (slug: string) => {
    if (!(slug in values)) throw new Error(`unexpected field ref in test: ${slug}`);
    return values[slug];
  };

describe("formula numeric functions", () => {
  it("COUNT counts only numeric args", () => {
    expect(evaluateFormula('COUNT(1, "a", 2, TRUE())', resolve())).toBe(2);
    expect(evaluateFormula("COUNT(1, 2, 3)", resolve())).toBe(3);
  });

  it("COUNTA counts non-blank args of any type", () => {
    expect(evaluateFormula('COUNTA(1, "", "a", 0)', resolve())).toBe(3);
    expect(evaluateFormula('COUNTA("", "")', resolve())).toBe(0);
  });

  it("COUNTALL counts every arg including blanks", () => {
    expect(evaluateFormula('COUNTALL(1, "", 2)', resolve())).toBe(3);
    expect(evaluateFormula("COUNTALL()", resolve())).toBe(0);
  });

  it("COUNTIF counts args matching the first arg", () => {
    expect(evaluateFormula('COUNTIF("a", "a", "b", "a")', resolve())).toBe(2);
    expect(evaluateFormula('COUNTIF("z", "a", "b")', resolve())).toBe(0);
  });

  it("CEILING and FLOOR round to the nearest step", () => {
    expect(evaluateFormula("CEILING(4.1)", resolve())).toBe(5);
    expect(evaluateFormula("CEILING(4.12, 2)", resolve())).toBe(4.12);
    expect(evaluateFormula("FLOOR(4.9)", resolve())).toBe(4);
    expect(evaluateFormula("FLOOR(4.19, 1)", resolve())).toBe(4.1);
  });

  it("EVEN and ODD round outward to the nearest even/odd integer", () => {
    expect(evaluateFormula("EVEN(3)", resolve())).toBe(4);
    expect(evaluateFormula("EVEN(2)", resolve())).toBe(2);
    expect(evaluateFormula("ODD(4)", resolve())).toBe(5);
    expect(evaluateFormula("ODD(3)", resolve())).toBe(3);
  });

  it("INT floors toward negative infinity (not truncate toward zero)", () => {
    expect(evaluateFormula("INT(1.9)", resolve())).toBe(1);
    expect(evaluateFormula("INT(-1.5)", resolve())).toBe(-2);
  });

  it("MOD returns the remainder", () => {
    expect(evaluateFormula("MOD(7, 3)", resolve())).toBe(1);
    expect(evaluateFormula("MOD(-7, 3)", resolve())).toBe(2);
  });

  it("MOD throws on division by zero", () => {
    expect(() => evaluateFormula("MOD(1, 0)", resolve())).toThrow(/division by zero/i);
  });

  it("POWER, SQRT, EXP, LOG", () => {
    expect(evaluateFormula("POWER(2, 10)", resolve())).toBe(1024);
    expect(evaluateFormula("SQRT(16)", resolve())).toBe(4);
    expect(evaluateFormula("EXP(0)", resolve())).toBe(1);
    expect(evaluateFormula("LOG(100)", resolve())).toBeCloseTo(2, 10);
    expect(evaluateFormula("LOG(8, 2)", resolve())).toBeCloseTo(3, 10);
  });

  it("SQRT throws on a negative argument", () => {
    expect(() => evaluateFormula("SQRT(-1)", resolve())).toThrow(/non-negative/);
  });

  it("LOG throws on a non-positive argument", () => {
    expect(() => evaluateFormula("LOG(0)", resolve())).toThrow(/positive/);
  });
});
