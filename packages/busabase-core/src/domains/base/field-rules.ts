// Server orchestration over the field-type registry (field-types.ts): it loops
// over a record's field definitions and delegates the per-type decision to each
// type's `validate` / `compute` spec. No per-type switch lives here — add a type
// to the registry and both functions pick it up. Pure (no DB / server-only).
import type { FieldType } from "../../types";
import { FIELD_TYPES, type FieldDef, isEmptyFieldValue, isSystemFieldType } from "./field-types";

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
        errors.push({ slug: def.slug, type: def.type, message: `${def.name} is required` });
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
  /** Field definitions of the base (only slug + type are read). */
  defs: ReadonlyArray<{ slug: string; type: FieldType }>;
  mode: "create" | "update";
  /** Actor id recorded for created_by / updated_by. */
  actorId: string;
  /** ISO timestamp recorded for created_time / updated_time. */
  timestampIso: string;
  /** Current stored field values — used on update to preserve create-time fields. */
  existing?: Record<string, unknown>;
  /** Resolver for the next sequential auto_number value (create only). */
  nextAutoNumber?: (def: { slug: string; type: FieldType }) => number;
}

/**
 * Produce the server-managed values for a record's system fields, using each
 * system type's `compute` rule from the registry. The caller merges the result
 * over the user-supplied fields (these always win).
 */
export const computeSystemFieldValues = (
  args: ComputeSystemFieldsArgs,
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  const existing = args.existing ?? {};

  for (const def of args.defs) {
    const compute = FIELD_TYPES[def.type].compute;
    if (!compute) continue;
    out[def.slug] = compute({
      mode: args.mode,
      actorId: args.actorId,
      timestampIso: args.timestampIso,
      existing,
      slug: def.slug,
      nextAutoNumber: (slug) => args.nextAutoNumber?.({ slug, type: "auto_number" }) ?? null,
    });
  }

  return out;
};
