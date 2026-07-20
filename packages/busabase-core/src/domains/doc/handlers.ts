import "server-only";

import { ORPCError } from "@orpc/server";
import {
  createDocChangeRequestInputSchema,
  createDocInputSchema,
  updateDocInputSchema,
} from "busabase-contract/domains/doc/contract";
import type { ChangeRequestVO, NodeVO } from "busabase-contract/types";
import { and, asc, eq, isNull } from "drizzle-orm";
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
// Doc handlers consume the kernel substrate one-way (no cycle). Doc is storage-backed,
// so it owns no DB tables — its body lives in object storage.
import { CURRENT_USER_ID, id, now, rootNodeIdForSpace } from "../../logic/kernel";
import { publishChangeRequestPendingReview } from "../../logic/live-events";
import { type MaterializeArgs, registerMaterializer } from "../../logic/materialize";
import {
  assertNodePermission,
  buildNodeVisibilityCondition,
  initializeNodeAcl,
} from "../../logic/node-acl";
import { assertContainerParent } from "../../logic/node-parent";
import { ensureReady } from "../../logic/seed";
import {
  getChangeRequest,
  insertAuditEvent,
  loadNodesByIds,
  type MergeCtx,
  recordMergedNodeCreate,
  recordMergedOperation,
  recordPendingNodeCreate,
  toNodeVO,
} from "../../logic/store";
import { syncDocAssetUsages } from "../assets/handlers";
import {
  READ_LINES_MAX_LINES,
  READ_LINES_MAX_RESPONSE_BYTES,
} from "../assets/logic/asset-grep-logic";

interface DocVO {
  node: NodeVO;
  storagePrefix: string;
  body: string;
}

const docStoragePrefix = (nodeId: string) => `busabase/nodes/${nodeId}/doc/`;
// Exported so `logic/grep.ts`'s Docs adapter (Unified Grep P2a) can address
// the exact same storage object `readDocBody` reads, without depending on
// this module's swallow-to-empty error handling below (see `readDocBody`'s
// comment) — grep's honest-coverage contract needs a genuine storage failure
// to surface as `coverage.docs.errored`, not silently read as an empty body.
export const docBodyKey = (nodeId: string) => `${docStoragePrefix(nodeId)}doc.md`;

export const writeDocBody = async (nodeId: string, body: string) => {
  await storage.uploadFileToKey(
    Buffer.from(body, "utf8"),
    docBodyKey(nodeId),
    "text/markdown; charset=utf-8",
  );
};

/**
 * A Doc body is written unbounded today, and every edit's full body is also
 * duplicated into `busabase_commits.fields.body` forever (no pruning) — this
 * cap only bounds the SIZE of any one snapshot, not the count of them; it
 * doesn't solve unbounded history growth over many edits, only the
 * pathological single-huge-Doc case. ~300,000 bytes comfortably covers
 * ~100,000 CJK characters (≈3 bytes/char in UTF-8) — generous for a "Doc"
 * (a wiki page / spec / meeting note), well short of book-length content.
 * Checked in bytes (not JS string `.length`, which counts UTF-16 code units)
 * so multi-byte content isn't under-counted, mirroring `putText`'s
 * `INLINE_TEXT_MAX_BYTES` check in `asset-texts-logic.ts`.
 */
const DOC_BODY_MAX_BYTES = 300_000;

const docNotFound = (nodeIdOrSlug: string) =>
  new ORPCError("NOT_FOUND", { message: `Doc not found: ${nodeIdOrSlug}` });

const assertDocBodySize = (body: string): void => {
  const byteLength = Buffer.byteLength(body, "utf8");
  if (byteLength > DOC_BODY_MAX_BYTES) {
    throw new ORPCError("PAYLOAD_TOO_LARGE", {
      message: `Doc body is ${byteLength} bytes, exceeding the ${DOC_BODY_MAX_BYTES}-byte limit (~100,000 CJK characters). Split large content across multiple Docs.`,
    });
  }
};

// Swallows a missing/failed read to an empty body — the right default for
// this module's own callers (a Doc node can legitimately have no body object
// yet). `logic/grep.ts`'s Docs adapter and `readDocLines` below deliberately
// do NOT reuse this swallow (see `readDocBodyForGrep`), since a storage error
// there must surface as a real error, not a clean "scanned, empty, no match".
const readDocBody = async (nodeId: string) =>
  (await storage.getObject(docBodyKey(nodeId)).catch(() => Buffer.from(""))).toString("utf8");

/**
 * Read a Doc body WITHOUT `readDocBody`'s empty-on-failure swallow — a
 * genuine storage failure must surface as a real error to the caller, not a
 * silent empty read. Relocated here from `logic/grep.ts` (Unified Grep P2a),
 * which originally defined this for its own Docs adapter; it now has a
 * second caller (`readDocLines` below), and both are Doc-domain concerns, so
 * this is a more natural home than the grep module. `logic/grep.ts` imports
 * it from here — exactly one implementation.
 */
export const readDocBodyForGrep = async (nodeId: string): Promise<string> =>
  (await storage.getObject(docBodyKey(nodeId))).toString("utf8");

/**
 * Split a text blob into lines with the same convention the assets grep
 * adapter's `iterateLinesFromFile` (Node's `readline`) uses: a trailing `\n`
 * does not create a phantom empty final line, `\r\n` is normalized to `\n`,
 * and an empty body is zero lines (not one empty line) — so a Doc's reported
 * line numbers match what `docs.get` + a text editor would show. Relocated
 * here from `logic/grep.ts` for the same reason as `readDocBodyForGrep`
 * above — shared by the Docs grep adapter AND `readDocLines`.
 */
export const splitDocLines = (body: string): string[] => {
  if (body.length === 0) return [];
  const raw = body.split("\n");
  if (body.endsWith("\n")) raw.pop(); // trailing "\n" does not add a phantom empty last line
  return raw.map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line));
};

export interface DocLinesResult {
  lines: string[];
  startLine: number;
  endLine: number;
  totalLines: number;
  truncated: boolean;
}

/**
 * Clamp + slice an already-split Doc body (`splitDocLines`'s output) down to
 * `[startLine, endLine]`, applying the SAME numeric caps `assets.readTextLines`
 * uses (`READ_LINES_MAX_LINES` / `READ_LINES_MAX_RESPONSE_BYTES`, imported
 * from `asset-grep-logic.ts` rather than redefined, so the two endpoints can
 * never silently drift apart).
 *
 * Pure and synchronous, unlike `readAssetTextLines` — Docs are KB-scale and
 * read/split in full up front (no checkpoints / byte-range storage reads;
 * see `readDocLines` below), so this is a plain in-memory array slice. That
 * also lets it be shared by BOTH the real storage-backed `readDocLines` below
 * AND the stateless demo router's `demoReadDocLines` (`logic/demo-store.ts`,
 * whose seed Doc body is already fully in memory) — one clamp/cap/truncated
 * implementation, not two.
 *
 * `truncated` semantics deliberately differ slightly from
 * `readAssetTextLines`'s: it is `true` whenever a CAP (too many lines
 * requested, or the response byte budget) prevented returning everything
 * asked for — not merely because the request ran past EOF. A request that is
 * satisfied in full, right up to the Doc's last real line, is not
 * "truncated" even though `endLine` gets clamped down to `totalLines`
 * (mirrors `readAssetTextLines`'s own "reports truncated: false when the
 * requested range reaches exactly EOF" regression test).
 */
export const sliceDocLinesRange = (
  lines: string[],
  startLine: number,
  endLine: number,
): DocLinesResult => {
  const requestedStart = Math.max(1, startLine);
  let requestedEnd = Math.max(requestedStart, endLine);
  let lineCountCapped = false;
  if (requestedEnd - requestedStart + 1 > READ_LINES_MAX_LINES) {
    requestedEnd = requestedStart + READ_LINES_MAX_LINES - 1;
    lineCountCapped = true;
  }

  const totalLines = lines.length;
  if (totalLines === 0) {
    return {
      lines: [],
      startLine: requestedStart,
      endLine: requestedEnd,
      totalLines,
      truncated: false,
    };
  }

  const clampedStart = Math.min(requestedStart, totalLines);
  const clampedEnd = Math.min(requestedEnd, totalLines);

  const collected: string[] = [];
  let bytesCollected = 0;
  let byteCapHit = false;
  for (let line = clampedStart; line <= clampedEnd; line++) {
    const text = lines[line - 1];
    const lineBytes = Buffer.byteLength(text, "utf8") + 1; // +1 for the newline, mirrors readAssetTextLines
    // Byte cap hit — but always keep at least the first collected line, even
    // if it alone exceeds the cap (never return nothing).
    if (bytesCollected + lineBytes > READ_LINES_MAX_RESPONSE_BYTES && collected.length > 0) {
      byteCapHit = true;
      break;
    }
    collected.push(text);
    bytesCollected += lineBytes;
  }

  return {
    lines: collected,
    startLine: clampedStart,
    endLine: collected.length > 0 ? clampedStart + collected.length - 1 : clampedStart,
    totalLines,
    truncated: byteCapHit || lineCountCapped,
  };
};

const getDocNode = async (nodeIdOrSlug: string) => {
  const db = await getDb();
  const spaceId = getContextSpaceId();
  // Node ACL: hidden docs resolve to null — indistinguishable from absent.
  const visible = buildNodeVisibilityCondition(db);
  const [byId] = await db
    .select()
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.id, nodeIdOrSlug),
        eq(busabaseNodes.spaceId, spaceId),
        isNull(busabaseNodes.archivedAt),
        visible,
      ),
    )
    .limit(1);
  const [node] =
    byId && byId.type === "doc"
      ? [byId]
      : await db
          .select()
          .from(busabaseNodes)
          .where(
            and(
              eq(busabaseNodes.slug, nodeIdOrSlug),
              eq(busabaseNodes.spaceId, spaceId),
              eq(busabaseNodes.type, "doc"),
              isNull(busabaseNodes.archivedAt),
              visible,
            ),
          )
          .limit(1);
  return node ?? null;
};

const toDocVO = async (node: NodePO): Promise<DocVO> => {
  const nodeMap = await loadNodesByIds([node.id]);
  const nodeVO = nodeMap.get(node.id) ?? toNodeVO(node, null);
  return {
    node: nodeVO,
    storagePrefix: docStoragePrefix(node.id),
    body: await readDocBody(node.id),
  };
};

export const createDoc = async (
  input: z.input<typeof createDocInputSchema>,
): Promise<(DocVO & { materialized: true }) | (ChangeRequestVO & { materialized: false })> => {
  await ensureReady();
  const db = await getDb();
  const parsed = createDocInputSchema.parse(input);
  assertDocBodySize(parsed.body);
  const existing = await getDocNode(parsed.slug);
  if (existing) {
    return { ...(await toDocVO(existing)), materialized: true as const };
  }

  const parentNodeId = parsed.parentNodeId ?? rootNodeIdForSpace(getContextSpaceId());
  const [parentNodeRow] = await db
    .select()
    .from(busabaseNodes)
    .where(eq(busabaseNodes.id, parentNodeId))
    .limit(1);
  const parentNode = assertContainerParent(parentNodeRow, "doc", parentNodeId);

  // Review-first by default: propose the Doc as a pending node_create
  // ChangeRequest instead of materializing it immediately. Callers that don't
  // need human review (seed/migration scripts, an explicit no-review agent
  // task) pass `autoMerge: true` to keep today's instant-create behavior.
  if (!parsed.autoMerge) {
    const changeRequest = await recordPendingNodeCreate({
      nodeType: "doc",
      slug: parsed.slug,
      name: parsed.name,
      description: parsed.description,
      parentNodeId: parentNode.id,
      body: parsed.body,
      message: `Create doc ${parsed.name}`,
      submittedBy: resolveActorId(CURRENT_USER_ID),
    });
    return { ...changeRequest, materialized: false as const };
  }

  const nodeId = id("nod");
  const createdAt = now();
  await db.insert(busabaseNodes).values({
    id: nodeId,
    parentId: parentNode.id,
    type: "doc",
    slug: parsed.slug,
    name: parsed.name,
    description: parsed.description,
    position: 0,
    createdAt,
    updatedAt: createdAt,
  });
  await writeDocBody(nodeId, parsed.body || `# ${parsed.name}\n`);
  await initializeNodeAcl(
    db,
    getContextSpaceId(),
    nodeId,
    parentNode.id,
    resolveActorId(CURRENT_USER_ID),
  );

  const [node] = await db.select().from(busabaseNodes).where(eq(busabaseNodes.id, nodeId)).limit(1);
  if (!node) {
    throw new Error("Failed to create doc node");
  }
  // Record the create as an auto-merged structural ChangeRequest (audit + history
  // + rollback), replacing the old bespoke `doc.created` audit action.
  await recordMergedNodeCreate({
    nodeId,
    nodeType: "doc",
    slug: node.slug,
    name: node.name,
    description: node.description,
    parentNodeId: parentNode.id,
    message: `Create doc ${node.name}`,
    submittedBy: resolveActorId(CURRENT_USER_ID),
  });
  return { ...(await toDocVO(node)), materialized: true as const };
};

export const getDoc = async (nodeIdOrSlug: string): Promise<DocVO> => {
  await ensureReady();
  const node = await getDocNode(nodeIdOrSlug);
  if (!node) {
    throw docNotFound(nodeIdOrSlug);
  }
  return toDocVO(node);
};

// The Doc-domain equivalent of `assets.readTextLines` — an agent's follow-up
// after a Unified Grep match lands inside a Doc (`source: "docs"`), so it can
// read just the lines around the match instead of `getDoc`'s entire body.
// Unlike `readAssetTextLines`, there are no checkpoints / byte-range storage
// reads: a Doc body is read in full (same as `readDocBodyForGrep` /
// `docs.get()` already do — Docs are KB-scale, this is an explicit,
// already-made architecture decision), split into all its lines, then sliced
// in memory via `sliceDocLinesRange`.
export const readDocLines = async (
  nodeIdOrSlug: string,
  startLine: number,
  endLine: number,
): Promise<DocLinesResult> => {
  await ensureReady();
  const node = await getDocNode(nodeIdOrSlug);
  if (!node) {
    throw docNotFound(nodeIdOrSlug);
  }
  const body = await readDocBodyForGrep(node.id);
  return sliceDocLinesRange(splitDocLines(body), startLine, endLine);
};

export const listDocs = async (): Promise<DocVO[]> => {
  await ensureReady();
  const db = await getDb();
  const nodes = await db
    .select()
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.spaceId, getContextSpaceId()),
        eq(busabaseNodes.type, "doc"),
        isNull(busabaseNodes.archivedAt),
        buildNodeVisibilityCondition(db),
      ),
    )
    .orderBy(asc(busabaseNodes.position), asc(busabaseNodes.createdAt));
  return Promise.all(nodes.map(toDocVO));
};

export const updateDocBody = async (
  nodeIdOrSlug: string,
  input: z.input<typeof updateDocInputSchema>,
): Promise<DocVO> => {
  await ensureReady();
  const node = await getDocNode(nodeIdOrSlug);
  if (!node) {
    throw docNotFound(nodeIdOrSlug);
  }
  const parsed = updateDocInputSchema.parse(input);
  assertDocBodySize(parsed.body);
  await writeDocBody(node.id, parsed.body);
  // Record the body edit as an auto-merged doc_update ChangeRequest (audit +
  // history + rollback), replacing the old bespoke `doc.updated` audit action —
  // the same doc_update op shape the reviewed `createDocChangeRequest` path uses.
  await recordMergedOperation({
    operation: "doc_update",
    targetType: "node",
    nodeId: node.id,
    fields: { body: parsed.body },
    message: `Update doc ${node.name}`,
    submittedBy: resolveActorId(CURRENT_USER_ID),
    sourceMeta: withContextSourceMeta({ subject: "doc", nodeId: node.id }),
  });
  return toDocVO(node);
};

// node_create materialization for a Doc node: the node + a seeded body file.
// `fields.body` carries a review-first `createDoc` call's initial body through
// the pending change request (see `recordPendingNodeCreate`); the Dashboard's
// generic node_create flow never sets it, so it keeps the synthesized default.
export const materializeDocNode = async (ctx: MergeCtx, args: MaterializeArgs): Promise<string> => {
  const { db, timestamp } = ctx;
  const { parentNode, fields } = args;
  const nodeId = id("nod");
  await db.insert(busabaseNodes).values({
    id: nodeId,
    parentId: parentNode.id,
    type: "doc",
    slug: fields.slug as string,
    name: fields.name as string,
    description: fields.description ?? "",
    position: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await writeDocBody(nodeId, fields.body || `# ${fields.name}\n`);
  return nodeId;
};

registerMaterializer("doc", materializeDocNode);

// Doc edits are approval-first like everything in Busabase: a change request carrying a
// doc_update op whose commit holds the proposed body; merge writes it to storage.
export const createDocChangeRequest = async (
  nodeIdOrSlug: string,
  input: z.input<typeof createDocChangeRequestInputSchema>,
) => {
  await ensureReady();
  const db = await getDb();
  const node = await getDocNode(nodeIdOrSlug);
  if (!node) {
    throw docNotFound(nodeIdOrSlug);
  }
  // ChangeRequest-submission gate (node ACL): visibility alone isn't enough
  // to propose an edit — requires `changeRequest` level on this doc.
  await assertNodePermission(node.id, "changeRequest");
  const parsed = createDocChangeRequestInputSchema.parse(input);
  assertDocBodySize(parsed.body);
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
    submittedBy: parsed.submittedBy,
    sourceMeta: withContextSourceMeta({ subject: "doc", nodeId: node.id }),
    reviewPolicySnapshot: { kind: "single", requiredApprovals: 1 },
    mergeSummary: {},
    rejectedReason: null,
    reviewedAt: null,
    mergedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.insert(busabaseCommits).values({
    id: commitId,
    baseId: null,
    targetType: "node",
    nodeId: node.id,
    operationId: null,
    parentCommitId: null,
    fields: { body: parsed.body },
    operation: "doc_update",
    message: parsed.message,
    author: parsed.submittedBy,
    createdAt: timestamp,
  });
  await db.insert(busabaseOperations).values({
    id: operationId,
    changeRequestId,
    baseId: null,
    targetType: "node",
    nodeId: node.id,
    operation: "doc_update",
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
    actorId: parsed.submittedBy,
    baseId: null,
    changeRequestId,
    metadata: { operation: "doc_update", nodeId: node.id },
  });
  await publishChangeRequestPendingReview({
    spaceId: getContextSpaceId(),
    baseId: null,
    changeRequestId,
    submittedBy: resolveActorId(parsed.submittedBy),
  });

  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error("Failed to create doc change request");
  }
  return changeRequest;
};

// node-targeted merge handler for doc_update: write the proposed body to storage.
export const mergeDocUpdate = async (
  ctx: MergeCtx,
  item: OperationPO,
  node: NodePO,
  headCommit: CommitPO,
) => {
  if (node.type !== "doc") {
    throw new Error(`Invalid doc operation target: ${item.id}`);
  }
  const fields = headCommit.fields as { body?: string };
  const body = fields.body ?? "";
  await writeDocBody(node.id, body);
  // Pass the merge executor so the asset-usage sync runs on the SAME transaction
  // (re-acquiring getDb() inside a tx would deadlock the single pglite connection).
  await syncDocAssetUsages(node.id, body, ctx.db);
};
