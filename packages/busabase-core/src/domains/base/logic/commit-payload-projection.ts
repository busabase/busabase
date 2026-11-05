import { type SQL, sql } from "drizzle-orm";
import { busabaseCommits } from "../../../db/schema";

/**
 * Keep only the named top-level keys of a commit payload, inside PostgreSQL, so
 * a read that needs one field never ships every multi-megabyte sibling to Node.
 * Missing keys are simply absent, the same as reading them from the full payload.
 * Read a single requested key directly so unrelated large values never become
 * intermediate rows. For multiple keys, expand once instead of repeatedly
 * detoasting the full payload for each requested key.
 */
export const commitPayloadWithFields = (slugs: Iterable<string>): SQL<Record<string, unknown>> => {
  const unique = [...new Set(slugs)];
  if (unique.length === 0) {
    return sql<Record<string, unknown>>`'{}'::jsonb`;
  }
  if (unique.length === 1) {
    // OFFSET 0 prevents inlining the extraction into both the aggregate and
    // filter, which would detoast the same payload twice. JSON null is retained;
    // only the SQL null returned for a missing key is filtered out.
    return sql<Record<string, unknown>>`coalesce(
      (
        select jsonb_object_agg(entry.key, entry.value)
        from (
          select ${unique[0]}::text as key, ${busabaseCommits.payload} -> ${unique[0]}::text as value
          offset 0
        ) as entry
        where entry.value is not null
      ),
      '{}'::jsonb
    )`;
  }
  return sql<Record<string, unknown>>`coalesce(
    (
      select jsonb_object_agg(payload_entry.key, payload_entry.value)
      from jsonb_each(${busabaseCommits.payload}) as payload_entry(key, value)
      where payload_entry.key in (${sql.join(
        unique.map((slug) => sql`${slug}`),
        sql`, `,
      )})
    ),
    '{}'::jsonb
  )`;
};
