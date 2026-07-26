// Shared FormulaValue type + coercion helpers + precision-safe arithmetic,
// used by every function-category file and by ../interpreter.ts's binary
// operator evaluation. See ../SPEC.md for the widening rationale (Date +
// array support) and why arithmetic is precision-safe (not raw floats).
import { FormulaEvalError } from "../errors";

export type FormulaValue = number | string | boolean | Date | FormulaValue[] | null;

export const asNumber = (value: FormulaValue, fnName: string): number => {
  if (value instanceof Date) return value.getTime();
  if (Array.isArray(value)) {
    throw new FormulaEvalError(`${fnName}: expected a number, got an array`);
  }
  const n = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(n)) {
    throw new FormulaEvalError(`${fnName}: expected a number, got ${JSON.stringify(value)}`);
  }
  return n;
};

export const asString = (value: FormulaValue): string => {
  if (value === null) return "";
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(asString).join(", ");
  return String(value);
};

export const asDate = (value: FormulaValue, fnName: string): Date => {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  throw new FormulaEvalError(`${fnName}: expected a date, got ${JSON.stringify(value)}`);
};

export const asArray = (value: FormulaValue, fnName: string): FormulaValue[] => {
  if (Array.isArray(value)) return value;
  if (value === null) return [];
  throw new FormulaEvalError(`${fnName}: expected an array, got ${JSON.stringify(value)}`);
};

export const isBlank = (value: FormulaValue): boolean =>
  value === null || value === "" || (Array.isArray(value) && value.length === 0);

export const isTruthy = (value: FormulaValue): boolean => {
  if (value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (value instanceof Date) return !Number.isNaN(value.getTime());
  return Boolean(value) && value !== "0";
};

export const arity = (name: string, args: FormulaValue[], min: number, max = min): void => {
  if (args.length < min || args.length > max) {
    const expected = min === max ? `${min}` : `${min}-${max}`;
    throw new FormulaEvalError(`${name}: expected ${expected} argument(s), got ${args.length}`);
  }
};

export type FormulaFn = (args: FormulaValue[]) => FormulaValue;

// ── precision-safe arithmetic ────────────────────────────────────────────────
// Raw JS float math (0.1 + 0.2 === 0.30000000000000004) is unacceptable for
// money-shaped formulas. Scale both operands to integers by their combined
// decimal-place count, do integer math, then scale back — the standard
// technique decimal-unsafe-JS libraries use, ported here dependency-free (no
// decimal.js/big.js) to match the rest of this engine's zero-dependency design.
// This does NOT (and cannot) make inherently non-terminating results like
// 1/3 exact — only representation-error cases like 0.1+0.2.
const decimalPlaces = (n: number): number => {
  if (!Number.isFinite(n)) return 0;
  const str = n.toString();
  if (str.includes("e-")) {
    const [mantissa, exp] = str.split("e-");
    const mantissaDecimals = mantissa.split(".")[1]?.length ?? 0;
    return Number(exp) + mantissaDecimals;
  }
  const decimals = str.split(".")[1];
  return decimals ? decimals.length : 0;
};

const toScaledInt = (n: number, decimals: number): number => Math.round(n * 10 ** decimals);

export const plus = (a: number, b: number): number => {
  const decimals = Math.max(decimalPlaces(a), decimalPlaces(b));
  const factor = 10 ** decimals;
  return (toScaledInt(a, decimals) + toScaledInt(b, decimals)) / factor;
};

export const minus = (a: number, b: number): number => plus(a, -b);

export const times = (a: number, b: number): number => {
  const da = decimalPlaces(a);
  const db = decimalPlaces(b);
  const factor = 10 ** (da + db);
  return (toScaledInt(a, da) * toScaledInt(b, db)) / factor;
};

export const divide = (a: number, b: number): number => {
  if (b === 0) {
    throw new FormulaEvalError("Division by zero");
  }
  const decimals = Math.max(decimalPlaces(a), decimalPlaces(b));
  return toScaledInt(a, decimals) / toScaledInt(b, decimals);
};
