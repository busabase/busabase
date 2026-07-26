// ISERROR / IS_ERROR are NOT here — they need their argument's evaluation to
// be caught (not pre-evaluated), so they're special-cased directly in
// ../interpreter.ts's "call" branch, bypassing this registry. Every other
// logical function below receives already-evaluated args like normal.
import { FormulaEvalError } from "../errors";
import { arity, type FormulaFn, isTruthy } from "./value";

export const LOGICAL_FUNCTIONS: Record<string, FormulaFn> = {
  IF: (args) => {
    arity("IF", args, 2, 3);
    return isTruthy(args[0]) ? args[1] : (args[2] ?? null);
  },
  AND: (args) => {
    arity("AND", args, 1, Number.POSITIVE_INFINITY);
    return args.every(isTruthy);
  },
  OR: (args) => {
    arity("OR", args, 1, Number.POSITIVE_INFINITY);
    return args.some(isTruthy);
  },
  NOT: (args) => {
    arity("NOT", args, 1);
    return !isTruthy(args[0]);
  },
  SWITCH: (args) => {
    arity("SWITCH", args, 3, Number.POSITIVE_INFINITY);
    const [value, ...rest] = args;
    for (let i = 0; i + 1 < rest.length; i += 2) {
      if (rest[i] === value) return rest[i + 1];
    }
    // Odd trailing arg (no matching pair) is the default fallback.
    return rest.length % 2 === 1 ? rest[rest.length - 1] : null;
  },
  XOR: (args) => {
    arity("XOR", args, 1, Number.POSITIVE_INFINITY);
    return args.filter(isTruthy).length % 2 === 1;
  },
  ERROR: (args) => {
    arity("ERROR", args, 0, 1);
    throw new FormulaEvalError(typeof args[0] === "string" ? args[0] : "ERROR()");
  },
  BLANK: (args) => {
    arity("BLANK", args, 0);
    return null;
  },
  TRUE: (args) => {
    arity("TRUE", args, 0);
    return true;
  },
  FALSE: (args) => {
    arity("FALSE", args, 0);
    return false;
  },
};
