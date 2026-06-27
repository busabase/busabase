import { type iString, iStringParse, type iStringRecord } from "./i-string";
import type { LocaleType } from "./i18n";

/**
 * Object-oriented version
 */
export class I18NString {
  private _str: iString;

  constructor(str: iString) {
    this._str = str;
  }

  /**
   * Returns a string
   * // If it's a string, return directly
   * // If it's a JSON object but no language specified, return the whole object!
   * // If language is specified, return the corresponding language value
   * @param lang
   * @returns
   */
  toString(lang?: string) {
    if (typeof this._str === "string") {
      return this._str;
    }

    if (!lang) return JSON.stringify(this._str);

    return (this._str as iStringRecord)[lang as LocaleType] ?? "";
  }

  parse(lang: LocaleType) {
    return iStringParse(this._str, lang);
  }
}
