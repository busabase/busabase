import { describe, expect, it } from "vitest";
import { evaluateFormula } from "../src/domains/base/formula";

const resolve =
  (values: Record<string, number | string | boolean | null> = {}) =>
  (slug: string) => {
    if (!(slug in values)) throw new Error(`unexpected field ref in test: ${slug}`);
    return values[slug];
  };

describe("formula text functions", () => {
  it("CONCATENATE joins its args as strings, same as the `&` operator", () => {
    expect(evaluateFormula('CONCATENATE("a", "b", "c")', resolve())).toBe("abc");
    expect(evaluateFormula('CONCATENATE("x", 1, TRUE())', resolve())).toBe("x1true");
    expect(evaluateFormula("CONCATENATE()", resolve())).toBe("");
  });

  it("LEFT/RIGHT/MID slice substrings", () => {
    expect(evaluateFormula('LEFT("Busabase", 4)', resolve())).toBe("Busa");
    expect(evaluateFormula('RIGHT("Busabase", 4)', resolve())).toBe("base");
    expect(evaluateFormula('MID("Busabase", 4, 3)', resolve())).toBe("aba");
  });

  it("LEFT/RIGHT with count 0 returns an empty string", () => {
    expect(evaluateFormula('LEFT("abc", 0)', resolve())).toBe("");
    expect(evaluateFormula('RIGHT("abc", 0)', resolve())).toBe("");
  });

  it("LEN returns string length", () => {
    expect(evaluateFormula('LEN("Busabase")', resolve())).toBe(8);
    expect(evaluateFormula('LEN("")', resolve())).toBe(0);
  });

  it("FIND is case-sensitive and 1-based", () => {
    expect(evaluateFormula('FIND("base", "Busabase")', resolve())).toBe(5);
    expect(() => evaluateFormula('FIND("BASE", "Busabase")', resolve())).toThrow(/not found/);
  });

  it("SEARCH is case-insensitive", () => {
    expect(evaluateFormula('SEARCH("BASE", "Busabase")', resolve())).toBe(5);
    expect(() => evaluateFormula('SEARCH("zzz", "Busabase")', resolve())).toThrow(/not found/);
  });

  it("REPLACE swaps a fixed-position range", () => {
    // "Busabase": chars 4-7 ("abas") are replaced; char 8 ("e") is untouched.
    expect(evaluateFormula('REPLACE("Busabase", 4, 4, "XXXX")', resolve())).toBe("BusXXXXe");
  });

  it("SUBSTITUTE replaces all occurrences by default, or one occurrence when given", () => {
    expect(evaluateFormula('SUBSTITUTE("a-b-a", "a", "X")', resolve())).toBe("X-b-X");
    expect(evaluateFormula('SUBSTITUTE("a-b-a", "a", "X", 2)', resolve())).toBe("a-b-X");
  });

  it("REPT repeats a string", () => {
    expect(evaluateFormula('REPT("ab", 3)', resolve())).toBe("ababab");
    expect(evaluateFormula('REPT("x", 0)', resolve())).toBe("");
  });

  it("TRIM removes outer whitespace and collapses internal runs", () => {
    expect(evaluateFormula('TRIM("  a   b  ")', resolve())).toBe("a b");
  });

  it("UPPER and LOWER change case", () => {
    expect(evaluateFormula('UPPER("busabase")', resolve())).toBe("BUSABASE");
    expect(evaluateFormula('LOWER("BUSABASE")', resolve())).toBe("busabase");
  });

  it("T returns the value only when it's already a string", () => {
    expect(evaluateFormula('T("hi")', resolve())).toBe("hi");
    expect(evaluateFormula("T(42)", resolve())).toBe("");
  });

  it("VALUE parses a numeric string", () => {
    expect(evaluateFormula('VALUE("42.5")', resolve())).toBe(42.5);
  });

  it("VALUE throws on an unparsable string", () => {
    expect(() => evaluateFormula('VALUE("not a number")', resolve())).toThrow(/cannot parse/);
  });

  it("ENCODE_URL_COMPONENT percent-encodes reserved characters", () => {
    expect(evaluateFormula('ENCODE_URL_COMPONENT("a b/c?d")', resolve())).toBe("a%20b%2Fc%3Fd");
  });
});
