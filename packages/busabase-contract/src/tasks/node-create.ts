import { CREATABLE_NODE_TYPES, type CreatableNodeType } from "../domains/registry";
import type { BusabaseTaskClient, TaskDefinition } from "./types";

/**
 * "Create a node" as one task, across all 11 creatable node types.
 *
 * The contract deliberately has several create endpoints, because the types are
 * not uniform: a Skill/Drive/AirApp is created together with a seeded file tree,
 * a Doc with its body, a Base with its fields, a File against an existing Asset.
 * `POST /nodes/change-requests` can create *any* type but carries none of those
 * payloads — so it creates an empty shell for the four types that have one.
 *
 * That is a fine SDK surface and a bad agent surface: it means "create a Skill"
 * has two spellings, only one of which produces a usable Skill, and nothing in
 * the endpoint names says which. This task picks the right endpoint per type so
 * a caller only has to know what they want to build.
 *
 * Dispatch table (each row is a capability the generic endpoint cannot express):
 *   skill | drive | airapp -> {skills,drives,airapps}.create  (files, mergeMode, visibility, version)
 *   doc                    -> docs.create                     (body)
 *   base                   -> bases.create                    (fields)
 *   file                   -> files.create                    (assetId)
 *   folder | form | whiteboard | workflow | html -> nodes.createChangeRequest
 *
 * `form` stays on the generic endpoint on purpose: `forms.create` configures an
 * *existing* node (it takes `nodeId` + `targetBaseId`), so it is a second step,
 * not an alternative way to create the node.
 */

const FILE_TREE_TYPES = new Set<CreatableNodeType>(["skill", "drive", "airapp"]);

// Input types read straight off the generated client, so a contract change
// surfaces here as a type error rather than as a silently-dropped field.
type FileTreeCreateInput = Parameters<BusabaseTaskClient["fileTrees"]["create"]>[0];
type DocCreateInput = Parameters<BusabaseTaskClient["docs"]["create"]>[0];
type BaseCreateInput = Parameters<BusabaseTaskClient["bases"]["create"]>[0];
type FileCreateInput = Parameters<BusabaseTaskClient["files"]["create"]>[0];

export interface NodeCreateInput {
  type: CreatableNodeType;
  slug: string;
  name: string;
  description?: string;
  parentNodeId?: string;
  message?: string;
  submittedBy?: string;
  /** Base fields — `--type base` only. */
  fields?: unknown;
  /** Doc body — `--type doc` only. */
  body?: string;
  /** Backing Asset id — `--type file` only. */
  assetId?: string;
  /** Seed files — Skill/Drive/AirApp only. */
  files?: unknown;
  mergeMode?: string;
  visibility?: string;
  version?: string;
  autoMerge?: boolean;
  requireReview?: boolean;
}

/**
 * Reject a payload aimed at the wrong node type instead of silently dropping it.
 *
 * Silently ignoring `body` on `--type base` is the failure mode that costs an
 * agent a whole review cycle: the call succeeds, the ChangeRequest looks right,
 * and the content it wrote is simply not there.
 */
const rejectMismatchedPayload = (input: NodeCreateInput): void => {
  const type = input.type;
  const wrong: string[] = [];
  if (input.fields !== undefined && type !== "base") wrong.push("fields");
  if (input.body !== undefined && type !== "doc") wrong.push("body");
  if (input.assetId !== undefined && type !== "file") wrong.push("assetId");
  if ((input.files !== undefined || input.mergeMode !== undefined) && !FILE_TREE_TYPES.has(type)) {
    wrong.push(input.files !== undefined ? "files" : "mergeMode");
  }
  if (wrong.length > 0) {
    throw new Error(
      `${wrong.join(", ")} ${wrong.length > 1 ? "are" : "is"} not valid for --type ${type}.`,
    );
  }
};

/** `autoMerge` is tri-state: unset (permission-aware default), forced on, forced off. */
const mergeIntent = (input: NodeCreateInput): { autoMerge?: boolean } => {
  if (input.requireReview) return { autoMerge: false };
  if (input.autoMerge) return { autoMerge: true };
  return {};
};

/**
 * Field definitions arrive as parsed JSON (`--fields-json`, or an MCP argument),
 * so they are `unknown` at this boundary. The element type is taken from the
 * client rather than restated here — the server validates the contents anyway,
 * and a local copy of the 28-member field-type union would drift on the first
 * new field type added.
 */
const asFieldArray = (value: unknown): BaseCreateInput["fields"] | undefined =>
  Array.isArray(value) ? (value as BaseCreateInput["fields"]) : undefined;

export const nodeCreateTask: TaskDefinition<NodeCreateInput> = {
  name: "node_create",
  cliPath: ["nodes", "create"],
  // Was `nodes create-change-request`. The old name described the usual outcome,
  // not the intent, and was wrong outright with `--auto-merge` (which creates the
  // node directly and files no change request at all).
  cliAliases: ["create-change-request"],
  // Per-type CLI entry points. A human types `bases create`; an agent picks one
  // `node_create` out of a flat list. Same logic underneath either way.
  cliVariants: [
    { path: ["bases", "create"], preset: { type: "base" }, summary: "Create a Base" },
    { path: ["docs", "create"], preset: { type: "doc" }, summary: "Create a Doc" },
    { path: ["skills", "create"], preset: { type: "skill" }, summary: "Create a Skill" },
    { path: ["drives", "create"], preset: { type: "drive" }, summary: "Create a Drive" },
    { path: ["airapps", "create"], preset: { type: "airapp" }, summary: "Create an AirApp" },
    { path: ["folders", "create"], preset: { type: "folder" }, summary: "Create a folder" },
  ],
  summary: "Create a workspace node of any type",
  guidance:
    "One call creates any of the 11 node types with its type-specific payload: `fields` for a Base, `body` for a Doc, `files` for a Skill/Drive/AirApp, `assetId` for a File. " +
    "Busabase is approval-first: by default this proposes a ChangeRequest for a human to review, and only merges immediately when you already have write access. " +
    "Pass requireReview to always propose instead of merging.",
  annotations: { readOnly: false, destructive: false },
  params: [
    {
      name: "type",
      kind: "enum",
      required: true,
      choices: CREATABLE_NODE_TYPES,
      description: "Node type to create.",
    },
    {
      name: "slug",
      kind: "string",
      required: true,
      description: "URL-safe identifier, lowercase letters/digits/hyphens only.",
    },
    { name: "name", kind: "string", required: true, description: "Human-readable node name." },
    { name: "description", kind: "string", description: "Optional node description." },
    {
      name: "parentNodeId",
      kind: "string",
      description: "Parent folder node id. Omit to create at the space root.",
    },
    {
      name: "message",
      kind: "string",
      description:
        'Explanation for the human reviewer. Conventional-commit style, e.g. "Add Products Base for the Q3 catalog".',
    },
    { name: "submittedBy", kind: "string", description: "Producer label recorded on the change." },
    {
      name: "fields",
      appliesWhen: { param: "type", values: ["base"] },
      kind: "json",
      description:
        'Base fields (--type base only): [{"slug":"title","name":"Title","type":"text"}]. A Base needs at least one field.',
      cliShorthand: {
        flag: "--field",
        placeholder: "<slug:name:type...>",
        description: "field definition, repeatable — shorthand for --fields-json",
        parser: "fieldSpecs",
      },
    },
    {
      name: "body",
      kind: "string",
      appliesWhen: { param: "type", values: ["doc"] },
      description: "Doc body in Markdown (--type doc only).",
    },
    {
      name: "assetId",
      appliesWhen: { param: "type", values: ["file"] },
      kind: "string",
      description: "Backing Asset id (--type file only). Upload the Asset first.",
    },
    {
      name: "files",
      appliesWhen: { param: "type", values: ["skill", "drive", "airapp"] },
      kind: "json",
      description:
        'Seed files for a Skill/Drive/AirApp: [{"path":"SKILL.md","content":"..."}]. Layered over the default scaffold unless mergeMode is "replace".',
    },
    {
      name: "mergeMode",
      appliesWhen: { param: "type", values: ["skill", "drive", "airapp"] },
      kind: "enum",
      choices: ["merge", "replace"],
      description:
        'Skill/Drive/AirApp only. "merge" (default) layers files over the default scaffold; "replace" uses only the files given.',
    },
    {
      name: "visibility",
      appliesWhen: { param: "type", values: ["skill", "drive", "airapp"] },
      kind: "enum",
      choices: ["private", "workspace", "public"],
      description: "Skill/Drive/AirApp only. Defaults to private.",
    },
    {
      name: "version",
      kind: "string",
      appliesWhen: { param: "type", values: ["skill", "drive", "airapp"] },
      description: "Skill/Drive/AirApp only. Defaults to 0.1.0.",
    },
    {
      name: "autoMerge",
      kind: "boolean",
      description:
        "Skip review and create immediately if you have write access. Default is permission-aware: merge when you can, otherwise propose.",
    },
    {
      name: "requireReview",
      kind: "boolean",
      description: "Always propose a pending ChangeRequest, even with write access.",
    },
  ],
  examples: [
    'busabase-cli nodes create --type folder --slug cms --name "内容管理 CMS"',
    'busabase-cli nodes create --type base --slug blog --name "Blog Posts" --field title:Title:text --field body:Body:markdown',
    'busabase-cli nodes create --type doc --slug readme --name "README" --body "# Hello"',
    'busabase-cli nodes create --type skill --slug my-skill --name "My Skill" --files-json @files.json',
    'busabase-cli nodes create --type folder --slug cms --name "CMS" --require-review',
  ],
  execute: async (client: BusabaseTaskClient, input: NodeCreateInput) => {
    rejectMismatchedPayload(input);

    const type = input.type;
    const common = {
      slug: input.slug,
      name: input.name,
      description: input.description,
      parentNodeId: input.parentNodeId,
      ...mergeIntent(input),
    };

    if (FILE_TREE_TYPES.has(type)) {
      const payload = {
        ...common,
        // `type` is the contract's discriminator, so the narrowing has to be
        // explicit — `FILE_TREE_TYPES.has` doesn't narrow a plain string.
        type: type as FileTreeCreateInput["type"],
        ...(Array.isArray(input.files)
          ? { files: input.files as FileTreeCreateInput["files"] }
          : {}),
        ...(input.mergeMode
          ? { mergeMode: input.mergeMode as FileTreeCreateInput["mergeMode"] }
          : {}),
        ...(input.visibility
          ? { visibility: input.visibility as FileTreeCreateInput["visibility"] }
          : {}),
        ...(input.version ? { version: input.version } : {}),
      };
      return client.fileTrees.create(payload as FileTreeCreateInput);
    }

    if (type === "doc") {
      const payload: DocCreateInput = { ...common, body: input.body ?? "" };
      return client.docs.create(payload);
    }

    if (type === "base") {
      const payload: BaseCreateInput = { ...common, fields: asFieldArray(input.fields) ?? [] };
      return client.bases.create(payload);
    }

    if (type === "file") {
      // Worded without a CLI flag prefix on purpose: the same message surfaces
      // to an MCP agent, which has an `assetId` argument and no `--asset-id`.
      if (!input.assetId) throw new Error('assetId is required for type "file".');
      const payload: FileCreateInput = { ...common, assetId: input.assetId };
      return client.files.create(payload);
    }

    // folder | form | whiteboard | workflow | html — no type-specific payload,
    // so the generic tree endpoint loses nothing here.
    return client.nodes.createChangeRequest({
      message: input.message ?? `Create ${type} ${input.name}`,
      submittedBy: input.submittedBy,
      ...mergeIntent(input),
      operations: [
        {
          kind: "create",
          nodeType: type,
          slug: input.slug,
          name: input.name,
          description: input.description,
          parentNodeId: input.parentNodeId,
        },
      ],
    });
  },
};
