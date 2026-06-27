import { z } from "zod";
import { type LocaleType } from "./i18n";
export declare const iStringRecordSchema: z.ZodRecord<
  z.ZodEnum<{
    en: "en";
    "zh-CN": "zh-CN";
    "zh-TW": "zh-TW";
    ja: "ja";
    pt: "pt";
    de: "de";
  }> &
    z.core.$partial,
  z.ZodString
>;
export declare const iStringSchema: z.ZodUnion<
  readonly [
    z.ZodString,
    z.ZodRecord<
      z.ZodEnum<{
        en: "en";
        "zh-CN": "zh-CN";
        "zh-TW": "zh-TW";
        ja: "ja";
        pt: "pt";
        de: "de";
      }> &
        z.core.$partial,
      z.ZodString
    >,
  ]
>;
export type iString = z.infer<typeof iStringSchema>;
export declare const isIString: (str: string) => false | iString;
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
export declare const iStringMatch: (str: iString, compare: string, lang?: LocaleType) => boolean;
/**
 * Quick parse to string
 *
 * @param str
 * @param lang default en
 * @returns
 */
export declare const iStringParse: (str: iString | undefined | null, lang?: LocaleType) => string;
/**
 * Parse string to iString
 * @param str
 * @returns
 * @example
 * ```ts
 * iStringify('hello') // { en: 'hello' }
 * ```
 */
export declare const iStringify: (str: string, lang?: LocaleType) => iString;
/**
 * Concatenates iString values. For example, {en: 'hello', zh: '你好'} => 'hello 你好'
 */
export declare const iStringConcat: (str: iString | string) => string;
