import { describe, expect, it } from "vitest";
import { isLiteralPattern } from "../src/domains/assets/logic/asset-grep-logic";

/**
 * Unit coverage for `isLiteralPattern` — the single gate that decides whether
 * a grep `pattern` is safe to hand to `rg -F` (fixed-strings). ANY false
 * negative here (a pattern with real regex semantics wrongly classified as
 * literal) would silently change search results, since `rg`'s regex engine
 * is not identical to JS's — so this is deliberately exhaustive about the
 * exact JS-regex metacharacter set: `. ^ $ * + ? ( ) [ ] { } | \`.
 */
describe("isLiteralPattern", () => {
  it("treats plain alphanumeric/space strings as literal", () => {
    expect(isLiteralPattern("hello world")).toBe(true);
    expect(isLiteralPattern("ACME Corp")).toBe(true);
    expect(isLiteralPattern("order-2024")).toBe(true);
    expect(isLiteralPattern("你好世界")).toBe(true);
    expect(isLiteralPattern("user@examplecom")).toBe(true);
  });

  it("treats an empty string as literal (no metacharacters present)", () => {
    expect(isLiteralPattern("")).toBe(true);
  });

  it("rejects every individual JS regex metacharacter as non-literal", () => {
    const metacharacters = [".", "^", "$", "*", "+", "?", "(", ")", "[", "]", "{", "}", "|", "\\"];
    for (const char of metacharacters) {
      expect(isLiteralPattern(char), `expected "${char}" to be non-literal`).toBe(false);
    }
  });

  it("rejects a string that is ONLY a metacharacter", () => {
    expect(isLiteralPattern("*")).toBe(false);
    expect(isLiteralPattern("\\")).toBe(false);
  });

  it("rejects a mostly-literal string with one embedded metacharacter", () => {
    expect(isLiteralPattern("user@example.com")).toBe(false); // "."
    expect(isLiteralPattern("^order-\\d+")).toBe(false); // "^", "\\", "+"
    expect(isLiteralPattern("(cat|dog)")).toBe(false);
    expect(isLiteralPattern("a[bc]")).toBe(false);
    expect(isLiteralPattern("a{2,5}")).toBe(false);
    expect(isLiteralPattern("C:\\Users")).toBe(false);
  });

  it("does not false-positive on characters that merely resemble metacharacters in appearance", () => {
    // Full-width / CJK punctuation is NOT a JS regex metacharacter.
    expect(isLiteralPattern("你好，世界！")).toBe(true);
    expect(isLiteralPattern("100% done")).toBe(true);
    expect(isLiteralPattern("A&B, C#D")).toBe(true);
  });
});
