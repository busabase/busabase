import { FormulaEvalError } from "../errors";
import { arity, asNumber, asString, type FormulaFn } from "./value";

export const TEXT_FUNCTIONS: Record<string, FormulaFn> = {
  CONCATENATE: (args) => args.map(asString).join(""),
  LEFT: (args) => {
    arity("LEFT", args, 2);
    return asString(args[0]).slice(0, Math.max(0, asNumber(args[1], "LEFT")));
  },
  RIGHT: (args) => {
    arity("RIGHT", args, 2);
    const count = Math.max(0, asNumber(args[1], "RIGHT"));
    const text = asString(args[0]);
    return count === 0 ? "" : text.slice(-count);
  },
  MID: (args) => {
    arity("MID", args, 3);
    const text = asString(args[0]);
    const start = Math.max(1, asNumber(args[1], "MID"));
    const count = Math.max(0, asNumber(args[2], "MID"));
    return text.slice(start - 1, start - 1 + count);
  },
  LEN: (args) => {
    arity("LEN", args, 1);
    return asString(args[0]).length;
  },
  // Case-sensitive, 1-based index; throws (spreadsheet-style #VALUE! error)
  // when the needle isn't found, rather than returning -1/0.
  FIND: (args) => {
    arity("FIND", args, 2, 3);
    const needle = asString(args[0]);
    const haystack = asString(args[1]);
    const startPos = args.length > 2 ? Math.max(1, asNumber(args[2], "FIND")) : 1;
    const index = haystack.indexOf(needle, startPos - 1);
    if (index === -1) {
      throw new FormulaEvalError(`FIND: "${needle}" not found in "${haystack}"`);
    }
    return index + 1;
  },
  // Case-insensitive counterpart of FIND.
  SEARCH: (args) => {
    arity("SEARCH", args, 2, 3);
    const needle = asString(args[0]).toLowerCase();
    const haystack = asString(args[1]).toLowerCase();
    const startPos = args.length > 2 ? Math.max(1, asNumber(args[2], "SEARCH")) : 1;
    const index = haystack.indexOf(needle, startPos - 1);
    if (index === -1) {
      throw new FormulaEvalError(`SEARCH: "${needle}" not found in "${haystack}"`);
    }
    return index + 1;
  },
  REPLACE: (args) => {
    arity("REPLACE", args, 4);
    const text = asString(args[0]);
    const start = Math.max(1, asNumber(args[1], "REPLACE"));
    const count = Math.max(0, asNumber(args[2], "REPLACE"));
    const replacement = asString(args[3]);
    return text.slice(0, start - 1) + replacement + text.slice(start - 1 + count);
  },
  SUBSTITUTE: (args) => {
    arity("SUBSTITUTE", args, 3, 4);
    const text = asString(args[0]);
    const oldText = asString(args[1]);
    const newText = asString(args[2]);
    if (!oldText) return text;
    if (args.length <= 3) {
      return text.split(oldText).join(newText);
    }
    const occurrence = asNumber(args[3], "SUBSTITUTE");
    let count = 0;
    let index = text.indexOf(oldText);
    while (index !== -1) {
      count++;
      if (count === occurrence) {
        return text.slice(0, index) + newText + text.slice(index + oldText.length);
      }
      index = text.indexOf(oldText, index + 1);
    }
    return text;
  },
  REPT: (args) => {
    arity("REPT", args, 2);
    const count = Math.max(0, asNumber(args[1], "REPT"));
    return asString(args[0]).repeat(count);
  },
  // Excel-style TRIM: leading/trailing whitespace removed AND internal runs
  // of whitespace collapsed to a single space (not just String.trim()).
  TRIM: (args) => {
    arity("TRIM", args, 1);
    return asString(args[0]).trim().replace(/\s+/g, " ");
  },
  UPPER: (args) => {
    arity("UPPER", args, 1);
    return asString(args[0]).toUpperCase();
  },
  LOWER: (args) => {
    arity("LOWER", args, 1);
    return asString(args[0]).toLowerCase();
  },
  T: (args) => {
    arity("T", args, 1);
    return typeof args[0] === "string" ? args[0] : "";
  },
  VALUE: (args) => {
    arity("VALUE", args, 1);
    const text = asString(args[0]).trim();
    const n = Number(text);
    if (text === "" || Number.isNaN(n)) {
      throw new FormulaEvalError(`VALUE: cannot parse "${text}" as a number`);
    }
    return n;
  },
  ENCODE_URL_COMPONENT: (args) => {
    arity("ENCODE_URL_COMPONENT", args, 1);
    return encodeURIComponent(asString(args[0]));
  },
};
