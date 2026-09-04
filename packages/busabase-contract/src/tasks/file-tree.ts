import type { BusabaseTaskClient, TaskDefinition, TaskParam } from "./types";

/**
 * Skills, Drives and AirApps are the same thing with different labels:
 * `list`/`get`/`listFiles`/`readFile`/`createChangeRequest` are byte-identical
 * in shape across them — 15 endpoints that differ only in a path prefix.
 *
 * Published one-per-endpoint, that is 15 tools an agent has to tell apart, and
 * the difference between `skills_read_file` and `drives_read_file` is not a
 * difference in what you are doing. These five tasks take the node kind as a
 * parameter instead.
 *
 * Two of them now delegate to the unified Node surface rather than a file-tree
 * route: `node_list_files_trees` -> `nodes.list({ types })` and
 * `node_get_file_tree` -> `nodes.get`. The task vocabulary is unchanged, which
 * is the whole point of this layer — the CLI keeps `skills list`, `drives get`
 * and friends while the transport underneath consolidates.
 */

const FILE_TREE_KINDS = ["skill", "drive", "airapp"] as const;
type FileTreeKind = (typeof FILE_TREE_KINDS)[number];

// `kind` is passed straight through as the contract's `type` discriminator:
// Skills, Drives, and AirApps share the one `/file-trees` surface, so there is
// no namespace to pick any more.

const kindParam: TaskParam = {
  name: "kind",
  kind: "enum",
  required: true,
  choices: FILE_TREE_KINDS,
  description: "Which file-tree node kind to act on.",
};

const nodeIdParam: TaskParam = {
  name: "nodeId",
  kind: "string",
  required: true,
  description: "Id of the node.",
};

const resolveKind = (value: unknown): FileTreeKind => {
  if (typeof value === "string" && (FILE_TREE_KINDS as readonly string[]).includes(value)) {
    return value as FileTreeKind;
  }
  throw new Error(`kind must be one of: ${FILE_TREE_KINDS.join(", ")}.`);
};

export interface FileTreeListInput {
  kind: FileTreeKind;
}

export const nodeListTask: TaskDefinition<FileTreeListInput> = {
  name: "node_list_files_trees",
  cliPath: ["nodes", "list-file-trees"],
  cliVariants: [
    {
      path: ["skills", "list"],
      preset: { kind: "skill" },
      summary: "List Skill nodes (summaries; use `skills get` for one node's files)",
    },
    {
      path: ["drives", "list"],
      preset: { kind: "drive" },
      summary: "List Drive nodes (summaries; use `drives get` for one node's files)",
    },
    {
      path: ["airapps", "list"],
      preset: { kind: "airapp" },
      summary: "List AirApp nodes (summaries; use `airapps get` for one node's files)",
    },
  ],
  summary: "List Skill, Drive, or AirApp nodes",
  guidance:
    "Returns a lightweight summary row for every node of the given kind — id, name, slug, " +
    "type, and metadata, but NOT the node's file list. Follow up with `node_get_file_tree` " +
    "for one node's files, or `node_files_list` for just the file inventory. " +
    "For the workspace tree across all node types, use `nodes_list` instead.",
  annotations: { readOnly: true, destructive: false },
  params: [kindParam],
  examples: ["busabase-cli nodes list-file-trees --kind skill"],
  execute: async (client: BusabaseTaskClient, input: FileTreeListInput) =>
    client.nodes.list({ types: [resolveKind(input.kind)] }),
};

export interface FileTreeGetInput {
  kind: FileTreeKind;
  nodeId: string;
}

export const nodeGetTask: TaskDefinition<FileTreeGetInput> = {
  name: "node_get_file_tree",
  cliPath: ["nodes", "get-file-tree"],
  cliVariants: [
    {
      path: ["skills", "get"],
      preset: { kind: "skill" },
      summary: "Get one Skill node and its file tree",
    },
    {
      path: ["drives", "get"],
      preset: { kind: "drive" },
      summary: "Get one Drive node and its file tree",
    },
    {
      path: ["airapps", "get"],
      preset: { kind: "airapp" },
      summary: "Get one AirApp node and its file tree",
    },
  ],
  summary: "Get one Skill, Drive, or AirApp node and its file tree",
  annotations: { readOnly: true, destructive: false },
  params: [kindParam, nodeIdParam],
  examples: ["busabase-cli nodes get-file-tree --kind airapp --node-id nod_123"],
  // Reads through the unified Node detail route. The payload is unchanged apart
  // from the `type` discriminator the union carries, so a caller still gets
  // `{ node, entryFile, visibility, version, files }`.
  execute: async (client: BusabaseTaskClient, input: FileTreeGetInput) =>
    client.nodes.get({ nodeId: input.nodeId, type: resolveKind(input.kind) }),
};

export const nodeListFilesTask: TaskDefinition<FileTreeGetInput> = {
  name: "node_files_list",
  cliPath: ["nodes", "files"],
  cliVariants: [
    {
      path: ["skills", "files"],
      preset: { kind: "skill" },
      summary: "List the files inside a Skill node",
    },
    {
      path: ["drives", "files"],
      preset: { kind: "drive" },
      summary: "List the files inside a Drive node",
    },
    {
      path: ["airapps", "files"],
      preset: { kind: "airapp" },
      summary: "List the files inside a AirApp node",
    },
  ],
  summary: "List the files inside a Skill, Drive, or AirApp node",
  annotations: { readOnly: true, destructive: false },
  params: [kindParam, nodeIdParam],
  examples: ["busabase-cli nodes files --kind drive --node-id nod_123"],
  execute: async (client: BusabaseTaskClient, input: FileTreeGetInput) =>
    client.fileTrees.listFiles({ nodeId: input.nodeId, type: resolveKind(input.kind) }),
};

export interface FileTreeReadFileInput extends FileTreeGetInput {
  filePath: string;
}

export const nodeReadFileTask: TaskDefinition<FileTreeReadFileInput> = {
  name: "node_file_read",
  cliPath: ["nodes", "read-file"],
  cliVariants: [
    {
      path: ["skills", "read-file"],
      preset: { kind: "skill" },
      summary: "Read one file from a Skill node",
    },
    {
      path: ["drives", "read-file"],
      preset: { kind: "drive" },
      summary: "Read one file from a Drive node",
    },
    {
      path: ["airapps", "read-file"],
      preset: { kind: "airapp" },
      summary: "Read one file from a AirApp node",
    },
  ],
  summary: "Read one file from a Skill, Drive, or AirApp node",
  guidance:
    "Returns the file's content plus its `contentHash`. Pass that hash back as " +
    "`baseContentHash` when proposing an edit so a concurrent change is detected " +
    "instead of silently overwritten.",
  annotations: { readOnly: true, destructive: false },
  params: [
    kindParam,
    nodeIdParam,
    {
      name: "filePath",
      kind: "string",
      required: true,
      description: "Path within the node, e.g. `SKILL.md`.",
    },
  ],
  examples: ["busabase-cli nodes read-file --kind skill --node-id nod_123 --file-path SKILL.md"],
  execute: async (client: BusabaseTaskClient, input: FileTreeReadFileInput) =>
    client.fileTrees.readFile({
      nodeId: input.nodeId,
      filePath: input.filePath,
      type: resolveKind(input.kind),
    }),
};

export interface FileTreeChangeRequestInput extends FileTreeGetInput {
  operations: unknown;
  message?: string;
  submittedBy?: string;
  autoMerge?: boolean;
  requireReview?: boolean;
}

/**
 * `autoMerge` is tri-state — unset (permission-aware default), forced on, forced
 * off — but a CLI boolean flag is presence-only, so `--auto-merge` alone could
 * never express "forced off". Same two-flag shape as `node_create`.
 *
 * Applies to every operation kind, deletes included — a delete batch used to be
 * pinned review-first server-side regardless of this flag, and no longer is.
 */
const mergeIntent = (input: FileTreeChangeRequestInput): { autoMerge?: boolean } => {
  if (input.requireReview) return { autoMerge: false };
  if (input.autoMerge) return { autoMerge: true };
  return {};
};

type FileTreeCrInput = Parameters<BusabaseTaskClient["fileTrees"]["createChangeRequest"]>[0];

export const nodeFilesChangeRequestTask: TaskDefinition<FileTreeChangeRequestInput> = {
  name: "node_files_change_request",
  cliPath: ["nodes", "files-change-request"],
  cliVariants: [
    {
      path: ["skills", "create-change-request"],
      preset: { kind: "skill" },
      summary: "Propose file changes inside a Skill node",
    },
    {
      path: ["drives", "create-change-request"],
      preset: { kind: "drive" },
      summary: "Propose file changes inside a Drive node",
    },
    {
      path: ["airapps", "create-change-request"],
      preset: { kind: "airapp" },
      summary: "Propose file changes inside a AirApp node",
    },
  ],
  summary: "Propose file changes inside a Skill, Drive, or AirApp node",
  guidance:
    "Review is permission-aware, decided server-side: the change merges immediately when your key " +
    "has write access on the node and lands as a pending ChangeRequest otherwise — check the " +
    "response's `status`. Pass requireReview to always propose instead — worth doing for a batch " +
    "containing a `delete`, since that removes a mounted file (its previous bytes stay in the " +
    "change request's history, and a batch is never partially merged). " +
    "Each operation is one of create / update / delete / metadata_update. " +
    "Include `baseContentHash` (from `node_file_read`) on an update so a concurrent edit is caught. " +
    // Same trap as `node_create`'s `files`, one edit later: an AirApp is run with `npm run dev`,
    // so rewriting its package.json without that script breaks a previously working app.
    'For kind "airapp", keep the project runnable by `npm run dev` — editing package.json must leave a "dev" script starting a plain Node server, not a bundler dev server.',
  annotations: { readOnly: false, destructive: false },
  params: [
    kindParam,
    nodeIdParam,
    {
      name: "operations",
      kind: "json",
      required: true,
      description:
        'File operations, e.g. [{"kind":"update","path":"SKILL.md","content":"...","baseContentHash":"..."}].',
    },
    {
      name: "message",
      kind: "string",
      description:
        'Explanation for the reviewer. Conventional-commit style, e.g. "Rewrite README quickstart for the new auth flow".',
    },
    { name: "submittedBy", kind: "string", description: "Producer label recorded on the change." },
    {
      name: "autoMerge",
      kind: "boolean",
      description:
        "Skip review and apply the file changes immediately if you have write access. Not a permission override, and ignored for a batch containing a delete. Default is permission-aware: merge when you can, otherwise propose.",
    },
    {
      name: "requireReview",
      kind: "boolean",
      description: "Always propose a pending ChangeRequest, even with write access.",
    },
  ],
  examples: [
    'busabase-cli nodes files-change-request --kind skill --node-id nod_123 --operations-json \'[{"kind":"update","path":"SKILL.md","content":"# Hi"}]\'',
    "busabase-cli nodes files-change-request --kind skill --node-id nod_123 --operations-json @ops.json --require-review",
  ],
  execute: async (client: BusabaseTaskClient, input: FileTreeChangeRequestInput) => {
    if (!Array.isArray(input.operations) || input.operations.length === 0) {
      throw new Error("operations must be a non-empty array of file operations.");
    }
    const payload = {
      nodeId: input.nodeId,
      type: resolveKind(input.kind),
      operations: input.operations,
      ...(input.message ? { message: input.message } : {}),
      ...(input.submittedBy ? { submittedBy: input.submittedBy } : {}),
      ...mergeIntent(input),
    } as FileTreeCrInput;
    return client.fileTrees.createChangeRequest(payload);
  },
};
