import "server-only";

import { ORPCError } from "@orpc/server";
import type { NodeContentType } from "busabase-contract/contract/node-content-schemas";
import { updateNodeContentInputSchema } from "busabase-contract/contract/node-content-schemas";
import {
  DEFAULT_HTML_DOCUMENT,
  EMPTY_WHITEBOARD_DOCUMENT,
  EMPTY_WORKFLOW_DOCUMENT,
  type HtmlDocument,
  parseHtmlDocument,
  parseWhiteboardDocument,
  parseWorkflowDocument,
  type WhiteboardDocument,
  type WorkflowDocument,
} from "busabase-contract/domains/rich-node/types";
import type { ChangeRequestVO, NodeVO } from "busabase-contract/types";
import { and, eq, isNull } from "drizzle-orm";
import { storage } from "openlib/storage";
import type { z } from "zod";
import { getContextSpaceId, resolveActorId, withContextSourceMeta } from "../../context";
import { getDb } from "../../db";
import {
  busabaseChangeRequests,
  busabaseCommits,
  busabaseNodes,
  busabaseOperations,
  type CommitPO,
  type NodePO,
  type OperationPO,
} from "../../db/schema";
import {
  parseCommitPayload,
  type RichNodeDocumentOperationKind,
} from "../../logic/commit-payload-schemas";
import { insertCommit } from "../../logic/commits";
import { id, now } from "../../logic/kernel";
import { assertNodePermission, buildNodeVisibilityCondition } from "../../logic/node-acl";
import { registerNodeRuntime } from "../../logic/node-runtime";
import { ensureReady } from "../../logic/seed";
import {
  finalizeChangeRequest,
  insertAuditEvent,
  loadNodesByIds,
  type MergeCtx,
  toNodeVO,
} from "../../logic/store";
import { assertDocBodySize } from "../doc/handlers";

/**
 * `PUT /nodes/{nodeId}/content` — one content-write endpoint for the four node
 * types that own exactly one document (doc, whiteboard, workflow, html). Takes
 * over what `updateDocBody` + `createDocChangeRequest` used to do for Doc
 * alone, and gives whiteboard/workflow/html a reviewed content write for the
 * first time — they previously wrote straight to `node.metadata` through
 * `PATCH /nodes/{nodeId}/metadata`, with no ChangeRequest and no history.
 *
 * See `apps/busabase/content/spec/node-content-storage.md` (D2/D3) for the
 * full design and its rejected alternatives.
 */

// ── Storage (whiteboard/workflow/html) ──────────────────────────────────────
//
// Mirrors `docBodyKey`/`writeDocBody`/`readDocBody` in `domains/doc/handlers.ts`
// one level up: doc's body already lives in object storage, this just gives
// the other three content-bearing node types the same home instead of
// `metadata`, per spec D2. Doc itself keeps its own storage helpers — only
// whiteboard/workflow/html are handled here.

const RICH_NODE_TYPES = ["whiteboard", "workflow", "html"] as const;
type RichNodeType = (typeof RICH_NODE_TYPES)[number];
type RichNodeDocument = WhiteboardDocument | WorkflowDocument | HtmlDocument;

const richNodeStoragePrefix = (nodeId: string, type: RichNodeType) =>
  `busabase/nodes/${nodeId}/${type}/`;

// html stores just the raw `source` string (not a JSON-wrapped document) so
// grep matches real HTML rather than JSON-escaped HTML — the same reasoning
// that keeps a Doc body as plain markdown text rather than `{ body: "..." }`.
// Re-added on read via `parseHtmlDocument({ version: 1, source })` below.
const richNodeDocumentKey = (nodeId: string, type: RichNodeType): string => {
  const prefix = richNodeStoragePrefix(nodeId, type);
  if (type === "html") return `${prefix}index.html`;
  return `${prefix}${type === "whiteboard" ? "scene" : "graph"}.json`;
};

const richNodeMimeType = (type: RichNodeType): string =>
  type === "html" ? "text/html; charset=utf-8" : "application/json";

const serializeRichNodeDocument = (type: RichNodeType, document: RichNodeDocument): string =>
  type === "html" ? (document as HtmlDocument).source : JSON.stringify(document);

export const writeRichNodeDocument = async (
  nodeId: string,
  type: RichNodeType,
  document: RichNodeDocument,
): Promise<void> => {
  await storage.uploadFileToKey(
    Buffer.from(serializeRichNodeDocument(type, document), "utf8"),
    richNodeDocumentKey(nodeId, type),
    richNodeMimeType(type),
  );
};

// `null` (not thrown) on a missing/failed read — a rich node can legitimately
// have no document object yet: node creation no longer accepts initial
// content for these three types (see `logic/nodes.ts`'s block on the
// `whiteboardDocument`/`workflowDocument`/`htmlDocument` metadata keys), so
// every whiteboard/workflow/html node starts with nothing in storage at all.
const readRichNodeRaw = async (nodeId: string, type: RichNodeType): Promise<string | null> => {
  try {
    return (await storage.getObject(richNodeDocumentKey(nodeId, type))).toString("utf8");
  } catch {
    return null;
  }
};

const emptyRichNodeDocument = (type: RichNodeType): RichNodeDocument => {
  if (type === "whiteboard") return structuredClone(EMPTY_WHITEBOARD_DOCUMENT);
  if (type === "workflow") return structuredClone(EMPTY_WORKFLOW_DOCUMENT);
  return structuredClone(DEFAULT_HTML_DOCUMENT);
};

// Parses raw storage bytes into the type's document, falling back to the
// empty/default document — never throwing — on a missing object OR malformed
// stored JSON, mirroring `parseWhiteboardDocument`/`parseWorkflowDocument`'s
// own safeParse-with-fallback contract. A freshly created (never edited) rich
// node must render an empty canvas/graph/page, not a 404 or 500.
const parseRichNodeRaw = (type: RichNodeType, raw: string | null): RichNodeDocument => {
  if (raw === null) return emptyRichNodeDocument(type);
  if (type === "html") return parseHtmlDocument({ version: 1, source: raw });
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return emptyRichNodeDocument(type);
  }
  return type === "whiteboard" ? parseWhiteboardDocument(json) : parseWorkflowDocument(json);
};

export async function readRichNodeDocument(
  nodeId: string,
  type: "whiteboard",
): Promise<WhiteboardDocument>;
export async function readRichNodeDocument(
  nodeId: string,
  type: "workflow",
): Promise<WorkflowDocument>;
export async function readRichNodeDocument(nodeId: string, type: "html"): Promise<HtmlDocument>;
export async function readRichNodeDocument(
  nodeId: string,
  type: RichNodeType,
): Promise<RichNodeDocument> {
  return parseRichNodeRaw(type, await readRichNodeRaw(nodeId, type));
}

// ── Node detail hydration (whiteboard/workflow/html) ────────────────────────
//
// Replaces `buildGenericDetail`'s `{ type, node }` fallback in
// `logic/node-detail.ts` for these three types: now that their document lives
// in object storage instead of `node.metadata`, the detail response must
// carry it explicitly or the client has no way to read it at all.

// `loadNodesByIds` (rather than a bare `toNodeVO`) so a rich node still
// resolves whatever `loadNodesByIds` hydrates beyond the raw row — mirrors
// `buildGenericDetail` / `toDocVO`'s same fallback in their own domains.
const resolveNodeVO = async (node: NodePO): Promise<NodeVO> => {
  const nodeMap = await loadNodesByIds([node.id]);
  return nodeMap.get(node.id) ?? toNodeVO(node, null);
};

export const getWhiteboardDetail = async (
  node: NodePO,
): Promise<{ type: "whiteboard"; node: NodeVO; document: WhiteboardDocument }> => ({
  type: "whiteboard",
  node: await resolveNodeVO(node),
  document: await readRichNodeDocument(node.id, "whiteboard"),
});

export const getWorkflowDetail = async (
  node: NodePO,
): Promise<{ type: "workflow"; node: NodeVO; document: WorkflowDocument }> => ({
  type: "workflow",
  node: await resolveNodeVO(node),
  document: await readRichNodeDocument(node.id, "workflow"),
});

export const getHtmlDetail = async (
  node: NodePO,
): Promise<{ type: "html"; node: NodeVO; document: HtmlDocument }> => ({
  type: "html",
  node: await resolveNodeVO(node),
  document: await readRichNodeDocument(node.id, "html"),
});

// ── The unified write ────────────────────────────────────────────────────────

const CONTENT_OPERATION_BY_KIND = {
  doc: "doc_update",
  whiteboard: "whiteboard_document_update",
  workflow: "workflow_document_update",
  html: "html_document_update",
} as const satisfies Record<string, OperationPO["operation"]>;

const nodeNotFound = (nodeId: string) =>
  new ORPCError("NOT_FOUND", { message: `Node not found: ${nodeId}` });

/**
 * Bounds the size of any one whiteboard/workflow/html snapshot — same
 * rationale and same caveat as `DOC_BODY_MAX_BYTES`: every edit is also
 * duplicated into `commits.payload` forever (no pruning), so this only bounds
 * the pathological single-huge-document case, not unbounded history growth.
 *
 * Measured on the full JSON-serialized `document`, not one field: a
 * whiteboard's size lives in `elements`/`appState`, a workflow's in
 * `nodes`/`edges` — there is no single string to check like Doc's `body`.
 * `html`'s `source` already has a schema-level `.max(500_000)` (characters,
 * not bytes) in `HtmlDocumentSchema`; this is the outer, byte-accurate bound
 * that also covers whiteboard/workflow, which have no schema-level cap at all.
 * Checked in bytes (`Buffer.byteLength`, not JS string `.length`) for the same
 * multi-byte-undercounting reason as `DOC_BODY_MAX_BYTES`.
 */
const RICH_NODE_DOCUMENT_MAX_BYTES = 1_000_000;

const assertRichNodeDocumentSize = (
  kind: Exclude<NodeContentType, "doc">,
  document: unknown,
): void => {
  const byteLength = Buffer.byteLength(JSON.stringify(document), "utf8");
  if (byteLength > RICH_NODE_DOCUMENT_MAX_BYTES) {
    throw new ORPCError("PAYLOAD_TOO_LARGE", {
      message:
        `${kind} document is ${byteLength} bytes, exceeding the ` +
        `${RICH_NODE_DOCUMENT_MAX_BYTES}-byte limit.`,
    });
  }
};

/**
 * `PUT /nodes/{nodeId}/content` handler. Takes over what Doc's
 * `updateDocBody` (direct write, `write`-gated) and `createDocChangeRequest`
 * (review-first, `changeRequest`-gated) used to do as two separate paths —
 * `finalizeChangeRequest` already contains the permission-aware autoMerge
 * decision (spec D3's `shouldAutoMerge`), so one path expresses both intents:
 * this ALWAYS creates a ChangeRequest (+ commit + operation), then lets
 * `finalizeChangeRequest` decide whether it merges immediately or waits for
 * review. No behavior is removed — a `write`-level actor still gets an
 * immediate merge with omitted/`true` `autoMerge`, exactly as direct-write did.
 */
export const updateNodeContent = async (
  input: z.input<typeof updateNodeContentInputSchema>,
): Promise<ChangeRequestVO> => {
  await ensureReady();
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const parsed = updateNodeContentInputSchema.parse(input);
  const submittedBy = resolveActorId(parsed.submittedBy);

  // Node ACL: a hidden/cross-space node resolves to nothing — indistinguishable
  // from absent, same as every other node-scoped read/write in this codebase.
  const visible = buildNodeVisibilityCondition(db);
  const [node] = await db
    .select()
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.id, parsed.nodeId),
        eq(busabaseNodes.spaceId, spaceId),
        isNull(busabaseNodes.archivedAt),
        visible,
      ),
    )
    .limit(1);
  if (!node) {
    throw nodeNotFound(parsed.nodeId);
  }

  // `kind` is redundant with the resolved node's real type on purpose (see
  // node-content-schemas.ts's doc comment) — a wrong-shaped document is a
  // named 400 here, before anything is written, not a silently-ignored field.
  if (node.type !== parsed.content.kind) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        `Content kind "${parsed.content.kind}" does not match node type "${node.type}" ` +
        `for node ${node.id}.`,
    });
  }

  let fields: Record<string, unknown>;
  if (parsed.content.kind === "doc") {
    // Same cap as Doc's other write paths (`DOC_BODY_MAX_BYTES`) — rejected
    // before any ChangeRequest exists, mirroring `createDocChangeRequest`'s
    // "rejected before any CR was ever created" contract.
    assertDocBodySize(parsed.content.body);
    fields = { body: parsed.content.body };
  } else {
    assertRichNodeDocumentSize(parsed.content.kind, parsed.content.document);
    fields = { document: parsed.content.document };
  }
  const operation = CONTENT_OPERATION_BY_KIND[parsed.content.kind];

  // ChangeRequest-submission gate (node ACL): the floor for this endpoint is
  // `changeRequest`, not `write` — `finalizeChangeRequest` below re-checks
  // `write` itself to decide whether this particular call auto-merges.
  await assertNodePermission(node.id, "changeRequest", submittedBy);

  const changeRequestId = id("crq");
  const operationId = id("opr");
  const commitId = id("cmt");
  const timestamp = now();

  await db.insert(busabaseChangeRequests).values({
    id: changeRequestId,
    baseId: null,
    targetType: "node",
    nodeId: node.id,
    status: "in_review",
    submittedBy,
    sourceMeta: withContextSourceMeta({ subject: parsed.content.kind, nodeId: node.id }),
    reviewPolicySnapshot: { kind: "single", requiredApprovals: 1 },
    mergeSummary: {},
    rejectedReason: null,
    reviewedAt: null,
    mergedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await insertCommit(db, {
    id: commitId,
    baseId: null,
    targetType: "node",
    nodeId: node.id,
    operationId: null,
    parentCommitId: null,
    payload: fields,
    operation,
    message: parsed.message,
    author: submittedBy,
    createdAt: timestamp,
  });
  await db.insert(busabaseOperations).values({
    id: operationId,
    changeRequestId,
    baseId: null,
    targetType: "node",
    nodeId: node.id,
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
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.update(busabaseCommits).set({ operationId }).where(eq(busabaseCommits.id, commitId));

  await insertAuditEvent(db, {
    action: "change_request.created",
    actorId: submittedBy,
    baseId: null,
    changeRequestId,
    metadata: { operation, nodeId: node.id },
  });

  return finalizeChangeRequest({
    changeRequestId,
    nodeId: node.id,
    requestedAutoMerge: parsed.autoMerge,
    submittedBy,
    baseId: null,
    label: parsed.content.kind,
    kind: "structural",
  });
};

// ── Merge (whiteboard/workflow/html) ────────────────────────────────────────
//
// Dispatched from `cr-lifecycle.ts`'s node-operation switch via
// `/^[a-z0-9-]+_document_update$/`, the same regex-family pattern already used
// for `_file_(create|update|delete)` and `_metadata_update`. `doc_update`
// keeps using `mergeDocUpdate` in `domains/doc/handlers.ts` — unaffected by
// this file.
export const mergeRichNodeDocumentUpdate = async (
  _ctx: MergeCtx,
  item: OperationPO,
  node: NodePO,
  headCommit: CommitPO,
): Promise<void> => {
  if (node.type !== "whiteboard" && node.type !== "workflow" && node.type !== "html") {
    throw new Error(`Invalid rich-node document operation target: ${item.id}`);
  }
  const fields = parseCommitPayload(
    item.operation as RichNodeDocumentOperationKind,
    headCommit.payload,
  );
  const document =
    node.type === "whiteboard"
      ? parseWhiteboardDocument(fields.document)
      : node.type === "workflow"
        ? parseWorkflowDocument(fields.document)
        : parseHtmlDocument(fields.document);
  await writeRichNodeDocument(node.id, node.type, document);
};

// Registered here rather than named in a kernel table: `logic/node-detail.ts`
// used to list all three explicitly, which is one of the ten kernel files a new
// node type had to touch (spec: node-type-plugin-architecture.md).
registerNodeRuntime("whiteboard", { hydrateDetail: getWhiteboardDetail });
registerNodeRuntime("workflow", { hydrateDetail: getWorkflowDetail });
registerNodeRuntime("html", { hydrateDetail: getHtmlDetail });
