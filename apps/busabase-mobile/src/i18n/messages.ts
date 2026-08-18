import { en } from "./en";
import { zhCN } from "./zh-CN";

export { en } from "./en";
export type { CoreMessages } from "./types";
export { zhCN } from "./zh-CN";

export const messagesByLocale = {
  en,
  "zh-CN": zhCN,
} as const;

export type Locale = keyof typeof messagesByLocale;

export const localeOptions: Array<{ code: Locale; label: string }> = [
  { code: "en", label: "English" },
  { code: "zh-CN", label: "简体中文" },
];

/**
 * Interpolate `{token}` placeholders in a catalog string.
 *
 * Lives HERE rather than in `./index.tsx` (which re-exports it, so every
 * existing `import { fmt } from "~/i18n"` is unchanged) because this module is
 * pure: `index.tsx` pulls in react-native, whose Flow-typed source cannot be
 * parsed by the node-environment Vitest runner. Keeping `fmt` on the pure side
 * lets logic modules that only format catalog strings stay unit-testable.
 */
export function fmt(template: string, tokens: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in tokens ? String(tokens[key]) : match,
  );
}
