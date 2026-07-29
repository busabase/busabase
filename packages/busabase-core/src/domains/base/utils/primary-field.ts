import type { BaseFieldVO } from "busabase-contract/types";

type PositionedField = Pick<BaseFieldVO, "position">;

export const PRIMARY_FIELD_DELETE_MESSAGE =
  "Set another record title field before deleting this one.";

/** A Base's lowest-position active field supplies its record title. */
export const getPrimaryField = <Field extends PositionedField>(
  base: { fields: Field[] } | null | undefined,
): Field | null => {
  const [first, ...rest] = base?.fields ?? [];
  if (!first) return null;

  return rest.reduce(
    (primary, field) => (field.position < primary.position ? field : primary),
    first,
  );
};

export const isPrimaryField = (
  base: { fields: Pick<BaseFieldVO, "id" | "position">[] } | null | undefined,
  fieldId: string,
) => getPrimaryField(base)?.id === fieldId;
