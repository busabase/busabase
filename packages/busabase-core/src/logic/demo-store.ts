import "server-only";

import { ORPCError } from "@orpc/server";
import type { NodeDetailVO } from "busabase-contract/contract/node-detail-schemas";
import type { AuthInfo } from "busabase-contract/contract/schemas";
import type {
  AssetDetailVO,
  AssetUsageVO,
  AssetVO,
  ListAssetsDTO,
} from "busabase-contract/domains/assets/types";
import type {
  FileTreeFileVO,
  FileTreeNodeVO,
  FileTreeReadFileVO,
} from "busabase-contract/domains/filetree/types";
import {
  parseHtmlDocument,
  parseWhiteboardDocument,
  parseWorkflowDocument,
} from "busabase-contract/domains/rich-node/types";
import type {
  AgentTaskVO,
  AuditEventVO,
  BaseVO,
  ChangeRequestStatus,
  ChangeRequestVO,
  CommentMentionInputDTO,
  CommentMentionVO,
  CommentSubjectType,
  CommentVO,
  FileNodeVO,
  FormVO,
  NodeSearchResultVO,
  NodeVO,
  OperationKind,
  OperationVO,
  RecordVO,
  SearchResponseVO,
  SearchResultVO,
  ViewVO,
} from "busabase-contract/types";
import { iStringConcat } from "openlib/i18n/i-string";
import { getContextDemoLocale, getContextDemoUseCase } from "../context";
import {
  buildDemoDataset,
  DEMO_ACTOR_ID,
  type DemoDataset,
  type DemoDocVO,
  englishScenario,
} from "../demo/dataset";
import { zhCnScenario } from "../demo/scenarios/zh-cn";
import { getPrimaryField } from "../domains/base/utils/primary-field";
import { type DocLinesResult, sliceDocLinesRange, splitDocLines } from "../domains/doc/handlers";
import { collectAncestorIds } from "./ancestor-chain";
import { type NormalizedCommentMention, normalizeCommentMentions } from "./comment-mentions";
import { isSearchableNodeType, NODE_CONTENT_ADAPTERS } from "./node-content";
import { toPublicAuditMetadata, toPublicSourceMetadata } from "./source-attribution";

// ─────────────────────────────────────────────────────────────────────────────
// Stateless demo read/write layer. Every function reads the shared seed
// (`demo/dataset.ts`) as VOs; writes return synthetic VOs and persist NOTHING,
// so a refresh resets the demo to the seeded state. Selected by the `?demo`
// router at the request boundary — never touches the db.
// ─────────────────────────────────────────────────────────────────────────────

const dataset = (): DemoDataset =>
  buildDemoDataset(
    getContextDemoUseCase(),
    new Date(),
    getContextDemoLocale() === "zh-CN" ? zhCnScenario : englishScenario,
  );

const nowIso = () => new Date().toISOString();
const demoId = (prefix: string) => `${prefix}_demo_${Date.now().toString(36)}`;

const currentScenario = () => (getContextDemoLocale() === "zh-CN" ? zhCnScenario : englishScenario);

/**
 * Read a seeded demo Form by its node id or slug. The stateless demo has no DB,
 * so this maps the scenario's `SeedFormDef` straight to a `FormVO` — enough for
 * the Form detail view to render the agent-authored page. Submissions can't
 * persist a ChangeRequest here (see `demoSubmitForm`).
 */
export const demoGetForm = (nodeIdOrSlug: string): FormVO | null => {
  const def = (currentScenario().forms ?? []).find(
    (form) => form.nodeId === nodeIdOrSlug || form.slug === nodeIdOrSlug,
  );
  if (!def) {
    return null;
  }
  const timestamp = nowIso();
  const targetBase = (currentScenario().bases ?? []).find((base) => base.id === def.targetBaseId);
  const fieldsBySlug = new Map((targetBase?.fields ?? []).map((field) => [field.slug, field]));
  return {
    id: def.formId,
    nodeId: def.nodeId,
    spaceId: "local",
    targetBaseId: def.targetBaseId,
    name: def.name,
    description: def.description,
    bindings: def.bindings,
    boundFields: def.bindings.flatMap((binding) => {
      const field = fieldsBySlug.get(binding.fieldSlug);
      return field
        ? [
            {
              slug: field.slug,
              name: field.name,
              type: field.type,
              choices: (field.options.choices ?? []).map((choice) => ({
                id: choice.id,
                name: choice.name,
              })),
            },
          ]
        : [];
    }),
    page: def.page ?? {},
    share: { isPublic: false, anonymousSubmit: false },
    submissionCount: 0,
    status: "active",
    createdBy: DEMO_ACTOR_ID,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
};

/**
 * A demo Form submission: the stateless demo can't materialize a real pending
 * ChangeRequest, so acknowledge the submit with a synthetic id. The page's
 * success state still shows, so the approval-first flow reads correctly in demo.
 */
export const demoSubmitForm = (): { changeRequestId: string; status: "pending_review" } => ({
  changeRequestId: demoId("cr"),
  status: "pending_review",
});

const notFound = (what: string, id: string) =>
  new ORPCError("NOT_FOUND", { message: `${what} not found in demo: ${id}` });

// ── Reads ────────────────────────────────────────────────────────────────────

// Demo mode never truncates: the whole seeded tree is always in memory
// already (see `dataset()` above), so `nodes.list`'s `parentId`/`depth`
// bounding is a real-DB-only concern — the demo handler ignores its input and
// always returns the full tree, same as the real store's own legacy
// (no-params) call. `hasChildren` on every node is therefore always exactly
// `children.length > 0`, already true from how the fixtures are built.
export const demoListNodes = () => dataset().nodes;

/**
 * Demo counterpart to the real store's `isDescendantOf` — same "walk up from
 * nodeId, does the parentId chain reach potentialAncestorId" contract, just
 * over the in-memory seeded tree instead of the DB (the whole tree is always
 * present, so this is a one-shot build-a-parent-map-then-walk, not a series
 * of queries).
 */
export const demoIsDescendant = (nodeId: string, potentialAncestorId: string): boolean => {
  if (nodeId === potentialAncestorId) return false;
  const parentById = new Map<string, string | null>();
  const visit = (nodes: NodeVO[], parentId: string | null) => {
    for (const node of nodes) {
      parentById.set(node.id, parentId);
      if (node.children.length > 0) visit(node.children, node.id);
    }
  };
  visit(dataset().nodes, null);
  let cursorId: string | null = nodeId;
  const visited = new Set<string>();
  while (cursorId !== null) {
    if (visited.has(cursorId)) return false;
    visited.add(cursorId);
    if (!parentById.has(cursorId)) return false;
    const ancestorId: string | null = parentById.get(cursorId) ?? null;
    if (ancestorId === potentialAncestorId) return true;
    cursorId = ancestorId;
  }
  return false;
};

/**
 * Demo counterpart to `listNodeAncestorIds` — same root-first, self-excluded
 * contract, resolved against the in-memory seeded tree. `nodeIdOrSlug` accepts
 * either, mirroring the real one (whose `resolveVisibleNode` does the same).
 */
export const demoNodeAncestorIds = async (
  nodeIdOrSlug: string,
): Promise<{ ancestorIds: string[] }> => {
  const parentById = new Map<string, string | null>();
  const idBySlug = new Map<string, string>();
  const visit = (nodes: NodeVO[], parentId: string | null) => {
    for (const node of nodes) {
      parentById.set(node.id, parentId);
      if (node.slug && !idBySlug.has(node.slug)) idBySlug.set(node.slug, node.id);
      if (node.children.length > 0) visit(node.children, node.id);
    }
  };
  visit(dataset().nodes, null);

  // Accepts an id or a slug, mirroring the real one (whose `resolveVisibleNode`
  // does the same).
  const nodeId = parentById.has(nodeIdOrSlug) ? nodeIdOrSlug : idBySlug.get(nodeIdOrSlug);
  if (!nodeId) return { ancestorIds: [] };
  return { ancestorIds: await collectAncestorIds(nodeId, (id) => parentById.get(id)) };
};

/**
 * Demo counterpart to the real store's `searchNodesByName` — same "plain
 * name/slug match across every node type" contract, just an in-memory
 * substring scan over the seeded tree instead of an `ilike` query (the whole
 * tree is always in memory already, see `dataset()` above). Exact-slug
 * matches still sort first, mirroring the real store's ordering.
 */
export const demoSearchNodesByName = (input: {
  query: string;
  limit?: number;
}): NodeSearchResultVO[] => {
  const query = input.query.trim().toLowerCase();
  if (!query) return [];
  const limit = input.limit ?? 20;
  const flatten = (nodes: NodeVO[]): NodeVO[] =>
    nodes.flatMap((node) => [node, ...flatten(node.children)]);

  return flatten(dataset().nodes)
    .filter(
      (node) => node.name.toLowerCase().includes(query) || node.slug.toLowerCase().includes(query),
    )
    .sort((a, b) => {
      const aExact = a.slug.toLowerCase() === query ? 0 : 1;
      const bExact = b.slug.toLowerCase() === query ? 0 : 1;
      if (aExact !== bExact) return aExact - bExact;
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit)
    .map((node) => ({
      id: node.id,
      type: node.type,
      name: node.name,
      slug: node.slug,
      path: `/${node.type}/${node.slug}`,
      updatedAt: node.updatedAt,
    }));
};

// `demoListFolders` / `demoGetFolder` are gone with `GET /folders` and
// `GET /folders/{nodeId}`. Folders are listed through
// `nodes.list({ types: ["folder"] })` and read through `nodes.get`, both of
// which work off the seeded tree directly — see `demoListNodeSummaries` /
// `demoGetNodeDetail` below. The old lookup only ever searched the tree's
// FIRST level, so nested demo folders now resolve where they used to 404.

export const demoListBases = () => dataset().bases;

export const demoGetBase = (baseId: string): BaseVO => {
  const base = dataset().bases.find((item) => item.id === baseId || item.slug === baseId);
  if (!base) {
    throw notFound("Base", baseId);
  }
  return base;
};

export const demoListViews = (baseId?: string): ViewVO[] => {
  const views = dataset().views;
  return baseId ? views.filter((view) => view.baseId === baseId) : views;
};

export const demoListRecords = (input: { baseId?: string } = {}): RecordVO[] =>
  dataset().records.filter((record) => !input.baseId || record.baseId === input.baseId);

export const demoGetRecord = (recordId: string): RecordVO => {
  const record = dataset().records.find((item) => item.id === recordId);
  if (!record) {
    throw notFound("Record", recordId);
  }
  return record;
};

export const demoListRecordsByFieldText = (input: {
  baseId?: string;
  fieldSlug: string;
  valueText: string;
}): RecordVO[] => {
  const needle = input.valueText.toLowerCase();
  return dataset().records.filter((record) => {
    if (input.baseId && record.baseId !== input.baseId) {
      return false;
    }
    const value = record.headCommit.payload[input.fieldSlug];
    return typeof value === "string" && value.toLowerCase().includes(needle);
  });
};

export const demoGetRecordByField = (input: {
  baseId: string;
  fieldSlug: string;
  valueText: string;
}): RecordVO | null => {
  const record = dataset().records.find((item) => {
    if (item.baseId !== input.baseId) return false;
    const value = item.headCommit.payload[input.fieldSlug];
    return value === input.valueText;
  });
  return record ?? null;
};

const toPublicDemoChangeRequest = (changeRequest: ChangeRequestVO): ChangeRequestVO => {
  const source = toPublicSourceMetadata(changeRequest.sourceMeta);
  return { ...changeRequest, ...source };
};

const toPublicDemoAuditEvent = (event: AuditEventVO): AuditEventVO => {
  const source = toPublicAuditMetadata(event.metadata);
  return { ...event, ...source };
};

export const demoListChangeRequests = (): ChangeRequestVO[] =>
  dataset().changeRequests.map(toPublicDemoChangeRequest);

export const demoGetChangeRequest = (changeRequestId: string): ChangeRequestVO => {
  const changeRequest = dataset().changeRequests.find((item) => item.id === changeRequestId);
  if (!changeRequest) {
    throw notFound("ChangeRequest", changeRequestId);
  }
  return toPublicDemoChangeRequest(changeRequest);
};

export const demoListRecordChangeRequests = (recordId: string): ChangeRequestVO[] =>
  dataset()
    .changeRequests.filter((changeRequest) =>
      changeRequest.operations.some(
        (operation) =>
          operation.targetRecordId === recordId ||
          operation.sourceRecordId === recordId ||
          operation.mergedRecordId === recordId,
      ),
    )
    .map(toPublicDemoChangeRequest);

export const demoListAuditEvents = (): AuditEventVO[] =>
  dataset().auditEvents.map(toPublicDemoAuditEvent);

export const demoListComments = (input: {
  subjectType: CommentSubjectType;
  subjectId: string;
}): CommentVO[] =>
  dataset().comments.filter(
    (comment) => comment.subjectType === input.subjectType && comment.subjectId === input.subjectId,
  );

/**
 * Read state for the demo's Mentions tab.
 *
 * The demo dataset is rebuilt per request and its comment VOs carry no
 * `readAt` (the real column lives on `busabase_comment_mentions`, which demo
 * mode never touches), so "already read" has to live somewhere else. A
 * module-level set is enough and matches how `demo-agent.ts` keeps its
 * scripted session state: it survives within a browsing session, which is all
 * a demo needs, and costs nothing when the tab is never opened.
 */
const demoReadMentionCommentIds = new Set<string>();

/** Comment ids in the demo dataset that `@`-mention the demo visitor. */
const demoMentionedCommentIds = (): CommentVO[] =>
  dataset()
    .comments.filter((comment) =>
      comment.mentions.some(
        (mention) => mention.type === "member" && mention.targetId === DEMO_ACTOR_ID,
      ),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

export const demoListMentionInbox = (input: { page: number; pageSize: number }) => {
  const all = demoMentionedCommentIds();
  const offset = (input.page - 1) * input.pageSize;
  return {
    all,
    page: all.slice(offset, offset + input.pageSize),
    unreadCount: all.filter((comment) => !demoReadMentionCommentIds.has(comment.id)).length,
    isUnread: (commentId: string) => !demoReadMentionCommentIds.has(commentId),
  };
};

export const demoMarkMentionsRead = (commentId: string) => {
  const known = demoMentionedCommentIds().some((comment) => comment.id === commentId);
  const marked = known && !demoReadMentionCommentIds.has(commentId) ? 1 : 0;
  if (known) demoReadMentionCommentIds.add(commentId);
  return {
    marked,
    unreadCount: demoMentionedCommentIds().filter(
      (comment) => !demoReadMentionCommentIds.has(comment.id),
    ).length,
  };
};

// `demoListDocs` is gone with `GET /docs`; Docs are listed through
// `nodes.list({ types: ["doc"] })`, which returns summaries and no bodies.

export const demoGetDoc = (nodeIdOrSlug: string): DemoDocVO => {
  const doc = dataset().docs.find(
    (item) => item.node.id === nodeIdOrSlug || item.node.slug === nodeIdOrSlug,
  );
  if (!doc) {
    throw notFound("Doc", nodeIdOrSlug);
  }
  return doc;
};

// Unlike `assets.readTextLines`/top-level `grep` (demoUnsupported below — no
// real per-asset object storage backs the stateless demo dataset), node content
// is already fully in memory here: a Doc's `body` on `DemoDocVO`, and the three
// rich types' documents under `metadata.*Document`. So this is a real, working
// demo implementation, not `demoUnsupported`.
//
// Reuses the exact same pieces the storage-backed `readNodeLines`
// (`logic/node-content.ts`) uses — `sliceDocLinesRange` for clamp/cap/truncated
// and the registry's own extractors for the JSON-backed types — so demo and
// production report identical line numbers for the same content. Extracting
// from a re-serialized document (rather than a second, demo-only extractor) is
// what keeps that guarantee: one extraction implementation, not two.
export const demoReadNodeLines = (
  nodeIdOrSlug: string,
  startLine: number,
  endLine: number,
): DocLinesResult => {
  // `dataset().nodes` is a TREE, so flatten it — the same `flattenNodes`
  // every other demo node lookup (`demoGetNodeDetail`, the summary list) uses.
  const node = flattenNodes(dataset().nodes).find(
    (item) => item.id === nodeIdOrSlug || item.slug === nodeIdOrSlug,
  );
  if (!node || !isSearchableNodeType(node.type)) {
    throw notFound("Node", nodeIdOrSlug);
  }
  if (node.type === "doc") {
    return sliceDocLinesRange(splitDocLines(demoGetDoc(node.id).body), startLine, endLine);
  }
  if (node.type === "html") {
    const source = parseHtmlDocument(node.metadata.htmlDocument).source;
    return sliceDocLinesRange(splitDocLines(source), startLine, endLine);
  }
  const raw = JSON.stringify(
    node.type === "whiteboard"
      ? parseWhiteboardDocument(node.metadata.whiteboardDocument)
      : parseWorkflowDocument(node.metadata.workflowDocument),
  );
  const extract = NODE_CONTENT_ADAPTERS[node.type].toSearchableText;
  return sliceDocLinesRange(splitDocLines(extract(raw)), startLine, endLine);
};

// `demoListFileNodes` is gone with `GET /files`; File nodes are listed through
// `nodes.list({ types: ["file"] })`, which returns summaries and no Assets.

export const demoGetFileNode = (nodeIdOrSlug: string): FileNodeVO => {
  const file = dataset().files.find(
    (item) => item.node.id === nodeIdOrSlug || item.node.slug === nodeIdOrSlug,
  );
  if (!file) {
    throw notFound("File", nodeIdOrSlug);
  }
  return file;
};

const flattenNodes = (nodes: NodeVO[]): NodeVO[] =>
  nodes.flatMap((node) => [node, ...flattenNodes(node.children)]);

const getDemoFileTreeDef = (nodeIdOrSlug: string, type?: "skill" | "drive" | "airapp") => {
  const def = dataset().fileTreeNodes.find(
    (item) =>
      (!type || item.nodeType === type) &&
      (item.nodeId === nodeIdOrSlug || item.slug === nodeIdOrSlug),
  );
  if (!def) throw notFound("File tree", nodeIdOrSlug);
  return def;
};

const getDemoMimeType = (path: string) => {
  const extension = path.split(".").at(-1)?.toLowerCase();
  if (extension === "md" || extension === "mdx") return "text/markdown";
  if (extension === "json") return "application/json";
  if (extension === "csv") return "text/csv";
  if (extension === "html") return "text/html";
  if (extension === "css") return "text/css";
  if (["js", "jsx", "ts", "tsx"].includes(extension ?? "")) return "text/plain";
  return "text/plain";
};

const demoFileAssetId = (nodeId: string, path: string) =>
  `ast_demo_${nodeId}_${path.replace(/[^a-zA-Z0-9]+/g, "_")}`;

const demoContentHash = (content: string) => {
  let hash = 2166136261;
  for (const character of content) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return `demo-${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

const toDemoFileTreeFile = (
  nodeId: string,
  updatedAt: string,
  file: { path: string; content: string },
): FileTreeFileVO => ({
  path: file.path,
  name: file.path.split("/").at(-1) ?? file.path,
  size: new TextEncoder().encode(file.content).byteLength,
  updatedAt,
  mimeType: getDemoMimeType(file.path),
  assetId: demoFileAssetId(nodeId, file.path),
  displayName: null,
});

const getDemoEntryFile = (type: "skill" | "drive" | "airapp", paths: string[]) => {
  const preferred =
    type === "skill"
      ? ["SKILL.md"]
      : type === "drive"
        ? ["README.md"]
        : ["package.json", "server.ts", "server.js", "index.html"];
  return preferred.find((path) => paths.includes(path)) ?? paths[0] ?? "";
};

export const demoGetFileTree = (
  nodeIdOrSlug: string,
  type?: "skill" | "drive" | "airapp",
): FileTreeNodeVO => {
  const def = getDemoFileTreeDef(nodeIdOrSlug, type);
  const node = flattenNodes(dataset().nodes).find((item) => item.id === def.nodeId);
  if (!node) throw notFound("File tree node", def.nodeId);
  return {
    node,
    entryFile: getDemoEntryFile(
      def.nodeType,
      def.files.map((file) => file.path),
    ),
    visibility: "workspace",
    version: "0.1.0",
    files: def.files.map((file) => toDemoFileTreeFile(def.nodeId, node.updatedAt, file)),
  };
};

// `demoListFileTrees` is gone with `GET /file-trees`; Skills/Drives/AirApps are
// listed through `nodes.list({ types: ["skill", "drive", "airapp"] })`, which
// returns summaries and no file inventories.

export const demoReadFileTreeFile = (
  nodeIdOrSlug: string,
  filePath: string,
  type?: "skill" | "drive" | "airapp",
): FileTreeReadFileVO => {
  const def = getDemoFileTreeDef(nodeIdOrSlug, type);
  const file = def.files.find((item) => item.path === filePath);
  if (!file) throw notFound("File", filePath);
  return {
    nodeId: def.nodeId,
    path: file.path,
    encoding: "utf8",
    content: file.content,
    mimeType: getDemoMimeType(file.path),
    assetId: demoFileAssetId(def.nodeId, file.path),
    displayName: null,
    assetUrl: null,
    contentHash: demoContentHash(file.content),
  };
};

// ── Unified Node surface (nodes.list({ types }) / nodes.get) ─────────────────
// The demo has to serve the SAME consolidated shape as the real store, or the
// demo becomes the one place where a client can get away with calling a route
// that no longer exists.

/**
 * Demo counterpart to `listNodeSummaries`. The seeded tree is already fully in
 * memory, so this is a flat filter over it — but it deliberately returns the
 * same lightweight shape (`children: []`) the real store returns, rather than
 * the nested tree, so a client cannot accidentally depend on demo-only depth.
 */
export const demoListNodeSummaries = (types: readonly string[]): NodeVO[] =>
  flattenNodes(dataset().nodes)
    .filter((node) => types.includes(node.type))
    .map((node) => ({ ...node, children: [], hasChildren: false }));

/**
 * Demo counterpart to `getNodeDetail`. Same discriminated union, same
 * ambiguous-slug refusal, same fail-closed behaviour for a type with no demo
 * detail builder.
 */
export const demoGetNodeDetail = (nodeIdOrSlug: string, type?: string): NodeDetailVO => {
  const matches = flattenNodes(dataset().nodes).filter(
    (item) =>
      (!type || item.type === type) && (item.id === nodeIdOrSlug || item.slug === nodeIdOrSlug),
  );
  const node = matches.find((item) => item.id === nodeIdOrSlug) ?? matches[0];
  if (!node) throw notFound("Node", nodeIdOrSlug);
  // Only a SLUG can be ambiguous — an id matched exactly above.
  if (node.id !== nodeIdOrSlug) {
    const slugTypes = [...new Set(matches.map((item) => item.type))];
    if (slugTypes.length > 1) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Slug "${nodeIdOrSlug}" exists as ${slugTypes.join(" and ")}; pass \`type\` to choose one.`,
      });
    }
  }

  const nodeType: string = node.type;
  switch (node.type) {
    // Built straight off the seeded tree rather than via a folders-only lookup,
    // so a NESTED demo folder resolves the same way a top-level one does.
    case "folder":
      return { type: "folder", node, children: node.children ?? [] };
    case "doc":
      return { type: "doc", ...demoGetDoc(node.id) };
    case "file":
      return { type: "file", ...demoGetFileNode(node.id) };
    case "skill":
    case "drive":
    case "airapp": {
      const fileTree = demoGetFileTree(node.id, node.type);
      return {
        type: node.type,
        ...fileTree,
        skippedGitignorePaths: fileTree.skippedGitignorePaths ?? [],
      };
    }
    case "base":
    case "form":
      return { type: node.type, node };
    // The demo dataset's seed scenarios still carry these three under
    // `metadata.whiteboardDocument`/`workflowDocument`/`htmlDocument`
    // (`demo/scenarios/node-types.*.ts` — untouched by the move to object
    // storage, since the demo dataset is a stateless, in-memory mock with no
    // real storage backend to move them into). The REAL store's equivalent
    // detail now carries an explicit `document` field
    // (`domains/rich-node/handlers.ts`), so the demo must too, or it becomes
    // the one place a client sees a whiteboard/workflow/html detail with no
    // document at all.
    case "whiteboard":
      return {
        type: "whiteboard",
        node,
        document: parseWhiteboardDocument(node.metadata.whiteboardDocument),
      };
    case "workflow":
      return {
        type: "workflow",
        node,
        document: parseWorkflowDocument(node.metadata.workflowDocument),
      };
    case "html":
      return { type: "html", node, document: parseHtmlDocument(node.metadata.htmlDocument) };
  }
  // Unreachable for a registered built-in type (the switch above is exhaustive
  // over `NodeType`), but a late `registerNodeType()` plugin can reach it — and
  // it must fail closed rather than return a mis-discriminated VO.
  throw new ORPCError("NOT_IMPLEMENTED", {
    message: `No detail is available for node type "${nodeType}"`,
  });
};

// No agent tasks in the demo dataset; the review surface treats empty as "no
// agent work queued".

export const demoListAgentTasks = (): AgentTaskVO[] =>
  dataset()
    .changeRequests.filter((changeRequest) => changeRequest.status === "changes_requested")
    .map((changeRequest) => ({
      changeRequest: toPublicDemoChangeRequest(changeRequest),
      trigger: "changes_requested" as const,
      reviewReason: null,
      aiComments: [],
    }));

// Demo auth: a fixed demo identity (the seeded actor) owning the demo space.
// The demo store has no ACL layer at all — every seeded node is readable — so
// the space reports the `open` default, matching what the demo actually does.
const DEMO_AUTH_SPACE = {
  id: "demo",
  name: "Demo Workspace",
  slug: "demo",
  plan: "demo",
  nodeVisibilityMode: "open" as const,
};
export const demoGetAuthInfo = (): AuthInfo => ({
  space: DEMO_AUTH_SPACE,
  user: { id: DEMO_ACTOR_ID, name: "Demo User", email: null, image: null },
  member: { userId: DEMO_ACTOR_ID, spaceId: "demo", role: "owner" },
  spaces: [DEMO_AUTH_SPACE],
});

// --- Assets (derived from the seed's attachment field values) ---------------
// The demo has no DB, so the Asset library + Where-Used are computed on the fly:
// scan every seeded record's attachment-type fields, dedup by attachmentId, and
// treat each referencing record as a usage. Asset id == attachmentId in demo mode.

interface DemoAssetRef {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
}

const extractDemoRefs = (value: unknown): DemoAssetRef[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const refs: DemoAssetRef[] = [];
  for (const item of value) {
    if (item && typeof item === "object") {
      const r = item as Record<string, unknown>;
      const id =
        typeof r.attachmentId === "string"
          ? r.attachmentId
          : typeof r.id === "string"
            ? r.id
            : null;
      if (id) {
        refs.push({
          attachmentId: id,
          fileName: typeof r.fileName === "string" ? r.fileName : id,
          mimeType: typeof r.mimeType === "string" ? r.mimeType : "application/octet-stream",
          size: typeof r.size === "number" ? r.size : 0,
          url: typeof r.url === "string" ? r.url : "",
        });
      }
    }
  }
  return refs;
};

const buildDemoAssetIndex = (): {
  assets: Map<string, AssetVO>;
  usages: Map<string, AssetUsageVO[]>;
} => {
  const data = dataset();
  const epoch = new Date(0).toISOString();
  const assets = new Map<string, AssetVO>();
  const usages = new Map<string, AssetUsageVO[]>();

  for (const record of data.records) {
    const base = record.base;
    if (!base) {
      continue;
    }
    const attachmentSlugs = base.fields
      .filter((field) => field.type === "attachment")
      .map((field) => field.slug);
    for (const slug of attachmentSlugs) {
      for (const ref of extractDemoRefs(record.headCommit.payload[slug])) {
        if (!assets.has(ref.attachmentId)) {
          assets.set(ref.attachmentId, {
            id: ref.attachmentId,
            attachmentId: ref.attachmentId,
            name: ref.fileName,
            contentKind: "binary",
            metadata: {},
            fileName: ref.fileName,
            mimeType: ref.mimeType,
            size: ref.size,
            url: ref.url,
            contentHash: null,
            usageCount: 0,
            // Decorative demo-only binary refs — no text supplied.
            textStatus: "missing",
            createdAt: epoch,
          });
        }
        const list = usages.get(ref.attachmentId) ?? [];
        list.push({
          ownerType: "base",
          nodeId: base.nodeId ?? base.id,
          nodeName: base.name,
          nodeType: "base",
          nodeSlug: base.slug,
          path: null,
          recordId: record.id,
          fieldSlug: slug,
          blockId: null,
          createdAt: epoch,
        });
        usages.set(ref.attachmentId, list);
      }
    }
  }
  for (const [id, asset] of assets) {
    asset.usageCount = (usages.get(id) ?? []).length;
  }
  return { assets, usages };
};

export const demoListAssets = (input?: ListAssetsDTO): AssetVO[] => {
  const all = [...buildDemoAssetIndex().assets.values()];
  if (input?.limit === undefined) return all;
  // Mirror the real handler's contract so a demo-mode caller exercises the same
  // paging loop it will run against a live workspace: `cursor` is the previous
  // page's last asset id, and an unknown one is an error rather than a silent
  // restart from the top.
  let start = 0;
  if (input.cursor) {
    const at = all.findIndex((asset) => asset.id === input.cursor);
    if (at < 0) {
      throw new ORPCError("BAD_REQUEST", {
        message: `Unknown assets cursor: ${input.cursor}. Pass the \`id\` of the last asset from the previous page.`,
      });
    }
    start = at + 1;
  }
  return all.slice(start, start + input.limit);
};

export const demoGetAsset = (assetId: string): AssetDetailVO => {
  const { assets, usages } = buildDemoAssetIndex();
  const asset = assets.get(assetId);
  if (!asset) {
    throw notFound("Asset", assetId);
  }
  return { asset, usages: usages.get(assetId) ?? [] };
};

const toSearchText = (fields: Record<string, unknown>) =>
  Object.values(fields)
    .map((value) =>
      typeof value === "string" ? value : Array.isArray(value) ? value.join(" ") : "",
    )
    .join(" ");

export const demoSearch = (input: {
  query: string;
  limit?: number;
  offset?: number;
  sources?: ("records" | "files" | "names" | "nodes")[];
}): SearchResponseVO => {
  const query = (input.query ?? "").trim();
  const limit = input.limit ?? 20;
  const offset = input.offset ?? 0;
  const data = dataset();
  const needle = query.toLowerCase();
  const match = (haystack: string) => needle === "" || haystack.toLowerCase().includes(needle);
  // No `sources` means every caller before this parameter existed — search
  // everything, same default as the real (non-demo) searchBusabase.
  // `nodes` (node content) has no demo projection — the stateless demo
  // dataset has no object storage to index. Accepted and ignored.
  const wantsSource = (source: "records" | "files" | "names" | "nodes") =>
    !input.sources || input.sources.includes(source);
  // Demo mode has no separate file-content search — `files` has nothing to
  // additionally include or exclude here (mirrors real search's own "no
  // Doc bodies" boundary, just a different missing source).
  const wantsRecords = wantsSource("records");
  const wantsNames = wantsSource("names");

  const recordResults: SearchResultVO[] = !wantsRecords
    ? []
    : data.records
        .filter((record) => match(`${toSearchText(record.headCommit.payload)}`))
        .map((record) => ({
          id: record.id,
          kind: "record",
          // Title = the Base's lowest-position field value, matching the canonical store.
          title:
            String(record.headCommit.payload[getPrimaryField(record.base)?.slug ?? ""] ?? "") ||
            record.id,
          body: String(
            record.headCommit.payload.body ?? record.headCommit.payload.description ?? "",
          ),
          eyebrow: `${record.base.name} · canonical record`,
          href: `/base/${record.base.slug}/${record.id}`,
          updatedAt: record.updatedAt,
        }));

  const changeRequestResults: SearchResultVO[] = !wantsRecords
    ? []
    : data.changeRequests
        .filter((changeRequest) =>
          match(
            changeRequest.operations
              .map((operation) => toSearchText(operation.headCommit.payload))
              .join(" "),
          ),
        )
        .map((changeRequest) => ({
          id: changeRequest.id,
          kind: "change_request",
          title:
            changeRequest.operationCount > 1
              ? `${changeRequest.operationCount} operation changeRequest`
              : String(
                  changeRequest.primaryOperation?.headCommit.payload.title ??
                    changeRequest.primaryOperation?.headCommit.payload.name ??
                    changeRequest.id,
                ),
          body: changeRequest.operations
            .map((operation) => toSearchText(operation.headCommit.payload))
            .join(" "),
          eyebrow: `${changeRequest.base?.name ?? "Node tree"} · ${changeRequest.status}`,
          href: `/inbox/${changeRequest.id}`,
          updatedAt: changeRequest.updatedAt,
        }));

  const baseResults: SearchResultVO[] = !wantsNames
    ? []
    : data.bases
        .filter((base) => match(`${base.name} ${base.description} ${base.slug}`))
        .map((base) => ({
          id: base.id,
          kind: "base",
          title: base.name,
          body: `${base.description} ${base.fields.map((field) => `${iStringConcat(field.name)} ${field.slug}`).join(" ")}`,
          eyebrow: `${base.fields.length} fields · ${base.slug}`,
          href: `/base/${base.slug}`,
          updatedAt: base.createdAt,
        }));

  const results = [...recordResults, ...changeRequestResults, ...baseResults].slice(
    offset,
    offset + limit,
  );
  return {
    // The stateless demo dataset has no content projection, so it never
    // reports partial content coverage.
    contentTruncated: false,
    hasMore:
      recordResults.length + changeRequestResults.length + baseResults.length > offset + limit,
    limit,
    offset,
    query,
    results,
  };
};

// ── Synthetic writes (no persistence) ─────────────────────────────────────────

const synthOperation = (
  changeRequestId: string,
  baseId: string,
  operation: OperationKind,
  payload: Record<string, unknown>,
  options: Partial<OperationVO> = {},
): OperationVO => {
  const createdAt = nowIso();
  const commitId = demoId("qcm");
  return {
    id: demoId("qop"),
    changeRequestId,
    baseId,
    targetType: "base",
    nodeId: null,
    operation,
    status: "pending",
    targetRecordId: null,
    targetViewId: null,
    filePath: null,
    sourceRecordId: null,
    sourceCommitId: null,
    baseCommitId: null,
    headCommitId: commitId,
    deleteMode: "archive",
    mergedRecordId: null,
    mergedViewId: null,
    position: 0,
    createdAt,
    updatedAt: createdAt,
    headCommit: {
      id: commitId,
      baseId,
      targetType: "base",
      nodeId: null,
      operationId: null,
      parentCommitId: null,
      payload,
      operation,
      message: "Demo change",
      author: DEMO_ACTOR_ID,
      createdAt,
    },
    baseFields: null,
    ...options,
  };
};

const synthChangeRequest = (
  baseId: string,
  status: ChangeRequestStatus,
  operations: OperationVO[],
  sourceMeta: Record<string, unknown> = { demo: true },
): ChangeRequestVO => {
  const createdAt = nowIso();
  const base = dataset().bases.find((item) => item.id === baseId) ?? null;
  return toPublicDemoChangeRequest({
    id: demoId("qdf"),
    baseId,
    targetType: "base",
    nodeId: null,
    status,
    submittedBy: DEMO_ACTOR_ID,
    sourceMeta,
    reviewPolicySnapshot: { kind: "single", requiredApprovals: 1 },
    mergeSummary: {},
    rejectedReason: null,
    reviewedAt: null,
    mergedAt: null,
    createdAt,
    updatedAt: createdAt,
    base,
    node: null,
    operations,
    primaryOperation: operations[0] ?? null,
    operationCount: operations.length,
    reviews: [],
  });
};

export const demoReviewChangeRequest = (
  changeRequestId: string,
  payload: { verdict: "approved" | "rejected"; reason?: string },
): ChangeRequestVO => {
  const changeRequest = demoGetChangeRequest(changeRequestId);
  const status: ChangeRequestStatus =
    payload.verdict === "approved" ? "approved" : "changes_requested";
  const reviewedAt = nowIso();
  return {
    ...changeRequest,
    status,
    reviewedAt,
    updatedAt: reviewedAt,
    rejectedReason: payload.verdict === "rejected" ? (payload.reason ?? null) : null,
    reviews: [
      ...changeRequest.reviews,
      {
        id: demoId("qrv"),
        changeRequestId,
        reviewerId: DEMO_ACTOR_ID,
        verdict: payload.verdict,
        reason: payload.reason ?? null,
        visibleOperationHeads: Object.fromEntries(
          changeRequest.operations.map((operation) => [operation.id, operation.headCommitId]),
        ),
        createdAt: reviewedAt,
      },
    ],
  };
};

export const demoCloseChangeRequest = (
  changeRequestId: string,
  reason?: string,
): ChangeRequestVO => {
  const changeRequest = demoGetChangeRequest(changeRequestId);
  const updatedAt = nowIso();
  return {
    ...changeRequest,
    status: "abandoned",
    rejectedReason: reason ?? null,
    updatedAt,
  };
};

export const demoMergeChangeRequest = (
  changeRequestId: string,
): { changeRequest: ChangeRequestVO; record: RecordVO | null; view: ViewVO | null } => {
  const changeRequest = demoGetChangeRequest(changeRequestId);
  const mergedAt = nowIso();
  const mergedChangeRequest: ChangeRequestVO = {
    ...changeRequest,
    status: "merged",
    mergedAt,
    updatedAt: mergedAt,
  };
  const primary = changeRequest.primaryOperation;
  const base = changeRequest.base;
  // Surface a plausible canonical record so the UI can land on lineage; reset
  // on refresh because nothing persisted.
  const record: RecordVO | null =
    primary && base && primary.operation !== "view_update" && primary.operation !== "view_delete"
      ? {
          id: primary.targetRecordId ?? demoId("qrc"),
          baseId: base.id,
          headCommitId: primary.headCommitId,
          parentRecordId: null,
          parentCommitId: null,
          status: primary.operation === "record_delete" ? "archived" : "active",
          createdBy: DEMO_ACTOR_ID,
          archivedAt: primary.operation === "record_delete" ? mergedAt : null,
          createdAt: changeRequest.createdAt,
          updatedAt: mergedAt,
          base,
          headCommit: primary.headCommit,
        }
      : null;
  return { changeRequest: mergedChangeRequest, record, view: null };
};

export const demoCreateChangeRequest = (
  baseId: string,
  payload: { fields: Record<string, unknown>; submittedBy?: string },
): ChangeRequestVO =>
  synthChangeRequest(baseId, "in_review", [
    synthOperation(demoId("qdf"), baseId, "record_create", payload.fields),
  ]);

export const demoCreateDeleteChangeRequest = (recordId: string): ChangeRequestVO => {
  const record = demoGetRecord(recordId);
  return synthChangeRequest(record.baseId, "in_review", [
    synthOperation(demoId("qdf"), record.baseId, "record_delete", record.headCommit.payload, {
      targetRecordId: recordId,
      baseFields: record.headCommit.payload,
    }),
  ]);
};

export const demoCreateUpdateChangeRequest = (
  recordId: string,
  payload: { fields: Record<string, unknown> },
): ChangeRequestVO => {
  const record = demoGetRecord(recordId);
  return synthChangeRequest(record.baseId, "in_review", [
    synthOperation(demoId("qdf"), record.baseId, "record_update", payload.fields, {
      targetRecordId: recordId,
      baseFields: record.headCommit.payload,
    }),
  ]);
};

export const demoReviseOperation = (operationId: string): ChangeRequestVO => {
  const changeRequest = dataset().changeRequests.find((item) =>
    item.operations.some((operation) => operation.id === operationId),
  );
  if (!changeRequest) {
    throw notFound("Operation", operationId);
  }
  return toPublicDemoChangeRequest({
    ...changeRequest,
    status: "in_review",
    updatedAt: nowIso(),
  });
};

export const demoCreateAuditEvent = (input: {
  action: AuditEventVO["action"];
  actorId?: string;
  baseId?: string | null;
  recordId?: string | null;
  changeRequestId?: string | null;
  operationId?: string | null;
  commitId?: string | null;
  metadata?: Record<string, unknown>;
}): AuditEventVO =>
  toPublicDemoAuditEvent({
    id: demoId("qae"),
    action: input.action,
    actorId: input.actorId ?? "local-viewer",
    baseId: input.baseId ?? null,
    recordId: input.recordId ?? null,
    changeRequestId: input.changeRequestId ?? null,
    operationId: input.operationId ?? null,
    commitId: input.commitId ?? null,
    metadata: input.metadata ?? {},
    createdAt: nowIso(),
  });

/**
 * Echo a comment back as a VO. Demo mode persists nothing, so this is a shape,
 * not a write — but the mention spans still go through the same validator the
 * real path uses, so a demo client cannot ship spans the real server would
 * reject.
 *
 * `mentionOverrides` lets the demo router stamp real dispatch state onto agent
 * rows after it starts the scripted session (see `router-demo.ts`).
 */
export const demoCreateComment = (
  input: {
    subjectType: CommentVO["subjectType"];
    subjectId: string;
    authorId?: string;
    body: string;
    mentions?: CommentMentionInputDTO[];
  },
  mentionOverrides?: (
    mention: NormalizedCommentMention,
    index: number,
  ) => Partial<CommentMentionVO>,
): CommentVO => {
  const createdAt = nowIso();
  const commentId = demoId("qcomment");
  const normalized = normalizeCommentMentions(input.body, input.mentions ?? []);
  return {
    id: commentId,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    recordId: input.subjectType === "record" ? input.subjectId : null,
    changeRequestId: input.subjectType === "change_request" ? input.subjectId : null,
    operationId: input.subjectType === "operation" ? input.subjectId : null,
    commitId: input.subjectType === "commit" ? input.subjectId : null,
    authorId: input.authorId ?? DEMO_ACTOR_ID,
    body: input.body,
    mentions: normalized.map((mention, index) => ({
      id: `${commentId}_mention_${index}`,
      type: mention.type,
      targetId: mention.targetId,
      label: mention.targetId,
      start: mention.start,
      end: mention.end,
      dispatchStatus: mention.type === "agent" ? ("queued" as const) : ("not_applicable" as const),
      sessionId: null,
      error: null,
      ...mentionOverrides?.(mention, index),
    })),
    createdAt,
    updatedAt: createdAt,
  };
};
