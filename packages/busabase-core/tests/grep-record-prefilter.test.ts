import { describe, expect, it } from "vitest";
import { deriveRecordPrefilter } from "../src/logic/grep-record-prefilter";
import { compileGrepPattern } from "../src/logic/text-scan-core";

/**
 * Unit coverage for the records-grep prefilter derivation, one block per rule
 * in `logic/grep-record-prefilter.ts`'s module doc. A token handed to Postgres
 * that the flattened text can contain but `payload::text` cannot would make
 * grep silently miss a record — so every rule is pinned from the unsafe side
 * ("gets no prefilter") as well as the safe one.
 */

const derive = (pattern: string, flags = "") =>
  deriveRecordPrefilter(pattern, compileGrepPattern(pattern, flags));

const tokensOf = (pattern: string, flags = "") => derive(pattern, flags)?.tokens ?? null;

describe("deriveRecordPrefilter", () => {
  it("rule 1: a pure literal or a top-level alternation of literals gets tokens", () => {
    expect(derive("quarterly plan")).toEqual({
      tokens: ["quarterly plan"],
      caseInsensitive: false,
    });
    expect(tokensOf("alpha|beta|gamma")).toEqual(["alpha", "beta", "gamma"]);
    expect(tokensOf("项目周报")).toEqual(["项目周报"]);
    // A token containing a shorter one adds nothing; duplicates collapse.
    expect(tokensOf("foobar|foo|foo")).toEqual(["foo"]);
    expect(tokensOf("Plan|plan", "i")).toEqual(["plan"]);
  });

  it("rule 1: any regex syntax, or an empty alternative, gets no prefilter", () => {
    for (const pattern of [
      "foo.bar",
      "foo\\.bar",
      "^foo",
      "foo$",
      "a[bc]",
      "(cat|dog)",
      "colou?r",
      "a+",
      "\\bword\\b",
      "foo|ba.r",
      "foo|",
      "|foo",
      "a||b",
      "|",
    ]) {
      expect(derive(pattern), pattern).toBeNull();
    }
  });

  it("rule 2: honours only the flags compileGrepPattern keeps", () => {
    expect(derive("Invoice", "i")).toEqual({ tokens: ["invoice"], caseInsensitive: true });
    // compileGrepPattern drops g/m/s/y, so these compile to a plain /i regex.
    expect(derive("Invoice", "gimsy")).toEqual({ tokens: ["invoice"], caseInsensitive: true });
    expect(derive("Invoice", "m")).toEqual({ tokens: ["Invoice"], caseInsensitive: false });
    // A regex compiled with any other flag — `u` changes case folding — is not prefiltered.
    expect(deriveRecordPrefilter("Invoice", /Invoice/iu)).toBeNull();
    expect(deriveRecordPrefilter("Invoice", /Invoice/m)).toBeNull();
  });

  it("rule 3: only a token JSON escaping leaves unchanged", () => {
    for (const pattern of [
      'say "hi"',
      "tab\there",
      "line\nbreak",
      "carriage\rreturn",
      "nul\u0000byte",
      "lone\uD83Dsurrogate",
      "\uDE00tail",
    ]) {
      expect(derive(pattern), JSON.stringify(pattern)).toBeNull();
    }
    expect(tokensOf("emoji 😀 ok")).toEqual(["emoji 😀 ok"]);
    expect(tokensOf("para sep")).toEqual(["para sep"]);
    expect(tokensOf("C/O 100% & <b>")).toEqual(["C/O 100% & <b>"]);
  });

  it("rule 4: a token that could span JSON structure gets no prefilter", () => {
    for (const pattern of ["key:value", "a:1", "x,y", "a, b", "}", "]"]) {
      expect(derive(pattern), pattern).toBeNull();
    }
  });

  it("rule 5: a token starting with a space could start at a join separator", () => {
    expect(derive(" foo")).toBeNull();
    expect(derive(" 项目")).toBeNull();
    expect(tokensOf("foo ")).toEqual(["foo "]);
    expect(tokensOf("foo bar")).toEqual(["foo bar"]);
  });

  it("rule 6: a token that could lie inside String(n) gets no prefilter", () => {
    for (const pattern of ["2024", "21", "7", "-7", "-", "1e", "e", "E", "e-", "e-7", "5e-7"]) {
      expect(derive(pattern), pattern).toBeNull();
    }
    expect(derive("e", "i")).toBeNull();
    expect(derive("1E", "i")).toBeNull();
    // Cannot occur in any String(n): `-` only follows `e`, `e` always takes a sign.
    for (const pattern of ["2024-01-15", "10-20", "e2e", "1e5", "INV-0042", "2024年", "v2"]) {
      expect(tokensOf(pattern), pattern).toEqual([pattern]);
    }
  });

  it("rule 6: every literal-shaped piece of real number renderings is rejected", () => {
    const numbers = [
      0,
      -0,
      1,
      -1,
      7,
      42,
      2024,
      3.14,
      -2.5,
      0.1,
      0.000001,
      1e-7,
      1.5e-7,
      -1.5e-7,
      1e21,
      1.5e21,
      -1e21,
      123456789012345680000,
      Number("9007199254740993"),
      0.12345678901234568,
      Number.MAX_VALUE,
      Number.MIN_VALUE,
      5e-324,
    ];
    let seed = 7;
    const random = () => {
      seed = (seed * 48271) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < 300; i++) {
      numbers.push((random() - 0.5) * 10 ** Math.floor(random() * 60 - 30));
    }
    for (const n of numbers) {
      const text = String(n);
      for (let start = 0; start < text.length; start++) {
        for (let end = start + 1; end <= text.length; end++) {
          const piece = text.slice(start, end);
          if (/[.+]/.test(piece)) continue; // not a pure literal
          expect(derive(piece), `${piece} of ${text}`).toBeNull();
        }
      }
    }
  });

  it("rule 7: a token inside `object Object` (an array's object element) gets no prefilter", () => {
    for (const pattern of ["object", "Object", "ject O", "t O", "bj", "o"]) {
      expect(derive(pattern), pattern).toBeNull();
    }
    expect(derive("OBJECT", "i")).toBeNull();
    expect(derive("ject o", "i")).toBeNull();
    // Not inside it, so safe.
    expect(tokensOf("objects")).toEqual(["objects"]);
    expect(tokensOf("OBJECT")).toEqual(["OBJECT"]);
  });

  it("rule 8: under `i`, ASCII is lowered and non-ASCII must fold with nothing", () => {
    expect(derive("Quarterly Plan", "i")).toEqual({
      tokens: ["quarterly plan"],
      caseInsensitive: true,
    });
    expect(tokensOf("项目周报 Weekly", "i")).toEqual(["项目周报 weekly"]);
    expect(tokensOf("カタカナ|한국어", "i")).toEqual(["カタカナ", "한국어"]);
    for (const pattern of ["Café", "ÉCOLE", "ｆｕｌｌ", "Straße|σ", "Ωmega", "Привет"]) {
      expect(derive(pattern, "i"), pattern).toBeNull();
      // Case-sensitive, the same literal is fine.
      expect(derive(pattern), pattern).not.toBeNull();
    }
  });

  it("rule 8: agrees with the JS regex engine on which code units fold", () => {
    const allUnits = Array.from({ length: 0x10000 }, (_, unit) => String.fromCharCode(unit)).join(
      "",
    );
    const matchingUnits = (unit: number) =>
      [...allUnits.matchAll(new RegExp(`\\u${unit.toString(16).padStart(4, "0")}`, "gi"))].map(
        (match) => match.index,
      );

    // Every ASCII letter folds with exactly its ASCII counterpart — what
    // `lower(… collate "C")` does — and no other code unit.
    for (let unit = 0x41; unit <= 0x5a; unit++) {
      expect(matchingUnits(unit)).toEqual([unit, unit + 32]);
      expect(matchingUnits(unit + 32)).toEqual([unit, unit + 32]);
    }

    // Non-ASCII: the derivation keeps a code unit exactly when the engine
    // matches it with itself alone.
    const ranges: Array<[number, number, number]> = [
      [0x80, 0x24f, 1], // Latin-1 Supplement, Latin Extended-A/B
      [0x370, 0x52f, 1], // Greek, Cyrillic
      [0x10a0, 0x10ff, 1], // Georgian
      [0x13a0, 0x13ff, 1], // Cherokee
      [0x1e00, 0x1fff, 1], // Latin Extended Additional, Greek Extended
      [0x2100, 0x218f, 1], // Letterlike symbols (Kelvin, Ohm), Roman numerals
      [0x24b0, 0x24ff, 1], // Circled letters
      [0x2c00, 0x2c7f, 1], // Glagolitic, Latin Extended-C
      [0x3000, 0x30ff, 1], // CJK punctuation, kana
      [0x4e00, 0x9fff, 97], // CJK ideographs, sampled
      [0xac00, 0xd7a3, 89], // Hangul, sampled
      [0xff00, 0xffef, 1], // Fullwidth forms
    ];
    let kept = 0;
    let folded = 0;
    for (const [from, to, step] of ranges) {
      for (let unit = from; unit <= to; unit += step) {
        const char = String.fromCharCode(unit);
        const foldsAlone = matchingUnits(unit).length === 1;
        expect(deriveRecordPrefilter(char, new RegExp(char, "i")) !== null, char).toBe(foldsAlone);
        if (foldsAlone) kept++;
        else folded++;
      }
    }
    // Both sides of the rule were exercised.
    expect(kept).toBeGreaterThan(500);
    expect(folded).toBeGreaterThan(500);
  });
});
