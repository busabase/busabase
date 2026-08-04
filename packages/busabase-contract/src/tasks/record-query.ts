import type { BusabaseTaskClient, TaskDefinition } from "./types";

/**
 * "Show me records" as one task instead of three endpoints.
 *
 * `records_list`, `records_list_paged` and `records_count` answer the same
 * question at different resolutions. Choosing between them is a decision about
 * pagination mechanics, not about intent, and the trap is real: `records_list`
 * silently stops at a default limit, so an agent that picks it to "read the
 * Base" gets a truncated answer with nothing marking it as truncated.
 *
 * This always uses the keyset-paginated endpoint, which reports `nextCursor`,
 * and offers `countOnly` for the "how many are there" case.
 */

export interface RecordQueryInput {
  baseId?: string;
  limit?: number;
  cursor?: string;
  filters?: unknown;
  sort?: unknown;
  countOnly?: boolean;
  /** Count-only: count the rows a saved View displays. Requires baseId. */
  viewId?: string;
}

type ListInput = Parameters<BusabaseTaskClient["records"]["list"]>[0];
type CountInput = Parameters<BusabaseTaskClient["records"]["count"]>[0];

export const recordQueryTask: TaskDefinition<RecordQueryInput> = {
  name: "record_query",
  cliPath: ["records", "query"],
  cliVariants: [
    { path: ["records", "count"], preset: { countOnly: true }, summary: "Count records" },
  ],
  summary: "List records with pagination, or count them",
  guidance:
    "Always keyset-paginated: when `nextCursor` comes back non-null there ARE more records — page with it instead of raising `limit` (capped at 100). " +
    "Pass countOnly to get the total without fetching rows — it is a real, exact SQL count (never an estimate), so it is the right tool for a dashboard total instead of paging through everything and counting client-side. " +
    'countOnly accepts viewId and/or filters to count a scoped subset (e.g. "PRs on the main branch"); both require baseId. ' +
    "To find records by a field value use `record_find_by_field`; to search content use `search` or `grep`.",
  annotations: { readOnly: true, destructive: false },
  params: [
    { name: "baseId", kind: "string", description: "Restrict to one Base. Omit for the space." },
    {
      name: "limit",
      kind: "number",
      min: 1,
      max: 100,
      description: "Page size, 1-100 (default 50).",
    },
    { name: "cursor", kind: "string", description: "Opaque cursor from the previous page." },
    {
      name: "filters",
      kind: "json",
      description:
        "View filters pushed down to the server. With countOnly, requires baseId; not every filter is a cheap SQL count (see the records.count API description) but the result is always exact.",
    },
    { name: "sort", kind: "json", description: "View sort (number/date fields only)." },
    { name: "countOnly", kind: "boolean", description: "Return the total instead of rows." },
    {
      name: "viewId",
      kind: "string",
      description: "countOnly only: count the rows this saved View displays. Requires baseId.",
    },
  ],
  examples: [
    "busabase-cli records query --base-id bas_123 --limit 100",
    "busabase-cli records count --base-id bas_123",
    'busabase-cli records count --base-id bas_123 --filters \'[{"fieldSlug":"branch","fieldType":"text","operator":"equals","value":"main"}]\'',
    "busabase-cli records count --base-id bas_123 --view-id viw_456",
  ],
  execute: async (client: BusabaseTaskClient, input: RecordQueryInput) => {
    if (input.countOnly) {
      return client.records.count({
        ...(input.baseId ? { baseId: input.baseId } : {}),
        ...(input.viewId ? { viewId: input.viewId } : {}),
        ...(Array.isArray(input.filters) ? { filters: input.filters } : {}),
      } as CountInput);
    }
    return client.records.list({
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
      ...(input.baseId ? { baseId: input.baseId } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {}),
      ...(Array.isArray(input.filters) ? { filters: input.filters } : {}),
      ...(input.sort ? { sort: input.sort } : {}),
    } as ListInput);
  },
};
