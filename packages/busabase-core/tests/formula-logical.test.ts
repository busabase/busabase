import { describe, expect, it } from "vitest";
import { evaluateFormula } from "../src/domains/base/formula";

const resolve =
  (values: Record<string, number | string | boolean | null> = {}) =>
  (slug: string) => {
    if (!(slug in values)) throw new Error(`unexpected field ref in test: ${slug}`);
    return values[slug];
  };

describe("formula logical functions", () => {
  it("SWITCH matches a case and falls back to the trailing default", () => {
    expect(evaluateFormula('SWITCH("b", "a", 1, "b", 2, "c", 3)', resolve())).toBe(2);
    expect(evaluateFormula('SWITCH("z", "a", 1, "b", 2, "default")', resolve())).toBe("default");
  });

  it("SWITCH returns null when nothing matches and there's no default", () => {
    expect(evaluateFormula('SWITCH("z", "a", 1, "b", 2)', resolve())).toBeNull();
  });

  it("XOR is true when an odd number of args are truthy", () => {
    expect(evaluateFormula("XOR(TRUE(), FALSE())", resolve())).toBe(true);
    expect(evaluateFormula("XOR(TRUE(), TRUE())", resolve())).toBe(false);
    expect(evaluateFormula("XOR(TRUE(), TRUE(), TRUE())", resolve())).toBe(true);
  });

  it("ERROR raises a formula error with the given message", () => {
    expect(() => evaluateFormula('ERROR("boom")', resolve())).toThrow("boom");
    expect(() => evaluateFormula("ERROR()", resolve())).toThrow();
  });

  it("BLANK returns null", () => {
    expect(evaluateFormula("BLANK()", resolve())).toBeNull();
  });

  it("TRUE and FALSE return their boolean literal", () => {
    expect(evaluateFormula("TRUE()", resolve())).toBe(true);
    expect(evaluateFormula("FALSE()", resolve())).toBe(false);
  });

  it("ISERROR/IS_ERROR catch a thrown formula error without propagating it", () => {
    expect(evaluateFormula("ISERROR(1/0)", resolve())).toBe(true);
    expect(evaluateFormula("ISERROR(1+1)", resolve())).toBe(false);
    expect(evaluateFormula("IS_ERROR(SQRT(-1))", resolve())).toBe(true);
  });

  it("ISERROR does not swallow errors from OUTSIDE its own argument", () => {
    // The outer SUM's own bad arg count should still throw normally — only the
    // ISERROR-wrapped sub-expression's errors are caught.
    expect(() => evaluateFormula("SUM(ISERROR(1/0), NOPE())", resolve())).toThrow(
      /Unknown function/,
    );
  });
});
