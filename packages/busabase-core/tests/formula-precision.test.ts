import { describe, expect, it } from "vitest";
import { evaluateFormula } from "../src/domains/base/formula";

const resolve =
  (values: Record<string, number> = {}) =>
  (slug: string) => {
    if (!(slug in values)) throw new Error(`unexpected field ref in test: ${slug}`);
    return values[slug];
  };

describe("formula precision-safe arithmetic", () => {
  it("0.1 + 0.2 is exactly 0.3 through a formula (not 0.30000000000000004)", () => {
    expect(evaluateFormula("0.1 + 0.2", resolve())).toBe(0.3);
    // Sanity check this is actually testing something: raw JS float math fails here.
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it("subtraction avoids representation error the same way", () => {
    expect(evaluateFormula("1.1 - 0.2", resolve())).toBe(0.9);
  });

  it("a cents-scale multiply-then-divide chain stays exact", () => {
    // 19.99 * 3 / 3 should return exactly to 19.99, not drift.
    expect(evaluateFormula("{price} * {qty} / {qty}", resolve({ price: 19.99, qty: 3 }))).toBe(
      19.99,
    );
  });

  it("multiplication of two decimals doesn't drift", () => {
    expect(evaluateFormula("0.1 * 0.2", resolve())).toBe(0.02);
  });

  it("still throws on division by zero", () => {
    expect(() => evaluateFormula("1 / 0", resolve())).toThrow(/division by zero/i);
  });
});
