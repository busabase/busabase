import type { iString } from "./i-string";
import type { LocaleType } from "./i18n";
/**
 * Object-oriented version
 */
export declare class I18NString {
  private _str;
  constructor(str: iString);
  /**
   * Returns a string
   * // If it's a string, return directly
   * // If it's a JSON object but no language specified, return the whole object!
   * // If language is specified, return the corresponding language value
   * @param lang
   * @returns
   */
  toString(lang?: string): string;
  parse(lang: LocaleType): string;
}
