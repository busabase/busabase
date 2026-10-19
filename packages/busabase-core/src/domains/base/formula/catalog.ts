import type { AstNode } from "./ast";
import { FormulaEvalError } from "./errors";

export interface FormulaCatalogEntry {
  name: string;
  signature: string;
  description: string;
  example: string;
  minArgs: number;
  maxArgs: number;
}

type Definition = [string, string, string, string, number, number?];
const MANY = Number.POSITIVE_INFINITY;

// This metadata describes the supported interpreter, not another product's syntax.
const DEFINITIONS: Definition[] = [
  ["SUM", "value, ...", "Add numbers.", "SUM(1, 2, 3)", 0, MANY],
  ["AVERAGE", "value, ...", "Average numbers.", "AVERAGE(10, 20)", 1, MANY],
  ["MIN", "value, ...", "Smallest number.", "MIN(10, 20)", 1, MANY],
  ["MAX", "value, ...", "Largest number.", "MAX(10, 20)", 1, MANY],
  ["ABS", "number", "Absolute value.", "ABS(-5)", 1],
  ["ROUND", "number, [digits]", "Round to decimal places.", "ROUND(12.345, 2)", 1, 2],
  ["ROUNDUP", "number, [digits]", "Round toward positive infinity.", "ROUNDUP(12.341, 2)", 1, 2],
  [
    "ROUNDDOWN",
    "number, [digits]",
    "Round toward negative infinity.",
    "ROUNDDOWN(12.349, 2)",
    1,
    2,
  ],
  ["COUNT", "value, ...", "Count numeric values.", 'COUNT(1, 2, "text")', 0, MANY],
  ["COUNTA", "value, ...", "Count nonblank values.", "COUNTA(1, BLANK())", 0, MANY],
  ["COUNTALL", "value, ...", "Count all arguments.", "COUNTALL(1, BLANK())", 0, MANY],
  [
    "COUNTIF",
    "value, candidate, ...",
    "Count candidates equal to a value.",
    "COUNTIF(1, 1, 2)",
    2,
    MANY,
  ],
  ["CEILING", "number, [digits]", "Round toward positive infinity.", "CEILING(12.31, 1)", 1, 2],
  ["FLOOR", "number, [digits]", "Round toward negative infinity.", "FLOOR(12.39, 1)", 1, 2],
  ["EVEN", "number", "Round away from zero to an even integer.", "EVEN(3)", 1],
  ["ODD", "number", "Round away from zero to an odd integer.", "ODD(4)", 1],
  ["INT", "number", "Round down to an integer.", "INT(-1.5)", 1],
  ["MOD", "number, divisor", "Remainder with the divisor's sign.", "MOD(7, 3)", 2],
  ["POWER", "number, exponent", "Raise a number to a power.", "POWER(2, 3)", 2],
  ["SQRT", "number", "Square root of a nonnegative number.", "SQRT(9)", 1],
  ["EXP", "number", "Exponential of a number.", "EXP(1)", 1],
  ["LOG", "number, [base]", "Logarithm; base defaults to 10.", "LOG(100)", 1, 2],
  [
    "IF",
    "condition, trueValue, [falseValue]",
    "Choose a value from a condition.",
    'IF(1 > 0, "Yes", "No")',
    2,
    3,
  ],
  ["AND", "condition, ...", "Whether all conditions are true.", "AND(TRUE(), FALSE())", 1, MANY],
  ["OR", "condition, ...", "Whether any condition is true.", "OR(TRUE(), FALSE())", 1, MANY],
  ["NOT", "condition", "Invert a condition.", "NOT(TRUE())", 1],
  [
    "SWITCH",
    "value, match, result, ..., [default]",
    "Choose the result of the first matching value.",
    'SWITCH(1, 1, "One", "Other")',
    3,
    MANY,
  ],
  [
    "XOR",
    "condition, ...",
    "Whether an odd number of conditions are true.",
    "XOR(TRUE(), FALSE())",
    1,
    MANY,
  ],
  ["ERROR", "[message]", "Produce a calculation error.", 'ERROR("Invalid value")', 0, 1],
  ["ISERROR", "expression", "Whether evaluating an expression fails.", "ISERROR(1 / 0)", 1],
  ["IS_ERROR", "expression", "Alias for ISERROR.", "IS_ERROR(1 / 0)", 1],
  ["BLANK", "", "An empty value, distinct from an error.", "BLANK()", 0],
  ["TRUE", "", "Boolean true.", "TRUE()", 0],
  ["FALSE", "", "Boolean false.", "FALSE()", 0],
  [
    "CONCATENATE",
    "text, ...",
    "Join text without a separator.",
    'CONCATENATE("Hello", " world")',
    0,
    MANY,
  ],
  ["LEFT", "text, count", "Characters from the start of text.", 'LEFT("Hello", 2)', 2],
  ["RIGHT", "text, count", "Characters from the end of text.", 'RIGHT("Hello", 2)', 2],
  [
    "MID",
    "text, start, count",
    "Characters starting at a one-based position.",
    'MID("Hello", 2, 3)',
    3,
  ],
  ["LEN", "text", "Text length.", 'LEN("Hello")', 1],
  [
    "FIND",
    "needle, text, [start]",
    "One-based case-sensitive position; errors if absent.",
    'FIND("e", "Hello")',
    2,
    3,
  ],
  [
    "SEARCH",
    "needle, text, [start]",
    "One-based case-insensitive position; errors if absent.",
    'SEARCH("h", "Hello")',
    2,
    3,
  ],
  [
    "REPLACE",
    "text, start, count, replacement",
    "Replace a range of characters.",
    'REPLACE("Hello", 1, 1, "Y")',
    4,
  ],
  [
    "SUBSTITUTE",
    "text, oldText, newText, [occurrence]",
    "Replace matching text.",
    'SUBSTITUTE("Hello", "l", "r")',
    3,
    4,
  ],
  ["REPT", "text, count", "Repeat text, up to 1000000 result characters.", 'REPT("Hi", 2)', 2],
  [
    "TRIM",
    "text",
    "Remove outer spaces and collapse repeated whitespace.",
    'TRIM(" Hello  world " )',
    1,
  ],
  ["UPPER", "text", "Uppercase text.", 'UPPER("Hello")', 1],
  ["LOWER", "text", "Lowercase text.", 'LOWER("Hello")', 1],
  ["T", "value", "Text values unchanged; other types become empty text.", 'T("Hello")', 1],
  ["VALUE", "text", "Parse text as a number.", 'VALUE("12.5")', 1],
  [
    "ENCODE_URL_COMPONENT",
    "text",
    "Encode a URL component.",
    'ENCODE_URL_COMPONENT("hello world")',
    1,
  ],
  ["TODAY", "", "Today's date at UTC midnight.", "TODAY()", 0],
  ["NOW", "", "Current date and time.", "NOW()", 0],
  [
    "FROMNOW",
    "date, [unit]",
    "Duration from now to date; unit defaults to days.",
    'FROMNOW(TODAY(), "hours")',
    1,
    2,
  ],
  [
    "TONOW",
    "date, [unit]",
    "Duration from date to now; unit defaults to days.",
    'TONOW(TODAY(), "hours")',
    1,
    2,
  ],
  [
    "DATEADD",
    "date, count, unit",
    "Add seconds, minutes, hours, days, weeks, months or years.",
    'DATEADD(TODAY(), 7, "days")',
    3,
  ],
  ["DATESTR", "date", "UTC date as YYYY-MM-DD.", "DATESTR(TODAY())", 1],
  ["TIMESTR", "date", "UTC time as HH:mm:ss.", "TIMESTR(NOW())", 1],
  [
    "DATETIME_FORMAT",
    "date, format",
    "Format UTC date with YYYY, MM, DD, HH, mm and ss tokens.",
    'DATETIME_FORMAT(TODAY(), "YYYY-MM-DD")',
    2,
  ],
  [
    "DATETIME_PARSE",
    "text, [format]",
    "Parse ISO/RFC date text; optional format is currently ignored.",
    'DATETIME_PARSE("2026-01-01")',
    1,
    2,
  ],
  [
    "DATETIME_DIFF",
    "fromDate, toDate, unit",
    "Duration from the first date to the second.",
    'DATETIME_DIFF(TODAY(), DATEADD(TODAY(), 7, "days"), "days")',
    3,
  ],
  ["DAY", "date", "UTC day of the month.", "DAY(TODAY())", 1],
  ["MONTH", "date", "UTC month, 1 to 12.", "MONTH(TODAY())", 1],
  ["YEAR", "date", "UTC year.", "YEAR(TODAY())", 1],
  ["HOUR", "date", "UTC hour.", "HOUR(NOW())", 1],
  ["MINUTE", "date", "UTC minute.", "MINUTE(NOW())", 1],
  ["SECOND", "date", "UTC second.", "SECOND(NOW())", 1],
  ["WEEKDAY", "date", "UTC weekday, 1 (Sunday) to 7 (Saturday).", "WEEKDAY(TODAY())", 1],
  [
    "WEEKNUM",
    "date",
    "Week number using the engine's January-first convention.",
    "WEEKNUM(TODAY())",
    1,
  ],
  [
    "WORKDAY",
    "date, days",
    "Add Monday-to-Friday working days; no holiday calendar. Maximum 100000 calendar days.",
    "WORKDAY(TODAY(), 5)",
    2,
  ],
  [
    "WORKDAY_DIFF",
    "fromDate, toDate",
    "Working days strictly between dates; no holiday calendar. Maximum 100000 calendar days.",
    'WORKDAY_DIFF(TODAY(), DATEADD(TODAY(), 7, "days"))',
    2,
  ],
  [
    "IS_BEFORE",
    "date, otherDate",
    "Whether the first date is earlier.",
    "IS_BEFORE(TODAY(), NOW())",
    2,
  ],
  [
    "IS_AFTER",
    "date, otherDate",
    "Whether the first date is later.",
    "IS_AFTER(NOW(), TODAY())",
    2,
  ],
  [
    "IS_SAME",
    "date, otherDate, [unit]",
    "Whether dates match at the specified unit; defaults to days.",
    'IS_SAME(TODAY(), NOW(), "days")',
    2,
    3,
  ],
  [
    "SET_LOCALE",
    "locale",
    "Return locale text; does not alter date formatting.",
    'SET_LOCALE("en")',
    1,
  ],
  [
    "SET_TIMEZONE",
    "timezone",
    "Return timezone text; does not alter date formatting.",
    'SET_TIMEZONE("UTC")',
    1,
  ],
  ["RECORD_ID", "", "Current record identifier.", "RECORD_ID()", 0],
  ["CREATED_TIME", "", "Current record's creation date and time.", "CREATED_TIME()", 0],
  [
    "LAST_MODIFIED_TIME",
    "",
    "Current record's last modification date and time.",
    "LAST_MODIFIED_TIME()",
    0,
  ],
  [
    "ARRAYJOIN",
    "array, [separator]",
    "Join array values as text.",
    'ARRAYJOIN(ARRAYFLATTEN(1, 2), ", ")',
    1,
    2,
  ],
  ["ARRAYUNIQUE", "array", "Unique array values.", "ARRAYUNIQUE(ARRAYFLATTEN(1, 1, 2))", 1],
  [
    "ARRAYCOMPACT",
    "array",
    "Remove blank array values.",
    "ARRAYCOMPACT(ARRAYFLATTEN(1, BLANK()))",
    1,
  ],
  ["ARRAYFLATTEN", "value, ...", "Flatten nested arrays.", "ARRAYFLATTEN(1, 2, 3)", 1, MANY],
];

export const FORMULA_CATALOG: ReadonlyArray<FormulaCatalogEntry> = DEFINITIONS.map(
  ([name, args, description, example, minArgs, maxArgs = minArgs]) => ({
    name,
    signature: `${name}(${args})`,
    description,
    example,
    minArgs,
    maxArgs,
  }),
);
const CATALOG_BY_NAME = new Map(FORMULA_CATALOG.map((entry) => [entry.name, entry]));

export function validateFormulaFunctions(node: AstNode): void {
  if (node.kind === "call") {
    const entry = CATALOG_BY_NAME.get(node.name);
    if (!entry) throw new FormulaEvalError(`Unknown function ${node.name}()`);
    if (node.args.length < entry.minArgs || node.args.length > entry.maxArgs) {
      const expected =
        entry.minArgs === entry.maxArgs
          ? String(entry.minArgs)
          : `${entry.minArgs}-${Number.isFinite(entry.maxArgs) ? entry.maxArgs : "many"}`;
      throw new FormulaEvalError(
        `${node.name}: expected ${expected} argument(s), got ${node.args.length}`,
      );
    }
    node.args.forEach(validateFormulaFunctions);
  } else if (node.kind === "binary") {
    validateFormulaFunctions(node.left);
    validateFormulaFunctions(node.right);
  } else if (node.kind === "unary") {
    validateFormulaFunctions(node.operand);
  }
}
