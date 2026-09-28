import { coreMessagesByLocale } from "busabase-core/i18n/catalog";
import { describe, expect, it } from "vitest";
import { getBusabaseAppLL, normalizeBusabaseAppLocale } from "../src/lib/i18n";

describe("busabase locale normalization", () => {
  it("normalizes browser and stored locale aliases to app-supported locales", () => {
    expect(normalizeBusabaseAppLocale("zh")).toBe("zh-CN");
    expect(normalizeBusabaseAppLocale("zh-Hans")).toBe("zh-CN");
    expect(normalizeBusabaseAppLocale("ja-JP")).toBe("ja");
    expect(normalizeBusabaseAppLocale("en-US")).toBe("en");
  });

  it.each([
    ["zh-CN", "zh-CN"],
    ["zh-Hans-CN", "zh-CN"],
    ["zh-SG", "zh-CN"],
    ["zh-Hant", "zh-TW"],
    ["ZH-HK", "zh-TW"],
    ["zh-tw", "zh-TW"],
    ["ko-KR", "ko"],
    ["es-419", "es"],
    ["pt-BR", "pt"],
    ["vi-VN", "vi"],
    ["fr-CA", "fr"],
    ["de-AT", "de"],
    ["EN", "en"],
    ["en-GB", "en"],
    ["ru", undefined],
    ["", undefined],
    [undefined, undefined],
  ])("resolves %s to %s", (input, expected) => {
    expect(normalizeBusabaseAppLocale(input)).toBe(expected);
  });

  it("normalizes core dashboard locales so permission dialogs do not fall back to english", () => {
    expect(normalizeBusabaseAppLocale("zh-Hans")).toBe("zh-CN");
    expect(normalizeBusabaseAppLocale("zh-HK")).toBe("zh-TW");
    expect(normalizeBusabaseAppLocale("ja-JP")).toBe("ja");
    // The dashboard hands the normalized locale to busabase-core's catalogs.
    const coreMessages = (tag: string) =>
      coreMessagesByLocale[normalizeBusabaseAppLocale(tag) ?? "en"];
    expect(coreMessages("zh-Hans").permissions.dialogTitle).toBe("权限");
    expect(coreMessages("ja-JP").permissions.makePrivate).toBe("アクセスを制限");
  });

  it("normalizes app translations for non-canonical locale tags", () => {
    expect(getBusabaseAppLL("zh-Hans").settingsDialog.title()).toBe("设置");
    expect(getBusabaseAppLL("ja-JP").settingsDialog.title()).toBe("設定");
  });
});
