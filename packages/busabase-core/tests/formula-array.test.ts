import { describe, expect, it } from "vitest";
import { evaluateFormula } from "../src/domains/base/formula";

type Value = number | string | boolean | Value[] | null;
const resolve =
  (values: Record<string, Value> = {}) =>
  (slug: string) => {
    if (!(slug in values)) throw new Error(`unexpected field ref in test: ${slug}`);
    return values[slug];
  };

describe("formula array functions", () => {
  it("ARRAYJOIN joins with a default or custom separator", () => {
    expect(evaluateFormula("ARRAYJOIN({tags})", resolve({ tags: ["a", "b", "c"] }))).toBe(
      "a, b, c",
    );
    expect(evaluateFormula('ARRAYJOIN({tags}, "|")', resolve({ tags: ["a", "b"] }))).toBe("a|b");
  });

  it("ARRAYJOIN on an empty array returns an empty string", () => {
    expect(evaluateFormula("ARRAYJOIN({tags})", resolve({ tags: [] }))).toBe("");
  });

  it("ARRAYUNIQUE de-duplicates while preserving first-seen order", () => {
    expect(
      evaluateFormula("ARRAYUNIQUE({tags})", resolve({ tags: ["a", "b", "a", "c", "b"] })),
    ).toEqual(["a", "b", "c"]);
  });

  it("ARRAYCOMPACT drops blank entries", () => {
    expect(evaluateFormula("ARRAYCOMPACT({tags})", resolve({ tags: ["a", "", "b", ""] }))).toEqual([
      "a",
      "b",
    ]);
  });

  it("ARRAYFLATTEN flattens nested arrays across all args", () => {
    expect(
      evaluateFormula("ARRAYFLATTEN({a}, {b})", resolve({ a: ["x", ["y", "z"]], b: ["w"] })),
    ).toEqual(["x", "y", "z", "w"]);
  });

  it("array functions reject a non-array argument", () => {
    expect(() => evaluateFormula("ARRAYJOIN({tags})", resolve({ tags: "not-an-array" }))).toThrow(
      /expected an array/,
    );
  });
});
