import { describe, expect, it } from "vitest";
import { compileGrepPattern } from "../src/domains/assets/logic/asset-grep-logic";

/**
 * Regression coverage: `CATASTROPHIC_PATTERN_HINT` only ever caught a
 * quantified group directly re-quantified (`(a+)+`) — it missed the other
 * classic catastrophic-backtracking shape, alternation with overlapping
 * branches under a quantifier (`(a|a)*`, `(a|aa)*`), which `compileGrepPattern`
 * used to happily accept.
 */
describe("compileGrepPattern — catastrophic-backtracking guard", () => {
  it("still rejects the original quantified-group-requantified shape", () => {
    expect(() => compileGrepPattern("(a+)+")).toThrow(/backtracking/i);
    expect(() => compileGrepPattern("(a*)*")).toThrow(/backtracking/i);
  });

  it("rejects an overlapping-alternation quantified group with identical branches", () => {
    expect(() => compileGrepPattern("(a|a)*")).toThrow(/backtracking/i);
  });

  it("rejects an overlapping-alternation quantified group with a prefix relationship", () => {
    expect(() => compileGrepPattern("(a|aa)*")).toThrow(/backtracking/i);
    expect(() => compileGrepPattern("(x|xx)+")).toThrow(/backtracking/i);
  });

  it("does not false-positive on an ordinary quantified alternation with disjoint branches", () => {
    expect(() => compileGrepPattern("(cat|dog)*")).not.toThrow();
    expect(() => compileGrepPattern("(foo|bar){2,5}")).not.toThrow();
    expect(() => compileGrepPattern("(https?|ftp)")).not.toThrow();
  });
});
