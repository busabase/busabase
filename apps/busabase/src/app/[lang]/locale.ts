export const SUPPORTED_LANG_LOCALES = ["en", "zh-CN"] as const;
export type LangLocale = (typeof SUPPORTED_LANG_LOCALES)[number];

export const normalizeLangLocale = (value: string): LangLocale | null => {
  const normalized = value.toLowerCase();
  if (normalized === "en") return "en";
  if (normalized === "zh" || normalized === "zh-cn" || value === "zh-CN") return "zh-CN";
  return null;
};
