import { describe, expect, it } from "vitest";
import {
  getBusabaseAppLL,
  getBusabaseMessages,
  normalizeBusabaseAppLocale,
  normalizeBusabaseLocale,
} from "../src/lib/i18n";

describe("busabase locale normalization", () => {
  it("normalizes browser and stored locale aliases to app-supported locales", () => {
    expect(normalizeBusabaseAppLocale("zh")).toBe("zh-CN");
    expect(normalizeBusabaseAppLocale("zh-Hans")).toBe("zh-CN");
    expect(normalizeBusabaseAppLocale("ja-JP")).toBe("ja");
    expect(normalizeBusabaseAppLocale("en-US")).toBe("en");
  });

  it("normalizes core dashboard locales so permission dialogs do not fall back to english", () => {
    expect(normalizeBusabaseLocale("zh-Hans")).toBe("zh-CN");
    expect(normalizeBusabaseLocale("zh-HK")).toBe("zh-TW");
    expect(normalizeBusabaseLocale("ja-JP")).toBe("ja");
    expect(getBusabaseMessages("zh-Hans").permissions.dialogTitle).toBe("权限");
    expect(getBusabaseMessages("ja-JP").permissions.makePrivate).toBe("アクセスを制限");
  });

  it("normalizes app translations for non-canonical locale tags", () => {
    expect(getBusabaseAppLL("zh-Hans").settingsDialog.title()).toBe("设置");
    expect(getBusabaseAppLL("ja-JP").settingsDialog.title()).toBe("設定");
  });
});
