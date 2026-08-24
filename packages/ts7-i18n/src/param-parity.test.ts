import { describe, expect, it } from "vitest";
import { assertLocaleParamParity, collectParams } from "./param-parity";

describe("collectParams", () => {
  it("collects param names per dotted path, deduped and sorted", () => {
    const tree = {
      common: { save: "Save", greet: "Hi {name}, you have {count} items and {count} more" },
    };
    expect(collectParams(tree)).toEqual({
      "common.save": [],
      "common.greet": ["count", "name"],
    });
  });

  it("strips :type hints when collecting", () => {
    expect(collectParams({ msg: "code {code:string}" })).toEqual({ msg: ["code"] });
  });

  it("does not count a {{…}} plural block as a param", () => {
    // Regression: `hour{{s}}` used to report a bogus param `s`, so every locale
    // that legitimately has no plural block failed parity as `missing [s]`.
    expect(collectParams({ msg: "{count} hour{{s}} ago" })).toEqual({ msg: ["count"] });
    expect(collectParams({ msg: "search{{es}}" })).toEqual({ msg: [] });
  });

  it("counts the param named by an explicit {{key:…}} plural block", () => {
    expect(collectParams({ msg: "{a} file{{b:|s}}" })).toEqual({ msg: ["a", "b"] });
  });
});

describe("assertLocaleParamParity — plural blocks", () => {
  it("passes when a locale renders the same plural key without a {{…}} block", () => {
    // Japanese has no plural inflection, so the translated string legitimately
    // omits the block while binding the same `{count}` param.
    expect(() =>
      assertLocaleParamParity(
        { postsPage: { hoursAgo: "{count} hour{{s}} ago" } },
        { ja: { postsPage: { hoursAgo: "{count}時間前" } } },
      ),
    ).not.toThrow();
  });
});

describe("assertLocaleParamParity", () => {
  const base = { common: { greet: "Hi {name}" } };

  it("does not throw when every locale's params match the base", () => {
    expect(() =>
      assertLocaleParamParity(base, { "zh-CN": { common: { greet: "你好 {name}" } } }),
    ).not.toThrow();
  });

  it("throws when a locale is missing a param the base has", () => {
    expect(() =>
      assertLocaleParamParity(base, { "zh-CN": { common: { greet: "你好" } } }),
    ).toThrowError(/missing \[name\]/);
  });

  it("throws when a locale has an extra param the base doesn't", () => {
    expect(() =>
      assertLocaleParamParity(base, { "zh-CN": { common: { greet: "你好 {name} {extra}" } } }),
    ).toThrowError(/extra \[extra\]/);
  });

  it("names the offending locale and key path in the error", () => {
    expect(() =>
      assertLocaleParamParity(base, { ja: { common: { greet: "こんにちは" } } }),
    ).toThrowError(/\[ja\] "common\.greet"/);
  });
});
