// Server orchestration over the field-type registry (field-types.ts): it loops
// over a record's field definitions and delegates the per-type decision to each
// type's `validate` / `compute` spec. No per-type switch lives here — add a type
// to the registry and both functions pick it up. Pure (no DB / server-only).
import type { FieldType } from "busabase-contract/types";
import {
  FIELD_TYPES,
  type FieldDef,
  fieldDisplayName,
  isEmptyFieldValue,
  isSystemFieldType,
} from "./field-types";
import {
  detectFieldCycle,
  FormulaCycleError,
  FormulaError,
  topologicalFieldOrder,
  validateFormulaExpression,
} from "./formula";

export type { FieldDef } from "./field-types";

/**
 * Structural validation for a `formula` field's `options.formula.expression`
 * — parses it and checks every `{slug}` reference exists among `siblingFields`
 * and isn't itself (chaining to another formula field IS allowed). Then runs
 * a whole-graph cycle check as if this field's new expression were already
 * saved (replacing any existing same-slug entry in `siblingFields` — covers
 * both creating a new formula field and editing an existing one's
 * expression): a chain spanning multiple formula fields can only be seen
 * from the full graph, not from any single expression. A no-op for every
 * other field type. Throws `FormulaError` subclasses (callers translate to
 * their own error type — e.g. field-ops.ts wraps them as ORPCError
 * BAD_REQUEST).
 */
export const assertValidFormulaField = (
  type: FieldType,
  slug: string,
  options: { formula?: { expression?: string } } | null | undefined,
  siblingFields: ReadonlyArray<{
    slug: string;
    type: FieldType;
    options?: { formula?: { expression?: string } } | null;
  }>,
): void => {
  if (type !== "formula") return;
  const expression = options?.formula?.expression;
  if (!expression) {
    throw new FormulaError(`Formula field requires options.formula.expression: ${slug}`);
  }
  const siblingTypeBySlug = new Map(siblingFields.map((field) => [field.slug, field.type]));
  validateFormulaExpression(expression, slug, siblingTypeBySlug);
  const graphFields = [
    ...siblingFields.filter((field) => field.slug !== slug),
    { slug, type, options: { formula: { expression } } },
  ];
  const cycle = detectFieldCycle(graphFields);
  if (cycle) {
    throw new FormulaCycleError(cycle);
  }
};

export interface FieldValidationError {
  slug: string;
  type: FieldType;
  message: string;
}

/**
 * Validate a record's field values against the base's field definitions, using
 * each field type's `validate` rule from the registry.
 *
 * System fields and empty optional values are skipped; a missing required field
 * is reported. Unknown field slugs are ignored (the projection layer drops them).
 * Returns one error per offending field; an empty array means valid.
 */
export const validateRecordFields = (
  fields: Record<string, unknown>,
  defs: ReadonlyArray<FieldDef>,
): FieldValidationError[] => {
  const errors: FieldValidationError[] = [];

  for (const def of defs) {
    // System fields are server-managed; never validate client input for them.
    if (isSystemFieldType(def.type)) continue;

    const value = fields[def.slug];

    if (isEmptyFieldValue(value)) {
      if (def.required) {
        errors.push({
          slug: def.slug,
          type: def.type,
          message: `${fieldDisplayName(def)} is required`,
        });
      }
      continue;
    }

    const message = FIELD_TYPES[def.type].validate?.(value, def) ?? null;
    if (message) {
      errors.push({ slug: def.slug, type: def.type, message });
    }
  }

  return errors;
};

export interface ComputeSystemFieldsArgs {
  /** Field definitions of the base. */
  defs: ReadonlyArray<FieldDef>;
  mode: "create" | "update";
  /** Actor id recorded for created_by / updated_by. */
  actorId: string;
  /** ISO timestamp recorded for created_time / updated_time. */
  timestampIso: string;
  /** Current stored field values — used on update to preserve create-time fields. */
  existing?: Record<string, unknown>;
  /**
   * The record's user-supplied (non-system) field values for this write —
   * used by `formula` to resolve sibling `{slug}` references. Not needed by
   * any other computed type.
   */
  values?: Record<string, unknown>;
  /** Resolver for the next sequential auto_number value (create only). */
  nextAutoNumber?: (def: { slug: string; type: FieldType }) => number;
  /** The record's own id — used by `formula`'s `RECORD_ID()`. Null on create
   *  (not yet assigned) or when the caller has no record context. */
  recordId?: string | null;
  /** ISO timestamp the record was originally created — used by `formula`'s
   *  `CREATED_TIME()`. Defaults to `timestampIso` (this write IS the
   *  creation) when omitted, which is correct for `mode: "create"`. */
  recordCreatedAtIso?: string | null;
}

/**
 * Produce the server-managed values for a record's system fields, using each
 * system type's `compute` rule from the registry. The caller merges the result
 * over the user-supplied fields (these always win).
 *
 * Computed in dependency-first (topological) order, not `defs` array order —
 * required for `formula` fields chained to other `formula` fields: each
 * computed value is fed back into `values` immediately, so a dependent
 * formula sees its dependency's freshly-computed result in the SAME pass,
 * not just the pre-write `values`. Every other computed type ignores
 * `values` entirely, so this reordering is a no-op for them. Falls back to
 * `defs` array order if the graph has a cycle (shouldn't happen —
 * field-ops.ts rejects cycles at field create/edit time — but compute must
 * never infinite-loop or throw on stale/corrupted data).
 */
export const computeSystemFieldValues = (
  args: ComputeSystemFieldsArgs,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  const existing = args.existing ?? {};
  const values: Record<string, unknown> = { ...existing, ...(args.values ?? {}) };
  const defsBySlug = new Map(args.defs.map((def) => [def.slug, def]));
  const order = topologicalFieldOrder(args.defs) ?? args.defs.map((def) => def.slug);

  for (const slug of order) {
    const def = defsBySlug.get(slug);
    if (!def) continue;
    const compute = FIELD_TYPES[def.type].compute;
    if (!compute) continue;
    const computed = compute({
      mode: args.mode,
      actorId: args.actorId,
      def,
      defs: args.defs,
      values,
      timestampIso: args.timestampIso,
      existing,
      slug: def.slug,
      nextAutoNumber: (s) => args.nextAutoNumber?.({ slug: s, type: "auto_number" }) ?? null,
      recordId: args.recordId ?? null,
      recordCreatedAtIso: args.recordCreatedAtIso ?? args.timestampIso,
    });
    out[def.slug] = computed;
    values[def.slug] = computed;
  }

  return out;
};
