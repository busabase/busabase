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
}

export const nodeArchiveTask: TaskDefinition<NodeArchiveInput> = {
  name: "node_archive",
  cliPath: ["nodes", "archive"],
  summary: "Archive a node (reversible; the node moves to Trash)",
  guidance:
    "This is the only way to move a node into the archived state, and it is reversible — the node appears in the Trash view and can be restored. " +
    "It is review-first by default: it proposes a ChangeRequest for a human unless you pass autoMerge. " +
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
      description: "Archive immediately instead of proposing a ChangeRequest for review.",
    },
  ],
  examples: [
    "busabase-cli nodes archive --node-id nod_123",
    "busabase-cli nodes archive --node-id nod_123 --auto-merge   # skip review",
  ],
  execute: async (client: BusabaseTaskClient, input: NodeArchiveInput) =>
    client.nodes.createChangeRequest({
      message: input.message ?? "Archive node",
      submittedBy: input.submittedBy,
      autoMerge: Boolean(input.autoMerge),
      // Wire kind is "delete"; its semantics are a soft archive. See the file
      // comment — this mapping is exactly what the task layer exists to hide.
      operations: [{ kind: "delete", nodeId: input.nodeId }],
    }),
};
