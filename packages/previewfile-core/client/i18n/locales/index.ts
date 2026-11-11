import { defaultMessages, type Messages } from "../messages";
import { de } from "./de";
import { es } from "./es";
import { fr } from "./fr";
import { ja } from "./ja";
import { ko } from "./ko";
import { pt } from "./pt";
import { vi } from "./vi";
import { zhCN } from "./zh-CN";
import { zhTW } from "./zh-TW";

/** The languages the viewers ship strings for. */
export type ViewerLanguage =
  | "en"
  | "zh-CN"
  | "zh-TW"
  | "ja"
  | "ko"
  | "pt"
  | "de"
  | "es"
  | "fr"
  | "vi";

/** Languages told apart by their primary subtag alone. */
const BY_PRIMARY_SUBTAG: Record<string, ViewerLanguage> = {
  ja: "ja",
  ko: "ko",
  // One Portuguese: the Brazilian wording the hosts' own pt translations use.
  pt: "pt",
  de: "de",
  es: "es",
  fr: "fr",
  vi: "vi",
};

/**
 * The language the viewers speak for a host's BCP 47 tag ("zh-CN", "zh-Hant-HK",
 * "pt-BR", "de", …). Traditional Chinese is matched by script or by region
 * (TW/HK/MO); anything unknown falls back to English.
 */
export function viewerLanguage(locale?: string | null): ViewerLanguage {
  const tag = (locale ?? "").toLowerCase();
  if (tag === "zh" || tag.startsWith("zh-")) {
    return /^zh-(hant|tw|hk|mo)\b/.test(tag) ? "zh-TW" : "zh-CN";
  }
  return BY_PRIMARY_SUBTAG[tag.split("-")[0]] ?? "en";
}

const MESSAGES: Record<ViewerLanguage, Messages> = {
  en: defaultMessages,
  "zh-CN": zhCN,
  "zh-TW": zhTW,
  ja,
  ko,
  pt,
  de,
  es,
  fr,
  vi,
};

/** The viewer's strings in a host's language; English when it is not one of ours. */
export function messagesForLocale(locale?: string | null): Messages {
  return MESSAGES[viewerLanguage(locale)];
}
