// Formula error types. Kept as plain Error subclasses (not ORPCError) — this
// module is pure/isomorphic (no server-only import), so the oRPC boundary is
// the caller's job (see ../field-types.ts's formula compute, which wraps these
// into a user-facing validation message).

export class FormulaError extends Error {}

/** Lex/parse-time syntax error (unexpected character, unbalanced parens, …). */
export class FormulaSyntaxError extends FormulaError {}

/** A `{slug}` reference that doesn't resolve to a field on the base. */
export class FormulaUnknownFieldError extends FormulaError {
  constructor(public readonly slug: string) {
    super(`Unknown field reference: {${slug}}`);
  }
}

/** A formula referencing its own field — a 1-node cycle, always rejected
 *  regardless of the dependency graph (see also FormulaCycleError for the
 *  multi-field case). */
export class FormulaSelfRefError extends FormulaError {
  constructor(public readonly slug: string) {
    super(`Formula cannot reference itself: {${slug}}`);
  }
}

/** A cycle spanning 2+ formula fields (A references B references A, or
 *  longer), detected by ../formula/dependency.ts's whole-base graph check —
 *  not visible from any single field's own expression. */
export class FormulaCycleError extends FormulaError {
  constructor(public readonly cycleSlugs: string[]) {
    super(`Formula dependency cycle: ${cycleSlugs.join(" → ")}`);
  }
}

/** Runtime error (unknown function, wrong arg count/type, division by zero). */
export class FormulaEvalError extends FormulaError {}
