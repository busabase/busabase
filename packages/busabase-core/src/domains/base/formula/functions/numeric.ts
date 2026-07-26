import { FormulaEvalError } from "../errors";
import { arity, asNumber, divide, type FormulaFn, isBlank, minus, plus, times } from "./value";

export const NUMERIC_FUNCTIONS: Record<string, FormulaFn> = {
  SUM: (args) => args.reduce((total: number, arg) => plus(total, asNumber(arg, "SUM")), 0),
  AVERAGE: (args) => {
    arity("AVERAGE", args, 1, Number.POSITIVE_INFINITY);
    const total = args.reduce((sum: number, arg) => plus(sum, asNumber(arg, "AVERAGE")), 0);
    return divide(total, args.length);
  },
  MIN: (args) => {
    arity("MIN", args, 1, Number.POSITIVE_INFINITY);
    return Math.min(...args.map((arg) => asNumber(arg, "MIN")));
  },
  MAX: (args) => {
    arity("MAX", args, 1, Number.POSITIVE_INFINITY);
    return Math.max(...args.map((arg) => asNumber(arg, "MAX")));
  },
  ABS: (args) => {
    arity("ABS", args, 1);
    return Math.abs(asNumber(args[0], "ABS"));
  },
  ROUND: (args) => {
    arity("ROUND", args, 1, 2);
    const digits = args.length > 1 ? asNumber(args[1], "ROUND") : 0;
    const factor = 10 ** digits;
    return Math.round(times(asNumber(args[0], "ROUND"), factor)) / factor;
  },
  ROUNDUP: (args) => {
    arity("ROUNDUP", args, 1, 2);
    const digits = args.length > 1 ? asNumber(args[1], "ROUNDUP") : 0;
    const factor = 10 ** digits;
    return Math.ceil(times(asNumber(args[0], "ROUNDUP"), factor)) / factor;
  },
  ROUNDDOWN: (args) => {
    arity("ROUNDDOWN", args, 1, 2);
    const digits = args.length > 1 ? asNumber(args[1], "ROUNDDOWN") : 0;
    const factor = 10 ** digits;
    return Math.floor(times(asNumber(args[0], "ROUNDDOWN"), factor)) / factor;
  },
  COUNT: (args) => args.filter((arg) => typeof arg === "number").length,
  COUNTA: (args) => args.filter((arg) => !isBlank(arg)).length,
  COUNTALL: (args) => args.length,
  COUNTIF: (args) => {
    arity("COUNTIF", args, 2, Number.POSITIVE_INFINITY);
    const [needle, ...haystack] = args;
    return haystack.filter((arg) => arg === needle).length;
  },
  CEILING: (args) => {
    arity("CEILING", args, 1, 2);
    const digits = args.length > 1 ? asNumber(args[1], "CEILING") : 0;
    const factor = 10 ** digits;
    return Math.ceil(times(asNumber(args[0], "CEILING"), factor)) / factor;
  },
  FLOOR: (args) => {
    arity("FLOOR", args, 1, 2);
    const digits = args.length > 1 ? asNumber(args[1], "FLOOR") : 0;
    const factor = 10 ** digits;
    return Math.floor(times(asNumber(args[0], "FLOOR"), factor)) / factor;
  },
  EVEN: (args) => {
    arity("EVEN", args, 1);
    const n = asNumber(args[0], "EVEN");
    const rounded = n >= 0 ? Math.ceil(n) : Math.floor(n);
    return rounded % 2 === 0 ? rounded : rounded + (n >= 0 ? 1 : -1);
  },
  ODD: (args) => {
    arity("ODD", args, 1);
    const n = asNumber(args[0], "ODD");
    const rounded = n >= 0 ? Math.ceil(n) : Math.floor(n);
    return Math.abs(rounded % 2) === 1 ? rounded : rounded + (n >= 0 ? 1 : -1);
  },
  // Matches spreadsheet INT semantics (floor toward -infinity), NOT
  // truncate-toward-zero — INT(-1.5) is -2, not -1.
  INT: (args) => {
    arity("INT", args, 1);
    return Math.floor(asNumber(args[0], "INT"));
  },
  MOD: (args) => {
    arity("MOD", args, 2);
    const a = asNumber(args[0], "MOD");
    const b = asNumber(args[1], "MOD");
    if (b === 0) {
      throw new FormulaEvalError("MOD: division by zero");
    }
    return minus(a, times(Math.floor(divide(a, b)), b));
  },
  POWER: (args) => {
    arity("POWER", args, 2);
    return asNumber(args[0], "POWER") ** asNumber(args[1], "POWER");
  },
  SQRT: (args) => {
    arity("SQRT", args, 1);
    const n = asNumber(args[0], "SQRT");
    if (n < 0) {
      throw new FormulaEvalError("SQRT: argument must be non-negative");
    }
    return Math.sqrt(n);
  },
  EXP: (args) => {
    arity("EXP", args, 1);
    return Math.exp(asNumber(args[0], "EXP"));
  },
  LOG: (args) => {
    arity("LOG", args, 1, 2);
    const n = asNumber(args[0], "LOG");
    if (n <= 0) {
      throw new FormulaEvalError("LOG: argument must be positive");
    }
    const base = args.length > 1 ? asNumber(args[1], "LOG") : 10;
    return Math.log(n) / Math.log(base);
  },
};
