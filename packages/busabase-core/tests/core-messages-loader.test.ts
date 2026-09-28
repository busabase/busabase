import { describe, expect, it } from "vitest";
import { loadCoreMessages } from "../src/i18n";
import { coreMessagesByLocale } from "../src/i18n/catalog";
import { CORE_LOCALES } from "../src/i18n/locales";

describe("loadCoreMessages — the on-demand catalog map", () => {
  // A copy-paste slip in the per-locale `import()` map (ja → ko, say) would
  // type-check fine and silently show one language's strings under another's
  // name, so compare every entry against the statically imported catalog.
  it.each(CORE_LOCALES)("%s resolves to its own catalog", async (locale) => {
    expect(await loadCoreMessages(locale)).toBe(coreMessagesByLocale[locale]);
  });
});
