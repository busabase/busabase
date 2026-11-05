/**
 * Tiny condition language for workflow branches. No `eval`, no calls, no
 * prototype access. Roots are only `input` (the previous step) and `steps`
 * (every finished step, keyed by node id).
 *
 * Comparisons are strict: `"80"` is not `80`. A condition must end as a
 * boolean (`input.score >= 80`, `steps.capture.record.fields.status == "new"`).
 *
 * `&&` and `||` short-circuit, so a guard protects the comparison after it:
 * `input.score != null && input.score >= 80` is false, not an error, when the
 * score is missing. Brackets reach keys a dot cannot: `fields["follow-up"]`,
 * `input.items[0]`.
 */

const RESERVED = new Set(["__proto__", "constructor", "prototype"]);

export interface ExpressionScope {
  input: Record<string, unknown>;
  steps: Record<string, Record<string, unknown>>;
}

type Comparison = "==" | "!=" | ">=" | "<=" | ">" | "<";

type Expr =
  | { type: "literal"; value: unknown }
  | { type: "path"; root: "input" | "steps"; keys: Array<string | number> }
  | { type: "not"; operand: Expr }
  | { type: "and" | "or"; left: Expr; right: Expr }
  | { type: "compare"; operator: Comparison; left: Expr; right: Expr };

export const evaluateCondition = (source: string, scope: ExpressionScope): boolean => {
  const value = evaluate(new Parser(source).parse(), scope);
  if (typeof value !== "boolean") {
    throw new Error("Condition must evaluate to true or false");
  }
  return value;
};

/**
 * The value of an expression, whatever its type. Used where a step needs a
 * number or a piece of text rather than a yes/no (`=steps.score.score`).
 * A path that leads nowhere is `undefined`: the caller decides if that is fine.
 */
export const evaluateValue = (source: string, scope: ExpressionScope): unknown =>
  evaluate(new Parser(source).parse(), scope);

const evaluate = (expr: Expr, scope: ExpressionScope): unknown => {
  switch (expr.type) {
    case "literal":
      return expr.value;
    case "path":
      return readPath(scope[expr.root], expr.keys);
    case "not":
      return !evaluate(expr.operand, scope);
    case "and":
      return Boolean(evaluate(expr.left, scope)) && Boolean(evaluate(expr.right, scope));
    case "or":
      return Boolean(evaluate(expr.left, scope)) || Boolean(evaluate(expr.right, scope));
    case "compare":
      return compare(expr.operator, evaluate(expr.left, scope), evaluate(expr.right, scope));
  }
};

const readPath = (root: unknown, keys: Array<string | number>): unknown => {
  let current = root;
  for (const key of keys) {
    if (current === null || typeof current !== "object") return undefined;
    if (typeof key === "number") {
      if (!Array.isArray(current)) return undefined;
      current = current[key];
      continue;
    }
    if (RESERVED.has(key) || !Object.hasOwn(current, key)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
};

const compare = (operator: Comparison, left: unknown, right: unknown): boolean => {
  if (operator === "==") return equal(left, right);
  if (operator === "!=") return !equal(left, right);
  if (typeof left !== "number" || typeof right !== "number") {
    throw new Error(`Cannot compare ${describe(left)} ${operator} ${describe(right)}`);
  }
  if (operator === ">=") return left >= right;
  if (operator === "<=") return left <= right;
  if (operator === ">") return left > right;
  return left < right;
};

const equal = (left: unknown, right: unknown): boolean => {
  // A missing value equals null, so `input.score != null` guards both.
  if (left === undefined) left = null;
  if (right === undefined) right = null;
  return left === right;
};

const describe = (value: unknown): string => {
  if (value === null) return "null";
  if (value === undefined) return "missing";
  if (typeof value === "string") return "text";
  return typeof value;
};

class Parser {
  private index = 0;

  constructor(private readonly source: string) {}

  parse(): Expr {
    this.skip();
    if (this.index >= this.source.length) {
      throw new Error("Condition is empty");
    }
    const expr = this.parseOr();
    this.skip();
    if (this.index < this.source.length) {
      throw new Error(`Unexpected "${this.source.slice(this.index)}"`);
    }
    return expr;
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    while (this.consume("||")) {
      left = { type: "or", left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): Expr {
    let left = this.parseComparison();
    while (this.consume("&&")) {
      left = { type: "and", left, right: this.parseComparison() };
    }
    return left;
  }

  private parseComparison(): Expr {
    const left = this.parseUnary();
    const operator = this.readComparison();
    if (!operator) return left;
    return { type: "compare", operator, left, right: this.parseUnary() };
  }

  private parseUnary(): Expr {
    this.skip();
    // `!=` is a comparison, never a negation followed by `=`.
    if (this.source[this.index] === "!" && this.source[this.index + 1] !== "=") {
      this.index += 1;
      return { type: "not", operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    this.skip();
    const char = this.source[this.index];
    if (char === "(") {
      this.index += 1;
      const expr = this.parseOr();
      if (!this.consume(")")) throw new Error("Missing ')'");
      return expr;
    }
    if (char === '"' || char === "'") return { type: "literal", value: this.readString(char) };
    if (char === "-" || (char !== undefined && char >= "0" && char <= "9")) {
      return { type: "literal", value: this.readNumber() };
    }
    return this.readPath();
  }

  private readComparison(): Comparison | null {
    this.skip();
    const operators: Comparison[] = ["==", "!=", ">=", "<=", ">", "<"];
    for (const operator of operators) {
      if (this.source.startsWith(operator, this.index)) {
        this.index += operator.length;
        return operator;
      }
    }
    return null;
  }

  private readPath(): Expr {
    const name = this.readIdent();
    if (name === "true") return { type: "literal", value: true };
    if (name === "false") return { type: "literal", value: false };
    if (name === "null") return { type: "literal", value: null };
    if (name !== "input" && name !== "steps") {
      throw new Error(`Unknown name "${name}"`);
    }
    const keys: Array<string | number> = [];
    for (;;) {
      if (this.consume(".")) {
        this.skip();
        const start = this.index;
        keys.push(this.readIdent());
        if (
          this.source[this.index] === "-" &&
          /[A-Za-z0-9_]/.test(this.source[this.index + 1] ?? "")
        ) {
          // Step ids often have dashes ("on-update"); a dot path cannot hold one.
          const full = /^[A-Za-z0-9_-]+/.exec(this.source.slice(start))?.[0] ?? "";
          throw new Error(
            `A name with a dash needs brackets: write ["${full}"] instead of .${full}`,
          );
        }
        continue;
      }
      if (this.consume("[")) {
        this.skip();
        const char = this.source[this.index];
        if (char === '"' || char === "'") {
          keys.push(this.readString(char));
        } else if (char !== undefined && char >= "0" && char <= "9") {
          const index = this.readNumber();
          if (!Number.isInteger(index)) throw new Error("A list index must be a whole number");
          keys.push(index);
        } else {
          throw new Error(
            `Expected a quoted key or an index at "${this.source.slice(this.index)}"`,
          );
        }
        if (!this.consume("]")) throw new Error("Missing ']'");
        continue;
      }
      return { type: "path", root: name, keys };
    }
  }

  private readIdent(): string {
    this.skip();
    const start = this.index;
    const first = this.source[this.index];
    if (!first || !/[A-Za-z_]/.test(first)) {
      throw new Error(`Expected a name at "${this.source.slice(this.index) || "end"}"`);
    }
    this.index += 1;
    while (this.index < this.source.length && /[A-Za-z0-9_]/.test(this.source[this.index] ?? "")) {
      this.index += 1;
    }
    return this.source.slice(start, this.index);
  }

  private readNumber(): number {
    this.skip();
    const start = this.index;
    if (this.source[this.index] === "-") this.index += 1;
    if (!/[0-9]/.test(this.source[this.index] ?? "")) {
      throw new Error(`Expected a number at "${this.source.slice(start)}"`);
    }
    while (/[0-9]/.test(this.source[this.index] ?? "")) this.index += 1;
    if (this.source[this.index] === ".") {
      this.index += 1;
      if (!/[0-9]/.test(this.source[this.index] ?? "")) {
        throw new Error(`Expected a fraction at "${this.source.slice(start)}"`);
      }
      while (/[0-9]/.test(this.source[this.index] ?? "")) this.index += 1;
    }
    return Number(this.source.slice(start, this.index));
  }

  private readString(quote: '"' | "'"): string {
    this.index += 1;
    let value = "";
    while (this.index < this.source.length) {
      const char = this.source[this.index];
      if (char === quote) {
        this.index += 1;
        return value;
      }
      if (char === "\\") {
        const next = this.source[this.index + 1];
        if (next === undefined) throw new Error("Unterminated string");
        value += next === "n" ? "\n" : next;
        this.index += 2;
        continue;
      }
      value += char;
      this.index += 1;
    }
    throw new Error("Unterminated string");
  }

  private consume(token: string): boolean {
    this.skip();
    if (!this.source.startsWith(token, this.index)) return false;
    this.index += token.length;
    return true;
  }

  private skip(): void {
    while (this.index < this.source.length && /\s/.test(this.source[this.index] ?? "")) {
      this.index += 1;
    }
  }
}
