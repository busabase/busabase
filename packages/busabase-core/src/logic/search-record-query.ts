import "server-only";

import { and, inArray, type SQL, type SQLWrapper, sql } from "drizzle-orm";
import { busabaseFieldValues } from "../db/schema";

/** Ordinary search treats LIKE metacharacters as text; grep owns patterns. */
export const literalSearchPattern = (query: string): string =>
  `%${query.replace(/[\\%_]/g, "\\$&")}%`;

/**
 * A substring with no three consecutive word characters cannot use a selective
 * trigram lookup. Count Unicode characters so two-character CJK queries retain
 * substring semantics. Conservative fallback also covers separated short words.
 */
export const needsScopedRecordScan = (query: string): boolean => !/[\p{L}\p{N}]{3}/u.test(query);

export const recordSearchSource = (input: {
  query: string;
  eligibility: SQL | undefined;
  eligibleBases: SQLWrapper;
}) => {
  const vector = sql`to_tsvector('simple', coalesce(${busabaseFieldValues.valueText}, ''))`;
  if (!needsScopedRecordScan(input.query)) {
    return { source: busabaseFieldValues, vector, eligibility: input.eligibility };
  }

  // Preserve the original table name for the existing column references. This
  // barrier keeps global trigram scans out of short-query matching and reuses
  // the vector for filtering and ranking. No LIMIT before ACL/grouping/sorting.
  const source = sql`(
    with search_candidates as materialized (
      select change_request_id, record_id, value_text, field_slug, updated_at,
        created_at, ${vector} as search_vector
      from ${busabaseFieldValues}
      where ${and(input.eligibility, inArray(busabaseFieldValues.baseId, input.eligibleBases))}
    )
    select * from search_candidates
  ) as "busabase_field_values"`;

  return {
    source,
    vector: sql`"busabase_field_values"."search_vector"`,
    eligibility: undefined,
  };
};
