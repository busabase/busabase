/**
 * i18n string utilities and types / i18n 字符串工具与类型
 *
 * Purpose / 作用
 * - EN: Provide a lightweight, persistable representation for business strings that may be multilingual.
 *       Values can be plain strings or locale-keyed records, allowing storage and logic usage.
 * - ZH: 为“可持久化且可多语言”的业务字符串提供轻量表示形式；可存纯文本，或按语言分组的对象，
 *       方便在业务逻辑内读取、比较与分支判断。
 *
 * Model (iString) / 模型（iString）
 * - EN: A value is either a string or a record like { en: "Hello", zh: "你好" }.
 * - ZH: 值可以是纯字符串，或形如 { en: "Hello", zh: "你好" } 的按语言分布对象。
 *
 * Validation / 校验
 * - EN: Zod schemas validate both the record shape and the union type.
 * - ZH: 通过 Zod 对记录结构以及联合类型进行校验，Locale 受 ./types 中定义约束。
 *
 * Exports / 导出
 * - iStringRecordSchema: zod schema for { [locale]: string } constrained by supported locales.
 * - iStringSchema: union of string | iStringRecordSchema.
 * - isIString(str):
 *   - EN: Quick check for JSON iString records; returns parsed record or false.
 *   - ZH: 快速检测 JSON 字符串是否为 iString 记录；成功返回解析对象，否则返回 false。
 * - iStringMatch(str, compare, lang?):
 *   - EN: Compare by specified locale or any locale; supports plain string.
 *   - ZH: 支持按指定语言或任一语言进行等值比较；纯字符串直接比较。
 * - iStringParse(str, lang='en'):
 *   - EN: Resolve to a display string with sensible fallback.
 *   - ZH: 解析为用于展示的字符串，包含合理的回退策略。
 * - iStringify(str, lang='en'):
 *   - EN: Wrap a plain string into a record using the given locale.
 *   - ZH: 将纯字符串按给定语言包装为记录对象。
 * - iStringConcat(str):
 *   - EN: Concatenate all locale values for display/debug (order not guaranteed).
 *   - ZH: 拼接所有语言值以便展示/调试（顺序不保证）。
 *
 * Fallback behavior (iStringParse) / 回退策略（iStringParse）
 * - EN: If str is a string, return it. If it is a record: prefer requested locale; else any non-"en"; else "en".
 *       Warn and return empty string if no suitable value exists.
 * - ZH: 若为纯字符串，原样返回；若为记录：优先使用请求的语言；否则使用任一非 "en"；再退回 "en"。
 *       若均不可用，会发出警告并返回空字符串。
 *
 * Examples / 示例
 * - iStringify('Hello') => { en: 'Hello' }
 * - iStringParse({ en: 'Hello', zh: '你好' }, 'zh') => '你好'
 * - iStringMatch({ en: 'Hello' }, 'Hello') => true
 *
 * Notes / 说明
 * - EN: Depends on zod and the Locale/LocaleSchema from ./types to keep locales consistent.
 * - ZH: 依赖 zod 以及 ./types 中的 Locale/LocaleSchema，确保语言键一致与受控。
 * - EN: isIString expects a JSON string that decodes to a locale-keyed object; plain strings return false.
 * - ZH: isIString 接受 JSON 字符串并尝试解析为按语言分布的对象；纯字符串将返回 false。
 */
import { z } from "zod";
import { LocaleSchema, type LocaleType } from "./i18n";

export type { LocaleType } from "./i18n";

export const iStringRecordSchema = z.partialRecord(LocaleSchema, z.string());
export const iStringSchema = z.union([z.string(), iStringRecordSchema]).describe("i18n string");

export type iString = z.infer<typeof iStringSchema>;

// Determine if the given string is an iString structure, if so return iString type, otherwise return false
export const isIString = (str: string): false | iString => {
  try {
    return iStringRecordSchema.parse(JSON.parse(str));
  } catch {
    return false;
  }
};

export type iStringRecord = z.infer<typeof iStringRecordSchema>;

/**
 * Compares a string or localized string object with a given value
 * @param str - The string or localized string object to compare
 * @param compare - The string value to compare against
 * @param lang - Optional locale type to specify which language to compare
 * @returns True if the strings match, false otherwise
 *
 * @remarks
 * - If str is a plain string, does direct comparison
 * - If lang is specified, compares only that language's value
 * - If lang is not specified, returns true if any language value matches
 */
export const iStringMatch = (str: iString, compare: string, lang?: LocaleType): boolean => {
  // When iString is a string, compare directly
  if (typeof str === "string") {
    return str === compare;
  }
  // When language is specified, compare the value of the specified language
  if (lang) {
    return str[lang] === compare;
  }
  // When language is not specified, match any language value
  return Object.values(str).some((value) => value === compare);
};

/**
 * Quick parse to string
 *
 * @param str
 * @param lang default en
 * @returns
 */
export const iStringParse = (str: iString | undefined | null, lang: LocaleType = "en"): string => {
  if (!str) return "";

  if (typeof str === "string") {
    return str;
  }

  const locales = Object.keys(str || {}) as LocaleType[];
  const fallbackLocale =
    locales.find((locale) => locale === lang) || locales.find((locale) => locale !== "en") || "en";
  const result = str[fallbackLocale as LocaleType];

  if (result === undefined) {
    console.warn(`iStringParse: ${JSON.stringify(str)} has no '${lang}' or other locales`);
  }

  return result || "";
};

/**
 * Parse string to iString
 * @param str
 * @returns
 * @example
 * ```ts
 * iStringify('hello') // { en: 'hello' }
 * ```
 */
export const iStringify = (str: string, lang: LocaleType = "en"): iString => ({
  [lang]: str,
});

/**
 * Trim every value; locale entries that become empty are dropped. A record with
 * no remaining entries collapses to "".
 */
export const iStringTrim = (str: iString): iString => {
  if (typeof str === "string") return str.trim();
  const entries = Object.entries(str)
    .map(([locale, value]) => [locale, value?.trim() ?? ""] as const)
    .filter(([, value]) => value.length > 0);
  if (entries.length === 0) return "";
  return Object.fromEntries(entries) as iStringRecord;
};

/** True when the iString holds no non-blank text in any locale. */
export const iStringIsEmpty = (str: iString | null | undefined): boolean => {
  if (!str) return true;
  if (typeof str === "string") return str.trim().length === 0;
  return !Object.values(str).some((value) => value && value.trim().length > 0);
};

/**
 * Encode an iString for storage in a plain text column: strings pass through,
 * locale records are JSON-encoded. Reverse with iStringFromText.
 */
export const iStringToText = (str: iString): string =>
  typeof str === "string" ? str : JSON.stringify(str);

/**
 * Decode a text-column value written by iStringToText. Non-JSON (or non-record
 * JSON) text is returned as a plain string.
 */
export const iStringFromText = (raw: string): iString => isIString(raw) || raw;

/**
 * Concatenates iString values. For example, {en: 'hello', zh: '你好'} => 'hello 你好'
 */
export const iStringConcat = (str: iString | string): string => {
  if (typeof str === "string") {
    return str;
  }
  return Object.values(str).join(" ");
};
