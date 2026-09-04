import type { BusabaseTaskClient, TaskDefinition } from "./types";

/**
 * "Archive a node" — the safe, reversible way to remove something.
 *
 * Two naming mismatches make this worth stating as its own task rather than
 * leaving an agent to infer it from the endpoint list:
 *
 * 1. The operation kind on the wire is `"delete"`, but its effect is a *soft*
 *    archive (the node lands in the Trash view and can be restored). An agent
 *    reading the contract sees "delete" and reasonably assumes it is permanent.
 * 2. The thing actually named delete — `DELETE /nodes/{nodeId}`, exposed as the
 *    `nodes_purge` tool — is permanent AND only works on a node that is already
 *    archived. So an agent told "delete this folder" tends to reach for purge,
 *    get an error, and have no idea archiving was the missing first step.
 *
 * `busabase-cli`'s help text has explained this since the command was written.
 * MCP re-derived its catalog from the contract and inherited none of it.
 */

export interface NodeArchiveInput {
  nodeId: string;
  message?: string;
  submittedBy?: string;
  autoMerge?: boolean;
  requireReview?: boolean;
}

/**
 * `autoMerge` is tri-state — unset (permission-aware default), forced on, forced
 * off — but a CLI boolean flag is presence-only, so `--auto-merge` alone could
 * never express "forced off". Same two-flag shape as `node_create`.
 */
const mergeIntent = (input: NodeArchiveInput): { autoMerge?: boolean } => {
  if (input.requireReview) return { autoMerge: false };
  if (input.autoMerge) return { autoMerge: true };
  return {};
};

export const nodeArchiveTask: TaskDefinition<NodeArchiveInput> = {
  name: "node_archive",
  cliPath: ["nodes", "archive"],
  summary: "Archive a node (reversible; the node moves to Trash)",
  guidance:
    "This is the only way to move a node into the archived state, and it is reversible — the node appears in the Trash view and can be restored. " +
    "Review is permission-aware, decided server-side: it archives immediately when your key has write access on the node and lands as a pending ChangeRequest otherwise. Pass requireReview to always propose instead. " +
    "Do NOT use node_purge to remove a node: purge is permanent and only accepts a node that has ALREADY been archived by this task.",
  annotations: { readOnly: false, destructive: false },
  params: [
    { name: "nodeId", kind: "string", required: true, description: "Id of the node to archive." },
    {
      name: "message",
      kind: "string",
      description: "Explanation for the human reviewer of why this node should go.",
    },
    { name: "submittedBy", kind: "string", description: "Producer label recorded on the change." },
    {
      name: "autoMerge",
      kind: "boolean",
      description:
        "Archive immediately if you have write access. Not a permission override — a changeRequest-level key still gets a pending CR. Default is permission-aware: archive when you can, otherwise propose.",
    },
    {
      name: "requireReview",
      kind: "boolean",
      description:
        "Always propose a pending ChangeRequest instead of archiving, even with write access.",
    },
  ],
  examples: [
    "busabase-cli nodes archive --node-id nod_123",
    "busabase-cli nodes archive --node-id nod_123 --require-review   # leave it for a human",
  ],
  execute: async (client: BusabaseTaskClient, input: NodeArchiveInput) =>
    client.nodes.createChangeRequest({
      message: input.message ?? "Archive node",
      submittedBy: input.submittedBy,
      // Tri-state pass-through. This used to be `Boolean(input.autoMerge)`, which
      // turned "the caller said nothing" into an explicit `false` and so forced
      // review on every archive — overriding the endpoint's own permission-aware
      // default from the client side, which is the one thing a task layer must
      // not do.
      ...mergeIntent(input),
      // Wire kind is "delete"; its semantics are a soft archive. See the file
      // comment — this mapping is exactly what the task layer exists to hide.
      operations: [{ kind: "delete", nodeId: input.nodeId }],
    }),
};
