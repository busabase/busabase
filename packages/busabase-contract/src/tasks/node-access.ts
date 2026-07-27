import type { BusabaseTaskClient, TaskDefinition } from "./types";

/**
 * Who can reach a node — the two ways Busabase answers that, each as one task.
 *
 * `principals` (list/add/remove) and `share` (get/set/disable) are both
 * three-endpoint CRUD triples where the verb is the whole difference. Read and
 * write are the same question, so each becomes one task whose `action` says
 * which.
 *
 * The two stay SEPARATE tasks rather than merging into one "access" task,
 * because they are genuinely different things and conflating them would be the
 * kind of over-merge this layer is supposed to avoid: a principal grant names
 * someone inside the workspace, a share link is a bearer capability anyone
 * holding the URL can use. An agent must not reach for one thinking of the other.
 */

export interface NodePermissionInput {
  nodeId: string;
  action: "list" | "grant" | "revoke";
  principalType?: "user" | "space";
  principalId?: string;
  role?: "read" | "changeRequest" | "write" | "manage";
}

export const nodePermissionTask: TaskDefinition<NodePermissionInput> = {
  name: "node_permission",
  cliPath: ["nodes", "permission"],
  summary: "List, grant, or revoke a principal's access on a node",
  guidance:
    "Grants access to a named user or space INSIDE the workspace — this is not link sharing (see `node_share`). " +
    "Requires `manage` on the node. Roles escalate: read < changeRequest < write < manage; " +
    "`changeRequest` lets someone propose changes without being able to merge them.",
  annotations: { readOnly: false, destructive: false },
  params: [
    { name: "nodeId", kind: "string", required: true, description: "Node to inspect or change." },
    {
      name: "action",
      kind: "enum",
      required: true,
      choices: ["list", "grant", "revoke"],
      description: "What to do. Choose this before the other arguments.",
    },
    {
      name: "principalType",
      kind: "enum",
      choices: ["user", "space"],
      appliesWhen: { param: "action", values: ["grant", "revoke"] },
      description: "Whether the grant targets a user or a whole space.",
    },
    {
      name: "principalId",
      kind: "string",
      appliesWhen: { param: "action", values: ["grant", "revoke"] },
      description: "Id of the user or space.",
    },
    {
      name: "role",
      kind: "enum",
      choices: ["read", "changeRequest", "write", "manage"],
      appliesWhen: { param: "action", values: ["grant"] },
      description: "Access level to grant (grant only).",
    },
  ],
  examples: [
    "busabase-cli nodes permission --node-id nod_1 --action list",
    "busabase-cli nodes permission --node-id nod_1 --action grant --principal-type user --principal-id usr_1 --role changeRequest",
  ],
  execute: async (client: BusabaseTaskClient, input: NodePermissionInput) => {
    if (input.action === "list") return client.nodes.principals.list({ nodeId: input.nodeId });
    if (!input.principalType || !input.principalId) {
      throw new Error(`action "${input.action}" requires principalType and principalId.`);
    }
    if (input.action === "revoke") {
      return client.nodes.principals.remove({
        nodeId: input.nodeId,
        principalType: input.principalType,
        principalId: input.principalId,
      });
    }
    if (!input.role) throw new Error('action "grant" requires role.');
    return client.nodes.principals.add({
      nodeId: input.nodeId,
      principalType: input.principalType,
      principalId: input.principalId,
      role: input.role,
    });
  },
};

export interface NodeShareInput {
  nodeId: string;
  action: "get" | "enable" | "disable";
  capability?: "read" | "submit";
  password?: string | null;
  expiresAt?: string | null;
}

export const nodeShareTask: TaskDefinition<NodeShareInput> = {
  name: "node_share",
  cliPath: ["nodes", "share"],
  summary: "Read, enable, or revoke a node's public share link",
  guidance:
    "A share link is a BEARER CAPABILITY: anyone holding the URL can use it, with no account. " +
    "Only enable one when the user explicitly asks to share or publish that node, and only reveal the URL when they ask for it. " +
    "`capability: submit` additionally lets anonymous visitors write — never the default. " +
    "To grant access to a named person inside the workspace use `node_permission` instead.",
  annotations: { readOnly: false, destructive: false },
  params: [
    { name: "nodeId", kind: "string", required: true, description: "Node to inspect or change." },
    {
      name: "action",
      kind: "enum",
      required: true,
      choices: ["get", "enable", "disable"],
      description: "What to do. Choose this before the other arguments.",
    },
    {
      name: "capability",
      kind: "enum",
      choices: ["read", "submit"],
      appliesWhen: { param: "action", values: ["enable"] },
      description: "What visitors may do. `submit` allows anonymous writes — use deliberately.",
    },
    {
      name: "password",
      kind: "string",
      appliesWhen: { param: "action", values: ["enable"] },
      description: "Optional password gate for the link.",
    },
    {
      name: "expiresAt",
      kind: "string",
      appliesWhen: { param: "action", values: ["enable"] },
      description: "ISO 8601 expiry. Omit for a link that does not expire.",
    },
  ],
  examples: [
    "busabase-cli nodes share --node-id nod_1 --action get",
    "busabase-cli nodes share --node-id nod_1 --action enable --capability read",
    "busabase-cli nodes share --node-id nod_1 --action disable",
  ],
  execute: async (client: BusabaseTaskClient, input: NodeShareInput) => {
    if (input.action === "get") return client.nodes.share.get({ nodeId: input.nodeId });
    if (input.action === "disable") return client.nodes.share.disable({ nodeId: input.nodeId });
    return client.nodes.share.set({
      nodeId: input.nodeId,
      scope: "public",
      ...(input.capability ? { capability: input.capability } : {}),
      ...(input.password !== undefined ? { password: input.password } : {}),
      ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    });
  },
};
