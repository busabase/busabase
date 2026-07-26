// Recursive-descent parser over the lexer's token stream, producing an AstNode.
// Precedence (low → high), same grouping bika/vikadata use:
//   &(concat)  →  ||  →  &&  →  ==,!=,>,>=,<,<=  →  +,-  →  *,/,%  →  unary -,!  →  primary
import type { AstNode } from "./ast";
import { FormulaSyntaxError } from "./errors";
import { type Token, tokenize } from "./lexer";

class Parser {
  private pos = 0;
  constructor(private readonly tokens: Token[]) {}

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    return this.tokens[this.pos++];
  }

  private expect(type: Token["type"], expected: string): Token {
    const token = this.peek();
    if (token.type !== type) {
      throw new FormulaSyntaxError(
        `Expected ${expected} at position ${token.pos}, got "${token.value || "<eof>"}"`,
      );
    }
    return this.advance();
  }

  parse(): AstNode {
    const node = this.parseConcat();
    this.expect("eof", "end of expression");
    return node;
  }

  private parseConcat(): AstNode {
    let left = this.parseOr();
    while (this.peek().type === "op" && this.peek().value === "&") {
      this.advance();
      left = { kind: "binary", op: "&", left, right: this.parseOr() };
    }
    return left;
  }

  private parseOr(): AstNode {
    let left = this.parseAnd();
    while (this.peek().type === "op" && this.peek().value === "||") {
      this.advance();
      left = { kind: "binary", op: "||", left, right: this.parseAnd() };
    }
    return left;
  }

  private parseAnd(): AstNode {
    let left = this.parseComparison();
    while (this.peek().type === "op" && this.peek().value === "&&") {
      this.advance();
      left = { kind: "binary", op: "&&", left, right: this.parseComparison() };
    }
    return left;
  }

  private static readonly COMPARISON_OPS = new Set(["==", "!=", ">", ">=", "<", "<="]);

  private parseComparison(): AstNode {
    let left = this.parseAdditive();
    while (this.peek().type === "op" && Parser.COMPARISON_OPS.has(this.peek().value)) {
      const op = this.advance().value;
      left = { kind: "binary", op, left, right: this.parseAdditive() };
    }
    return left;
  }

  private parseAdditive(): AstNode {
    let left = this.parseMultiplicative();
    while (this.peek().type === "op" && (this.peek().value === "+" || this.peek().value === "-")) {
      const op = this.advance().value;
      left = { kind: "binary", op, left, right: this.parseMultiplicative() };
    }
    return left;
  }

  private parseMultiplicative(): AstNode {
    let left = this.parseUnary();
    while (
      this.peek().type === "op" &&
      (this.peek().value === "*" || this.peek().value === "/" || this.peek().value === "%")
    ) {
      const op = this.advance().value;
      left = { kind: "binary", op, left, right: this.parseUnary() };
    }
    return left;
  }

  private parseUnary(): AstNode {
    if (this.peek().type === "op" && (this.peek().value === "-" || this.peek().value === "!")) {
      const op = this.advance().value as "-" | "!";
      return { kind: "unary", op, operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): AstNode {
    const token = this.peek();

    if (token.type === "number") {
      this.advance();
      return { kind: "number", value: Number(token.value) };
    }
    if (token.type === "string") {
      this.advance();
      return { kind: "string", value: token.value };
    }
    if (token.type === "field_ref") {
      this.advance();
      return { kind: "field_ref", slug: token.value };
    }
    if (token.type === "lparen") {
      this.advance();
      const inner = this.parseConcat();
      this.expect("rparen", '")"');
      return inner;
    }
    if (token.type === "ident") {
      this.advance();
      this.expect("lparen", '"(" after function name');
      const args: AstNode[] = [];
      if (this.peek().type !== "rparen") {
        args.push(this.parseConcat());
        while (this.peek().type === "comma") {
          this.advance();
          args.push(this.parseConcat());
        }
      }
      this.expect("rparen", '")" to close function call');
      return { kind: "call", name: token.value.toUpperCase(), args };
    }

    throw new FormulaSyntaxError(
      `Unexpected token "${token.value || "<eof>"}" at position ${token.pos}`,
    );
  }
}

export function parseFormula(expression: string): AstNode {
  return new Parser(tokenize(expression)).parse();
}
