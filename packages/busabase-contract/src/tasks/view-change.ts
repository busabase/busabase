import type { BusabaseTaskClient, TaskDefinition } from "./types";

/**
 * Base views: create / update / delete / restore, as one task.
 *
 * Four endpoints split across two namespaces — create lives on the Base
 * (`POST /bases/{baseId}/views/change-requests`) while the rest live on the view
 * (`/views/{viewId}/...`). That split is an artefact of which id the route needs,
 * not of what the caller is doing, and it is exactly the sort of thing a caller
 * should not have to know.
 */

const ACTIONS = ["create", "update", "delete", "restore"] as const;
type ViewAction = (typeof ACTIONS)[number];

export interface ViewChangeInput {
  action: ViewAction;
  baseId?: string;
  viewId?: string;
  name?: string;
  type?: string;
  config?: unknown;
  patch?: unknown;
  message?: string;
  submittedBy?: string;
}

export const viewChangeTask: TaskDefinition<ViewChangeInput> = {
  name: "view_change_request",
  cliPath: ["views", "change-request"],
  summary: "Propose a Base view change (create / update / delete / restore)",
  guidance:
    "Approval-first: proposes a ChangeRequest, it does not change the view directly. " +
    "`create` needs the BASE id; update / delete / restore need the VIEW id — the endpoint split " +
    "follows whichever id identifies the target, which this task handles for you.",
  annotations: { readOnly: false, destructive: false },
  params: [
    {
      name: "action",
      kind: "enum",
      required: true,
      choices: ACTIONS,
      description: "What to do. Choose this before the other arguments.",
    },
    {
      name: "baseId",
      kind: "string",
      appliesWhen: { param: "action", values: ["create"] },
      description: "Base the view belongs to (create only).",
    },
    {
      name: "viewId",
      kind: "string",
      appliesWhen: { param: "action", values: ["update", "delete", "restore"] },
      description: "Target view id.",
    },
    {
      name: "name",
      kind: "string",
      appliesWhen: { param: "action", values: ["create"] },
      description: "View name (create only).",
    },
    {
      name: "type",
      kind: "string",
      appliesWhen: { param: "action", values: ["create"] },
      description: "View type, e.g. `table`, `gallery` (create only).",
    },
    {
      name: "config",
      kind: "json",
      appliesWhen: { param: "action", values: ["create"] },
      description: "View configuration — filters, sorts, visible fields (create only).",
    },
    {
      name: "patch",
      kind: "json",
      appliesWhen: { param: "action", values: ["update"] },
      description: "Changes to apply to the view (update only).",
    },
    { name: "message", kind: "string", description: "Explanation for the reviewer." },
    { name: "submittedBy", kind: "string", description: "Producer label recorded on the change." },
  ],
  examples: [
    'busabase-cli views change-request --action create --base-id bas_1 --name "Published" --type table',
    "busabase-cli views change-request --action delete --view-id viw_1",
  ],
  execute: async (client: BusabaseTaskClient, input: ViewChangeInput) => {
    const meta = {
      ...(input.message ? { message: input.message } : {}),
      ...(input.submittedBy ? { submittedBy: input.submittedBy } : {}),
    };

    if (input.action === "create") {
      if (!input.baseId || !input.name) {
        throw new Error('action "create" requires baseId and name.');
      }
      return client.bases.createViewChangeRequest({
        baseId: input.baseId,
        name: input.name,
        ...(input.type ? { type: input.type } : {}),
        ...(input.config ? { config: input.config } : {}),
        ...meta,
      } as Parameters<BusabaseTaskClient["bases"]["createViewChangeRequest"]>[0]);
    }

    if (!input.viewId) throw new Error(`action "${input.action}" requires viewId.`);
    const target = { viewId: input.viewId, ...meta };

    if (input.action === "update") {
      if (!input.patch) throw new Error('action "update" requires patch.');
      return client.views.updateChangeRequest({
        ...target,
        ...(input.patch as Record<string, unknown>),
      } as Parameters<BusabaseTaskClient["views"]["updateChangeRequest"]>[0]);
    }
    if (input.action === "delete") {
      return client.views.deleteChangeRequest(
        target as Parameters<BusabaseTaskClient["views"]["deleteChangeRequest"]>[0],
      );
    }
    return client.views.restoreChangeRequest(
      target as Parameters<BusabaseTaskClient["views"]["restoreChangeRequest"]>[0],
    );
  },
};
