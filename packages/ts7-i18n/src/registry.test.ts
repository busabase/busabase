import { describe, expect, it } from "vitest";
import { createTranslationRegistry, interpolate } from "./registry";

describe("interpolate", () => {
  it("returns the template unchanged when there are no params", () => {
    expect(interpolate("hello")).toBe("hello");
  });

  it("substitutes a {param}", () => {
    expect(interpolate("hi {name}", { name: "Kelly" })).toBe("hi Kelly");
  });

  it("substitutes a {param:type} hint, ignoring the type suffix", () => {
    expect(interpolate("code {code:string}", { code: "42" })).toBe("code 42");
  });

  it("substitutes a numeric param", () => {
    expect(interpolate("{count} items", { count: 3 })).toBe("3 items");
  });

  it("leaves an unmatched placeholder as literal text", () => {
    expect(interpolate("hi {name}", {})).toBe("hi {name}");
  });
});

// Every expectation below is ground truth captured from typesafe-i18n's own
// runtime (`i18nString("en")`) against these exact templates, so migrated
// strings keep rendering byte-identically.
describe("interpolate — {{…}} plural blocks (typesafe-i18n compatibility)", () => {
  it("binds a keyless block to the preceding param: 0 and 2+ take the plural form", () => {
    expect(interpolate("{count} listing{{s}}", { count: 0 })).toBe("0 listings");
    expect(interpolate("{count} listing{{s}}", { count: 2 })).toBe("2 listings");
  });

  it("renders the empty singular form for exactly 1", () => {
    expect(interpolate("{count} listing{{s}}", { count: 1 })).toBe("1 listing");
  });

  it("handles a :type hint on the bound param", () => {
    expect(interpolate("{count:number} day{{s}} ago", { count: 1 })).toBe("1 day ago");
    expect(interpolate("{count:number} day{{s}} ago", { count: 3 })).toBe("3 days ago");
  });

  it("supports a non-'s' suffix", () => {
    expect(interpolate("Cleaned up {count:number} old avatar{{s}}", { count: 7 })).toBe(
      "Cleaned up 7 old avatars",
    );
  });

  it("falls back to the plural form when the block has no param at all", () => {
    // No param to bind to → value is undefined → NaN → the `other` category.
    expect(interpolate("search{{es}}")).toBe("searches");
    expect(interpolate("command{{s}}")).toBe("commands");
  });

  it("is never mistaken for a param named after the form", () => {
    // The `{{s}}` must not be read as a `{s}` placeholder.
    expect(interpolate("file{{s}}", { s: "SHOULD-NOT-APPEAR" })).toBe("files");
  });

  it("supports the two-form {{one|other}} shorthand", () => {
    expect(interpolate("{n} {{item|items}}", { n: 1 })).toBe("1 item");
    expect(interpolate("{n} {{item|items}}", { n: 4 })).toBe("4 items");
  });

  it("supports the three-form {{zero|one|other}} shorthand", () => {
    expect(interpolate("{n} {{none|one thing|many things}}", { n: 0 })).toBe("0 none");
    expect(interpolate("{n} {{none|one thing|many things}}", { n: 1 })).toBe("1 one thing");
    expect(interpolate("{n} {{none|one thing|many things}}", { n: 9 })).toBe("9 many things");
  });

  it("supports an explicit {{key:…}} binding to a non-adjacent param", () => {
    expect(interpolate("{a} and {b} file{{a:|s}}", { a: 1, b: 2 })).toBe("1 and 2 file");
    expect(interpolate("{a} and {b} file{{a:|s}}", { a: 3, b: 2 })).toBe("3 and 2 files");
  });

  it("replaces ?? inside a form with the bound value", () => {
    expect(interpolate("{n} {{no items|one item|?? items}}", { n: 5 })).toBe("5 5 items");
  });

  it("treats a boolean value as one/other", () => {
    expect(interpolate("{flag} {{yes|no}}", { flag: true as unknown as string })).toBe("true yes");
    expect(interpolate("{flag} {{yes|no}}", { flag: false as unknown as string })).toBe("false no");
  });

  it("does not crash on a 4- or 5-form block, which has no shorthand of its own", () => {
    // typesafe-i18n has shorthands for 1, 2, 3 and 6 forms only. A 4- or 5-form
    // block is not an error there — it fills the 6-slot [zero,one,two,few,many,other]
    // layout as far as it goes and renders "" for the slots left empty.
    //
    // Ground truth captured from typesafe-i18n's own runtime under `en`:
    //   "{n} {{a|b|c|d}}"    n=0→"0 a"  n=1→"1 b"  n=2→"2 "  n=3→"3 "  n=5→"5 "
    //   "{n} {{a|b|c|d|e}}"  identical
    for (const forms of ["a|b|c|d", "a|b|c|d|e"]) {
      const template = `{n} {{${forms}}}`;
      expect(interpolate(template, { n: 0 })).toBe("0 a");
      expect(interpolate(template, { n: 1 })).toBe("1 b");
      expect(interpolate(template, { n: 2 })).toBe("2 ");
      expect(interpolate(template, { n: 3 })).toBe("3 ");
      expect(interpolate(template, { n: 5 })).toBe("5 ");
    }
    // Unbound (no preceding param) renders "" for every n, as it does upstream.
    expect(interpolate("{{a|b|c|d}}")).toBe("");
  });

  it("maps the 3-form shorthand to zero|one|other (not one|few|many)", () => {
    // Ground truth from typesafe-i18n under `ru`: 0→zero, 1→one, 2 and 5→other.
    const template = "{n} {{файл|файла|файлов}}";
    expect(interpolate(template, { n: 0 }, "ru")).toBe("0 файл");
    expect(interpolate(template, { n: 1 }, "ru")).toBe("1 файла");
    expect(interpolate(template, { n: 2 }, "ru")).toBe("2 файлов");
  });

  it("uses the target locale's own plural categories, not English's", () => {
    // 6-form shorthand is zero|one|two|few|many|other. Russian routes 2→few and
    // 5→many; English collapses both to other. Same template, same values,
    // different output — proving the locale actually drives selection.
    const template = "{n} {{Z|O|T|F|M|R}}";
    expect(interpolate(template, { n: 2 }, "ru")).toBe("2 F");
    expect(interpolate(template, { n: 5 }, "ru")).toBe("5 M");
    expect(interpolate(template, { n: 2 }, "en")).toBe("2 R");
    expect(interpolate(template, { n: 5 }, "en")).toBe("5 R");
  });
});

interface BaseTranslation {
  common: { save: string; greet: "Hi {name}" };
}

describe("createTranslationRegistry", () => {
  it("throws from getTranslations before loadLocale is called", () => {
    const registry = createTranslationRegistry<"en" | "zh-CN", BaseTranslation>();
    expect(() => registry.getTranslations("en")).toThrow(/not loaded/);
  });

  it("isLocaleLoaded reflects loadLocale calls", () => {
    const registry = createTranslationRegistry<"en" | "zh-CN", BaseTranslation>();
    expect(registry.isLocaleLoaded("en")).toBe(false);
    registry.loadLocale("en", { common: { save: "Save", greet: "Hi {name}" } });
    expect(registry.isLocaleLoaded("en")).toBe(true);
    expect(registry.isLocaleLoaded("zh-CN")).toBe(false);
  });

  it("getTranslations builds nested callable accessors from a loaded locale", () => {
    const registry = createTranslationRegistry<"en" | "zh-CN", BaseTranslation>();
    registry.loadLocale("en", { common: { save: "Save", greet: "Hi {name}" } });
    const LL = registry.getTranslations("en");
    expect(LL.common.save()).toBe("Save");
    expect(LL.common.greet({ name: "Kelly" })).toBe("Hi Kelly");
  });

  it("wraps an array leaf as an index-keyed object of callables (Object.values-consumable)", () => {
    interface WithFeatures {
      common: { save: string; greet: string };
      features: { title: string }[];
      changes: string[];
    }
    const registry = createTranslationRegistry<"en", WithFeatures>();
    registry.loadLocale("en", {
      common: { save: "Save", greet: "Hi" },
      features: [{ title: "Fast" }, { title: "Typed" }],
      changes: ["Initial release", "Bug fixes"],
    });
    const LL = registry.getTranslations("en");
    expect(Array.isArray(LL.features)).toBe(false);
    expect(Object.values(LL.features).map((f) => f.title())).toEqual(["Fast", "Typed"]);
    expect(Object.values(LL.changes).map((c) => c())).toEqual(["Initial release", "Bug fixes"]);
  });

  it("accepts eager initialTranslations at construction time", () => {
    const registry = createTranslationRegistry<"en" | "zh-CN", BaseTranslation>({
      en: { common: { save: "Save", greet: "Hi {name}" } },
      "zh-CN": { common: { save: "保存", greet: "你好 {name}" } },
    });
    expect(registry.getTranslations("zh-CN").common.greet({ name: "凯利" })).toBe("你好 凯利");
  });
});
