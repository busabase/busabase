// Date/time functions. Dates are represented as native JS `Date` internally
// (see ./value.ts's FormulaValue widening); a formula field whose result is
// a Date is serialized to an ISO string by ../../field-types.ts's
// computeFormula before it's stored, same convention as the `date` field type.
//
// All component getters (DAY/MONTH/... /WEEKDAY) use UTC methods, not local
// ones — deterministic across server/test/CI timezones, matching how the
// rest of busabase treats stored date strings as UTC-anchored.
import { FormulaEvalError } from "../errors";
import { arity, asDate, asNumber, asString, type FormulaFn } from "./value";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DATE_UNIT_MS: Record<string, number> = {
  seconds: 1000,
  minutes: 60 * 1000,
  hours: 60 * 60 * 1000,
  days: MS_PER_DAY,
  weeks: 7 * MS_PER_DAY,
};

const diffInUnit = (from: Date, to: Date, unit: string): number => {
  const ms = to.getTime() - from.getTime();
  if (unit === "months") {
    return (
      (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth())
    );
  }
  if (unit === "years") {
    return to.getUTCFullYear() - from.getUTCFullYear();
  }
  const unitMs = DATE_UNIT_MS[unit];
  if (!unitMs) {
    throw new FormulaEvalError(`Unknown date unit "${unit}"`);
  }
  return ms / unitMs;
};

const addToDate = (date: Date, count: number, unit: string): Date => {
  if (unit === "months") {
    const result = new Date(date.getTime());
    result.setUTCMonth(result.getUTCMonth() + count);
    return result;
  }
  if (unit === "years") {
    const result = new Date(date.getTime());
    result.setUTCFullYear(result.getUTCFullYear() + count);
    return result;
  }
  const unitMs = DATE_UNIT_MS[unit];
  if (!unitMs) {
    throw new FormulaEvalError(`Unknown date unit "${unit}"`);
  }
  return new Date(date.getTime() + count * unitMs);
};

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

// Minimal strftime-like tokens — not a full format-string parser (no
// dependency, matching this engine's zero-dependency design). Extend the
// token table as real demand shows up; see SPEC.md's date/time checklist.
const DATETIME_FORMAT_TOKENS: Array<[RegExp, (d: Date) => string]> = [
  [/YYYY/g, (d) => String(d.getUTCFullYear())],
  [/MM/g, (d) => pad(d.getUTCMonth() + 1)],
  [/DD/g, (d) => pad(d.getUTCDate())],
  [/HH/g, (d) => pad(d.getUTCHours())],
  [/mm/g, (d) => pad(d.getUTCMinutes())],
  [/ss/g, (d) => pad(d.getUTCSeconds())],
];

const formatDate = (date: Date, format: string): string =>
  DATETIME_FORMAT_TOKENS.reduce((out, [token, render]) => out.replace(token, render(date)), format);

const isWeekend = (date: Date): boolean => {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
};

export const DATE_TIME_FUNCTIONS: Record<string, FormulaFn> = {
  TODAY: (args) => {
    arity("TODAY", args, 0);
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  },
  NOW: (args) => {
    arity("NOW", args, 0);
    return new Date();
  },
  // Duration from NOW to `date` (positive when `date` is in the future).
  FROMNOW: (args) => {
    arity("FROMNOW", args, 1, 2);
    const unit = args.length > 1 ? asString(args[1]) : "days";
    return diffInUnit(new Date(), asDate(args[0], "FROMNOW"), unit);
  },
  // Duration from `date` to NOW (positive when `date` is in the past) —
  // the mirror image of FROMNOW.
  TONOW: (args) => {
    arity("TONOW", args, 1, 2);
    const unit = args.length > 1 ? asString(args[1]) : "days";
    return diffInUnit(asDate(args[0], "TONOW"), new Date(), unit);
  },
  DATEADD: (args) => {
    arity("DATEADD", args, 3);
    return addToDate(asDate(args[0], "DATEADD"), asNumber(args[1], "DATEADD"), asString(args[2]));
  },
  DATESTR: (args) => {
    arity("DATESTR", args, 1);
    return formatDate(asDate(args[0], "DATESTR"), "YYYY-MM-DD");
  },
  TIMESTR: (args) => {
    arity("TIMESTR", args, 1);
    return formatDate(asDate(args[0], "TIMESTR"), "HH:mm:ss");
  },
  DATETIME_FORMAT: (args) => {
    arity("DATETIME_FORMAT", args, 2);
    return formatDate(asDate(args[0], "DATETIME_FORMAT"), asString(args[1]));
  },
  // Simplified vs. a full format-string parser: always parses via the native
  // Date constructor (ISO 8601 / RFC 2822), ignoring an explicit format arg
  // if one is passed. Documented limitation — see SPEC.md.
  DATETIME_PARSE: (args) => {
    arity("DATETIME_PARSE", args, 1, 2);
    return asDate(args[0], "DATETIME_PARSE");
  },
  DATETIME_DIFF: (args) => {
    arity("DATETIME_DIFF", args, 3);
    return diffInUnit(
      asDate(args[0], "DATETIME_DIFF"),
      asDate(args[1], "DATETIME_DIFF"),
      asString(args[2]),
    );
  },
  DAY: (args) => {
    arity("DAY", args, 1);
    return asDate(args[0], "DAY").getUTCDate();
  },
  MONTH: (args) => {
    arity("MONTH", args, 1);
    return asDate(args[0], "MONTH").getUTCMonth() + 1;
  },
  YEAR: (args) => {
    arity("YEAR", args, 1);
    return asDate(args[0], "YEAR").getUTCFullYear();
  },
  HOUR: (args) => {
    arity("HOUR", args, 1);
    return asDate(args[0], "HOUR").getUTCHours();
  },
  MINUTE: (args) => {
    arity("MINUTE", args, 1);
    return asDate(args[0], "MINUTE").getUTCMinutes();
  },
  SECOND: (args) => {
    arity("SECOND", args, 1);
    return asDate(args[0], "SECOND").getUTCSeconds();
  },
  // 1 (Sunday) .. 7 (Saturday) — Excel's default WEEKDAY(date, 1) numbering.
  WEEKDAY: (args) => {
    arity("WEEKDAY", args, 1);
    return asDate(args[0], "WEEKDAY").getUTCDay() + 1;
  },
  // ISO-ish week number (1-53): the week containing this date, weeks start Monday.
  WEEKNUM: (args) => {
    arity("WEEKNUM", args, 1);
    const date = asDate(args[0], "WEEKNUM");
    const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
    const dayOfYear = Math.floor((date.getTime() - startOfYear) / MS_PER_DAY);
    const jan1Weekday = new Date(startOfYear).getUTCDay();
    return Math.ceil((dayOfYear + jan1Weekday + 1) / 7);
  },
  // Business-day arithmetic, Mon-Fri only — no holiday calendar (matches the
  // reference implementations' scope; see SPEC.md).
  WORKDAY: (args) => {
    arity("WORKDAY", args, 2);
    let date = asDate(args[0], "WORKDAY");
    let remaining = asNumber(args[1], "WORKDAY");
    const step = remaining >= 0 ? 1 : -1;
    remaining = Math.abs(remaining);
    while (remaining > 0) {
      date = new Date(date.getTime() + step * MS_PER_DAY);
      if (!isWeekend(date)) remaining--;
    }
    return date;
  },
  // Count of business days strictly between the two dates (exclusive of both endpoints).
  WORKDAY_DIFF: (args) => {
    arity("WORKDAY_DIFF", args, 2);
    const start = asDate(args[0], "WORKDAY_DIFF");
    const end = asDate(args[1], "WORKDAY_DIFF");
    const step = end.getTime() >= start.getTime() ? 1 : -1;
    let count = 0;
    let cursor = new Date(start.getTime() + step * MS_PER_DAY);
    while (step > 0 ? cursor.getTime() < end.getTime() : cursor.getTime() > end.getTime()) {
      if (!isWeekend(cursor)) count++;
      cursor = new Date(cursor.getTime() + step * MS_PER_DAY);
    }
    return count * step;
  },
  IS_BEFORE: (args) => {
    arity("IS_BEFORE", args, 2);
    return asDate(args[0], "IS_BEFORE").getTime() < asDate(args[1], "IS_BEFORE").getTime();
  },
  IS_AFTER: (args) => {
    arity("IS_AFTER", args, 2);
    return asDate(args[0], "IS_AFTER").getTime() > asDate(args[1], "IS_AFTER").getTime();
  },
  IS_SAME: (args) => {
    arity("IS_SAME", args, 2, 3);
    const unit = args.length > 2 ? asString(args[2]) : "days";
    const a = asDate(args[0], "IS_SAME");
    const b = asDate(args[1], "IS_SAME");
    if (unit === "days") {
      return formatDate(a, "YYYY-MM-DD") === formatDate(b, "YYYY-MM-DD");
    }
    return diffInUnit(a, b, unit) === 0;
  },
  // Simplified vs. bika: these are scoped modifiers there (affect subsequent
  // date-formatting calls within the same expression). Faithfully porting
  // that requires threading mutable evaluation context through the
  // interpreter for two functions of marginal value at this engine's demo
  // scope — implemented here as validating pass-throughs instead. Documented
  // limitation — see SPEC.md.
  SET_LOCALE: (args) => {
    arity("SET_LOCALE", args, 1);
    return asString(args[0]);
  },
  SET_TIMEZONE: (args) => {
    arity("SET_TIMEZONE", args, 1);
    return asString(args[0]);
  },
};
