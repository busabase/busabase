// Hand-rolled lexer — same shape as bika/vikadata's formula_parser/lexer
// (regex-token-table driven), trimmed to the operators/literals this engine
// actually supports. See ../formula/index.ts for the overall design note.
import { FormulaSyntaxError } from "./errors";

export type TokenType =
  | "number"
  | "string"
  | "field_ref"
  | "ident"
  | "op"
  | "lparen"
  | "rparen"
  | "comma"
  | "eof";

export interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

// Longest-match-first: multi-char operators before their single-char prefixes.
const OPERATORS = [
  ">=",
  "<=",
  "==",
  "!=",
  "&&",
  "||",
  "+",
  "-",
  "*",
  "/",
  "%",
  ">",
  "<",
  "&",
] as const;

export function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = expression.length;

  while (i < len) {
    const ch = expression[i];

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }

    if (ch === "(") {
      tokens.push({ type: "lparen", value: ch, pos: i });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: "rparen", value: ch, pos: i });
      i++;
      continue;
    }
    if (ch === ",") {
      tokens.push({ type: "comma", value: ch, pos: i });
      i++;
      continue;
    }

    // {field_slug} reference — the same `{...}` convention bika/vikadata use,
    // just resolving to our field slug instead of their internal field id.
    if (ch === "{") {
      const close = expression.indexOf("}", i + 1);
      if (close === -1) {
        throw new FormulaSyntaxError(`Unclosed field reference starting at position ${i}`);
      }
      const slug = expression.slice(i + 1, close).trim();
      if (!slug) {
        throw new FormulaSyntaxError(`Empty field reference at position ${i}`);
      }
      tokens.push({ type: "field_ref", value: slug, pos: i });
      i = close + 1;
      continue;
    }

    // "..." / '...' string literal (no escape sequences — formulas are short
    // expressions, not a general string-literal grammar).
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const close = expression.indexOf(quote, i + 1);
      if (close === -1) {
        throw new FormulaSyntaxError(`Unterminated string starting at position ${i}`);
      }
      tokens.push({ type: "string", value: expression.slice(i + 1, close), pos: i });
      i = close + 1;
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(expression[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < len && /[0-9.]/.test(expression[j])) j++;
      const raw = expression.slice(i, j);
      if (!/^\d+(\.\d+)?$/.test(raw)) {
        throw new FormulaSyntaxError(`Invalid number literal "${raw}" at position ${i}`);
      }
      tokens.push({ type: "number", value: raw, pos: i });
      i = j;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < len && /[A-Za-z0-9_]/.test(expression[j])) j++;
      tokens.push({ type: "ident", value: expression.slice(i, j), pos: i });
      i = j;
      continue;
    }

    const op = OPERATORS.find((candidate) => expression.startsWith(candidate, i));
    if (op) {
      tokens.push({ type: "op", value: op, pos: i });
      i += op.length;
      continue;
    }

    throw new FormulaSyntaxError(`Unexpected character "${ch}" at position ${i}`);
  }

  tokens.push({ type: "eof", value: "", pos: len });
  return tokens;
}
