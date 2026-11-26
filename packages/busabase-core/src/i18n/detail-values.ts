import type { CoreLocale } from "./locales";

export const detailValuesMessages: Record<CoreLocale, { count: string }> = {
  en: { count: "{count} values" },
  "zh-CN": { count: "{count} 条内容" },
  "zh-TW": { count: "{count} 筆內容" },
  ja: { count: "{count} 件の値" },
  ko: { count: "값 {count}개" },
  es: { count: "{count} valores" },
  pt: { count: "{count} valores" },
  vi: { count: "{count} giá trị" },
  fr: { count: "{count} valeurs" },
  de: { count: "{count} Werte" },
};
