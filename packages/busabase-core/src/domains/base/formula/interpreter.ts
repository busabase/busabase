// Tree-walking interpreter — evaluates an AstNode against a field resolver.
// `resolveField` is the caller's job (see ../field-types.ts's formula compute):
// it looks up a sibling field's value from the record being written and
// coerces it to a FormulaValue (number for `number`, string for text-like
// types, a Date for `date`, an array for `relation`/`multiselect`, etc.) —
// this module has no knowledge of busabase's field-type system.
import type { AstNode } from "./ast";
import { FormulaEvalError } from "./errors";
import { FORMULA_FUNCTIONS } from "./functions";
import {
  asNumber,
  asString,
  divide,
  type FormulaValue,
  isTruthy,
  minus,
  plus,
  times,
} from "./functions/value";

export type FieldResolver = (slug: string) => FormulaValue;

/**
 * Per-record metadata for the RECORD_ID / CREATED_TIME / LAST_MODIFIED_TIME
 * functions — these read record bookkeeping, not a field value, so they
 * can't go through `resolveField`/FORMULA_FUNCTIONS like every other
 * function. Optional: omitting it makes those three functions resolve to
 * `null` (useful for tests that don't care about record identity).
 */
export interface FormulaRecordContext {
  recordId: string | null;
  createdAtIso: string | null;
  lastModifiedIso: string | null;
}

const RECORD_FUNCTIONS = new Set(["RECORD_ID", "CREATED_TIME", "LAST_MODIFIED_TIME"]);
const ERROR_CHECK_FUNCTIONS = new Set(["ISERROR", "IS_ERROR"]);

export function evaluateAst(
  node: AstNode,
  resolveField: FieldResolver,
  recordContext?: FormulaRecordContext,
): FormulaValue {
  switch (node.kind) {
    case "number":
      return node.value;
    case "string":
      return node.value;
    case "field_ref":
      return resolveField(node.slug);
    case "unary": {
      const operand = evaluateAst(node.operand, resolveField, recordContext);
      return node.op === "-" ? -asNumber(operand, "unary -") : !isTruthy(operand);
    }
    case "binary":
      return evaluateBinary(
        node.op,
        evaluateAst(node.left, resolveField, recordContext),
        evaluateAst(node.right, resolveField, recordContext),
      );
    case "call": {
      // ISERROR/IS_ERROR need their argument's EVALUATION caught, not its
      // (already-thrown) result — bypasses FORMULA_FUNCTIONS' eager
      // arg-array convention entirely.
      if (ERROR_CHECK_FUNCTIONS.has(node.name)) {
        if (node.args.length !== 1) {
          throw new FormulaEvalError(`${node.name}: expected 1 argument, got ${node.args.length}`);
        }
        try {
          evaluateAst(node.args[0], resolveField, recordContext);
          return false;
        } catch (error) {
          if (error instanceof FormulaEvalError) return true;
          throw error;
        }
      }
      // RECORD_ID / CREATED_TIME / LAST_MODIFIED_TIME read record
      // bookkeeping (see FormulaRecordContext), not a resolved field value.
      if (RECORD_FUNCTIONS.has(node.name)) {
        if (node.args.length !== 0) {
          throw new FormulaEvalError(`${node.name}: expected 0 arguments, got ${node.args.length}`);
        }
        if (node.name === "RECORD_ID") return recordContext?.recordId ?? null;
        if (node.name === "CREATED_TIME") {
          return recordContext?.createdAtIso ? new Date(recordContext.createdAtIso) : null;
        }
        return recordContext?.lastModifiedIso ? new Date(recordContext.lastModifiedIso) : null;
      }
      const fn = FORMULA_FUNCTIONS[node.name];
      if (!fn) {
        throw new FormulaEvalError(`Unknown function ${node.name}()`);
      }
      return fn(node.args.map((arg) => evaluateAst(arg, resolveField, recordContext)));
    }
    default: {
      const exhaustive: never = node;
      throw new FormulaEvalError(`Unhandled AST node: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function evaluateBinary(op: string, left: FormulaValue, right: FormulaValue): FormulaValue {
  switch (op) {
    case "+":
      return plus(asNumber(left, "+"), asNumber(right, "+"));
    case "-":
      return minus(asNumber(left, "-"), asNumber(right, "-"));
    case "*":
      return times(asNumber(left, "*"), asNumber(right, "*"));
    case "/":
      return divide(asNumber(left, "/"), asNumber(right, "/"));
    case "%": {
      const divisor = asNumber(right, "%");
      if (divisor === 0) {
        throw new FormulaEvalError("Division by zero");
      }
      return asNumber(left, "%") % divisor;
    }
    case "&":
      return asString(left) + asString(right);
    case "&&":
      return isTruthy(left) && isTruthy(right);
    case "||":
      return isTruthy(left) || isTruthy(right);
    case "==":
      return compareEqual(left, right);
    case "!=":
      return !compareEqual(left, right);
    case ">":
      return compareOrdered(left, right) > 0;
    case ">=":
      return compareOrdered(left, right) >= 0;
    case "<":
      return compareOrdered(left, right) < 0;
    case "<=":
      return compareOrdered(left, right) <= 0;
    default:
      throw new FormulaEvalError(`Unknown operator "${op}"`);
  }
}

// Non-throwing numeric coercion for comparisons only — two non-numeric,
// non-equal strings ("Buy" vs "Hold") must compare as simply "not equal",
// not throw, so `==`/`!=` stay safe to use on any two formula values.
const toComparableNumber = (value: FormulaValue): number => {
  if (value instanceof Date) return value.getTime();
  if (Array.isArray(value)) return Number.NaN;
  const n = typeof value === "number" ? value : Number(value);
  return n;
};

const compareEqual = (left: FormulaValue, right: FormulaValue): boolean => {
  if (left instanceof Date || right instanceof Date) {
    return toComparableNumber(left) === toComparableNumber(right);
  }
  if (left === right) return true;
  const ln = toComparableNumber(left);
  const rn = toComparableNumber(right);
  return !Number.isNaN(ln) && !Number.isNaN(rn) && ln === rn;
};

const compareOrdered = (left: FormulaValue, right: FormulaValue): number => {
  if (left instanceof Date || right instanceof Date) {
    return toComparableNumber(left) - toComparableNumber(right);
  }
  if (typeof left === "string" && typeof right === "string") {
    return left < right ? -1 : left > right ? 1 : 0;
  }
  return asNumber(left, "comparison") - asNumber(right, "comparison");
};
