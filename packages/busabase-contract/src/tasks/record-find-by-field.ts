import type { BusabaseTaskClient, TaskDefinition } from "./types";

/**
 * "Find records where a field equals this text."
 *
 * The endpoint behind it is `GET /records/search`, and that name oversells it:
 * it is not full-text search over records (that is the top-level `search` task),
 * it is an exact-ish match on one named field. An agent that reads "records
 * search" in a tool list will reach for it to answer "find posts about X" and
 * get nothing back, with no signal that it used the wrong tool.
 *
 * `busabase-cli` renamed this to `records by-field-text` for exactly that reason
 * and recorded the substitution in `GENERATED_SKIP` so the auto-generated
 * fallback would not re-expose the confusing name alongside it.
 *
 * This is the deliberately thin end of the task layer — one task, one endpoint,
 * no dispatch. It is here to show that renaming and re-describing alone is worth
 * doing, and that a task does not have to compose endpoints to earn its place.
 */

export interface RecordFindByFieldInput {
  fieldSlug: string;
  valueText: string;
  baseId?: string;
  limit?: number;
}

export const recordFindByFieldTask: TaskDefinition<RecordFindByFieldInput> = {
  name: "record_find_by_field",
  cliPath: ["records", "by-field-text"],
  summary: "Find records whose named field matches a text value",
  guidance:
    "Matches one specific field against one value — this is a lookup, not a search. " +
    "To search across record content, Docs and files by keyword, use the `search` tool instead; " +
    "to scan with a regular expression, use `grep`.",
  annotations: { readOnly: true, destructive: false },
  params: [
    {
      name: "fieldSlug",
      kind: "string",
      required: true,
      description: "Slug of the field to match against, e.g. `status`.",
    },
    {
      name: "valueText",
      kind: "string",
      required: true,
      description: "Text value the field should match.",
    },
    {
      name: "baseId",
      kind: "string",
      description: "Restrict the lookup to one Base. Omit to look across all Bases in the space.",
    },
    { name: "limit", kind: "number", description: "Maximum number of records to return." },
  ],
  examples: [
    "busabase-cli records by-field-text --field-slug status --value-text published",
    "busabase-cli records by-field-text --field-slug status --value-text draft --base-id bas_123 --limit 10",
  ],
  execute: async (client: BusabaseTaskClient, input: RecordFindByFieldInput) =>
    client.records.search({
      fieldSlug: input.fieldSlug,
      valueText: input.valueText,
      baseId: input.baseId,
      limit: input.limit,
    }),
};
