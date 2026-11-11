/**
 * What every agent-facing surface must say about a record page.
 *
 * `records.list`, `record_query`, and `busabase-cli records list --output json`
 * all return `{ records, nextCursor }`. Field values are not on the wrapper and
 * not on the record's bookkeeping keys. Agents that treat `records` /
 * `nextCursor` as columns, or that look for a top-level `fields` bag, report
 * the query as unparseable and then invent values.
 */
export const RECORD_PAGE_FIELD_GUIDANCE =
  "A record page is `{ records, nextCursor }`. `nextCursor` only means another page exists; pass it back as `cursor` and do not treat it as data. " +
  "Each record's current business values live only in `records[].headCommit.payload`, keyed by field slug. Read that object. " +
  "`records` and `nextCursor` are the page wrapper, not fields. Commit metadata (`headCommit.id`, `author`, `message`) and hydrated parents (`base`, `createdByUser`) are not field values. " +
  "If a slug is absent from `payload`, the field is empty — do not invent it from the wrapper or from a sibling key.";
