import type { BusabaseTaskClient, TaskDefinition, TaskParam } from "./types";

/**
 * Skills, Drives and AirApps are the same thing with different labels: all three
 * are built from `makeFileTreeContract`, so `list`/`get`/`listFiles`/`readFile`/
 * `createChangeRequest` are byte-identical in shape across them — 15 endpoints
 * that differ only in a path prefix.
 *
 * Published one-per-endpoint, that is 15 tools an agent has to tell apart, and
 * the difference between `skills_read_file` and `drives_read_file` is not a
 * difference in what you are doing. These five tasks take the node kind as a
 * parameter instead.
 *
 * Note this covers the three FILE-TREE types only. Docs, Bases, Folders and
 * Files have their own `get`/`list` endpoints with genuinely different payloads
 * (a Base carries fields and views; a Doc carries a body), so folding them in
 * here would mean a union return type that hides real differences rather than
 * an incidental one. They keep their own tools.
 */

const FILE_TREE_KINDS = ["skill", "drive", "airapp"] as const;
type FileTreeKind = (typeof FILE_TREE_KINDS)[number];

/** Which client namespace serves a kind. */
const NAMESPACE: Record<FileTreeKind, "skills" | "drives" | "airapps"> = {
  skill: "skills",
  drive: "drives",
  airapp: "airapps",
};

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
      summary: "List Skill nodes with their file trees",
    },
    {
      path: ["drives", "list"],
      preset: { kind: "drive" },
      summary: "List Drive nodes with their file trees",
    },
    {
      path: ["airapps", "list"],
      preset: { kind: "airapp" },
      summary: "List AirApp nodes with their file trees",
    },
  ],
  summary: "List Skill, Drive, or AirApp nodes with their file trees",
  guidance:
    "Returns every node of the given kind together with its Asset-backed file list. " +
    "For the workspace tree across all node types, use `nodes_list` instead.",
  annotations: { readOnly: true, destructive: false },
  params: [kindParam],
  examples: ["busabase-cli nodes list-file-trees --kind skill"],
  execute: async (client: BusabaseTaskClient, input: FileTreeListInput) =>
    client[NAMESPACE[resolveKind(input.kind)]].list(),
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
  execute: async (client: BusabaseTaskClient, input: FileTreeGetInput) =>
    client[NAMESPACE[resolveKind(input.kind)]].get({ nodeId: input.nodeId }),
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
    client[NAMESPACE[resolveKind(input.kind)]].listFiles({ nodeId: input.nodeId }),
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
    client[NAMESPACE[resolveKind(input.kind)]].readFile({
      nodeId: input.nodeId,
      filePath: input.filePath,
    }),
};

export interface FileTreeChangeRequestInput extends FileTreeGetInput {
  operations: unknown;
  message?: string;
  submittedBy?: string;
}

type FileTreeCrInput = Parameters<BusabaseTaskClient["skills"]["createChangeRequest"]>[0];

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
    "Approval-first: this proposes a ChangeRequest for a human to review, it does not write directly. " +
    "Each operation is one of create / update / delete / metadata_update. " +
    "Include `baseContentHash` (from `node_file_read`) on an update so a concurrent edit is caught.",
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
  ],
  examples: [
    'busabase-cli nodes files-change-request --kind skill --node-id nod_123 --operations-json \'[{"kind":"update","path":"SKILL.md","content":"# Hi"}]\'',
  ],
  execute: async (client: BusabaseTaskClient, input: FileTreeChangeRequestInput) => {
    if (!Array.isArray(input.operations) || input.operations.length === 0) {
      throw new Error("operations must be a non-empty array of file operations.");
    }
    const payload = {
      nodeId: input.nodeId,
      operations: input.operations,
      ...(input.message ? { message: input.message } : {}),
      ...(input.submittedBy ? { submittedBy: input.submittedBy } : {}),
    } as FileTreeCrInput;
    return client[NAMESPACE[resolveKind(input.kind)]].createChangeRequest(payload);
  },
};
