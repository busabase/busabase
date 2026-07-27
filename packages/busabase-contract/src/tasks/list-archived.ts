import type { BusabaseTaskClient, TaskDefinition } from "./types";

/**
 * The Trash view, as one task.
 *
 * Six endpoints answer "what has been archived?" for different scopes —
 * `nodes_list_archived`, `bases_list_archived`, `bases_list_deleted_fields`,
 * `bases_list_archived_views`, `bases_list_archived_records`, and its paged
 * twin. The caller's question is the same every time; only the scope differs,
 * and scope is an argument, not a different job.
 */

const SCOPES = ["nodes", "bases", "fields", "views", "records"] as const;
type ArchivedScope = (typeof SCOPES)[number];

export interface ListArchivedInput {
  scope: ArchivedScope;
  baseId?: string;
  limit?: number;
  cursor?: string;
}

export const listArchivedTask: TaskDefinition<ListArchivedInput> = {
  name: "list_archived",
  cliPath: ["archived", "list"],
  cliVariants: [
    {
      path: ["nodes", "list-archived"],
      preset: { scope: "nodes" },
      summary: "List archived nodes — folders, Docs, Skills, etc. (the Trash view)",
    },
    {
      path: ["bases", "list-archived"],
      preset: { scope: "bases" },
      summary: "List archived Bases",
    },
  ],
  summary: "List archived (soft-deleted) items — the Trash view",
  guidance:
    "Everything here was archived rather than erased and can be restored: nodes via `node_create`'s " +
    "counterpart `nodes_create_change_request` restore op, fields and views via their change-request " +
    "tasks, records via `record_change_request` with operation restore. " +
    "`fields`, `views` and `records` scopes need a baseId; `nodes` and `bases` are space-wide.",
  annotations: { readOnly: true, destructive: false },
  params: [
    {
      name: "scope",
      kind: "enum",
      required: true,
      choices: SCOPES,
      description: "What kind of archived item to list.",
    },
    {
      name: "baseId",
      kind: "string",
      appliesWhen: { param: "scope", values: ["fields", "views", "records"] },
      description: "Base to look inside. Required for fields / views / records.",
    },
    {
      name: "limit",
      kind: "number",
      min: 1,
      max: 100,
      appliesWhen: { param: "scope", values: ["records"] },
      description: "Page size for archived records (records only).",
    },
    {
      name: "cursor",
      kind: "string",
      appliesWhen: { param: "scope", values: ["records"] },
      description: "Opaque cursor from the previous page (records only).",
    },
  ],
  examples: [
    "busabase-cli archived list --scope nodes",
    "busabase-cli archived list --scope records --base-id bas_1 --limit 100",
  ],
  execute: async (client: BusabaseTaskClient, input: ListArchivedInput) => {
    if (input.scope === "nodes") return client.nodes.listArchived();
    if (input.scope === "bases") return client.bases.listArchived();

    if (!input.baseId) {
      throw new Error(`scope "${input.scope}" requires baseId.`);
    }
    if (input.scope === "fields") return client.bases.listDeletedFields({ baseId: input.baseId });
    if (input.scope === "views") return client.bases.listArchivedViews({ baseId: input.baseId });

    // Records always use the paginated endpoint — the unpaged one truncates at a
    // default limit with nothing marking the result as partial.
    return client.bases.listArchivedRecordsPaged({
      baseId: input.baseId,
      ...(input.limit !== undefined ? { limit: input.limit } : {}),
      ...(input.cursor ? { cursor: input.cursor } : {}),
    } as Parameters<BusabaseTaskClient["bases"]["listArchivedRecordsPaged"]>[0]);
  },
};
