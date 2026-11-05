import { ORPCError } from "@orpc/server";

interface RecordSortInput {
  fieldSlug: string;
  fieldType?: string;
  direction: "asc" | "desc";
}

interface SortableField {
  slug: string;
  type: string;
}

/** How many of the Base's field slugs an unknown-field error lists. */
const LISTED_FIELD_SLUGS = 30;

/**
 * A record listing's explicit `sort`, with its `fieldType` settled.
 *
 * The push-down keys off `fieldType` (only number/date order in SQL), and the
 * contract has always marked it optional. So a caller that named a real date
 * field and left `fieldType` off got the default createdAt order back in BOTH
 * directions, with no error — which is exactly how the AirApp docs show the
 * call. When the Base is known, its schema answers instead.
 *
 * A caller-supplied `fieldType` is kept as given. It is what the dashboard has
 * always sent, and a formula with numeric results only sorts today because its
 * caller says `fieldType: "number"` — the schema would call it `formula`.
 *
 * A slug the Base does not have is a 400, not a no-op: the caller asked for an
 * order, and handing back the default one reads as "sorted". Without a Base
 * (`records.list` across the whole space) a slug names no single field, so
 * `fieldType` is required there — the same reason `valueFilters` needs `baseId`.
 *
 * Shared by `records.list`, `records.listPage` and the demo router's twin.
 */
export const resolveRecordSort = <T extends RecordSortInput>(
  sort: T,
  fields: ReadonlyArray<SortableField> | null,
): T => {
  if (!fields) {
    if (sort.fieldType) return sort;
    throw new ORPCError("BAD_REQUEST", {
      message: `sort: pass baseId (or sort.fieldType) — without a Base, "${sort.fieldSlug}" names no single field, so its type cannot be looked up.`,
      data: { reason: "sort_field_type_unresolvable", fieldSlug: sort.fieldSlug },
    });
  }
  const field = fields.find((entry) => entry.slug === sort.fieldSlug);
  if (!field) {
    const slugs = fields.map((entry) => entry.slug);
    const listed = slugs.slice(0, LISTED_FIELD_SLUGS).join(", ");
    const more = slugs.length > LISTED_FIELD_SLUGS ? `, … (${slugs.length} fields)` : "";
    throw new ORPCError("BAD_REQUEST", {
      message: `sort: this Base has no field "${sort.fieldSlug}". Its fields are: ${listed}${more}.`,
      data: { reason: "unknown_sort_field", fieldSlug: sort.fieldSlug },
    });
  }
  return sort.fieldType ? sort : { ...sort, fieldType: field.type };
};
