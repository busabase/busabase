import { describe, expect, it } from "vitest";
import { coreMessagesByLocale, coreMessagesEn } from "../src/i18n";

type Tree = { [key: string]: Tree | string | readonly (Tree | string)[] };

const leaves = (value: unknown, path: string, out: Map<string, string>) => {
  if (typeof value === "string") {
    out.set(path, value);
  } else if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) leaves(item, `${path}[${index}]`, out);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value as Tree)) {
      leaves(child, path ? `${path}.${key}` : key, out);
    }
  }
  return out;
};

const tokens = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

// `{plural}` only exists to append an English "s"/"es"; languages without that
// inflection (ja, zh, ko, de …) legitimately leave it out.
const withoutPlural = (list: string[]) => list.filter((token) => token !== "plural");

const english = leaves(coreMessagesEn, "", new Map());

describe("core dashboard catalogs", () => {
  const others = Object.entries(coreMessagesByLocale).filter(([locale]) => locale !== "en");

  it.each(others)("%s has exactly the same keys as English", (_locale, messages) => {
    expect([...leaves(messages, "", new Map()).keys()].sort()).toEqual([...english.keys()].sort());
  });

  it.each(others)("%s keeps every {placeholder} the English string has", (_locale, messages) => {
    const translated = leaves(messages, "", new Map());
    const mismatched: string[] = [];
    for (const [path, source] of english) {
      const expected = withoutPlural(tokens(source));
      const actual = withoutPlural(tokens(translated.get(path) ?? ""));
      if (expected.join() !== actual.join()) mismatched.push(path);
    }
    expect(mismatched).toEqual([]);
  });

  it.each(others)("%s has no empty strings where English has text", (_locale, messages) => {
    const translated = leaves(messages, "", new Map());
    const empty = [...english].filter(
      ([path, source]) => source.trim() !== "" && (translated.get(path) ?? "").trim() === "",
    );
    expect(empty.map(([path]) => path)).toEqual([]);
  });
});
