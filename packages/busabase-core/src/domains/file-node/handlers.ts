import "server-only";

import { ORPCError } from "@orpc/server";
import { createFileNodeInputSchema } from "busabase-contract/domains/file-node/contract";
import type { ChangeRequestVO, FileNodeVO, NodeVO } from "busabase-contract/types";
import { and, eq, isNull } from "drizzle-orm";
import type { z } from "zod";
import { getContextSpaceId, resolveActorId } from "../../context";
import { getDb } from "../../db";
import { busabaseAssetUsages, busabaseNodes, type NodePO } from "../../db/schema";
import { CURRENT_USER_ID, id, now, rootNodeIdForSpace } from "../../logic/kernel";
import { type MaterializeArgs, registerMaterializer } from "../../logic/materialize";
import {
  buildNodeVisibilityCondition,
  hasNodePermission,
  initializeNodeAcl,
  shouldAutoMerge,
} from "../../logic/node-acl";
import { assertContainerParent } from "../../logic/node-parent";
import { registerNodeRuntime } from "../../logic/node-runtime";
import {
  findActiveNodeByTypeAndSlug,
  isNodeSlugUniqueViolation,
  nodeSlugConflict,
} from "../../logic/node-slug";
import { ensureReady } from "../../logic/seed";
import {
  loadNodesByIds,
  type MergeCtx,
  recordMergedNodeCreate,
  recordPendingNodeCreate,
  toNodeVO,
} from "../../logic/store";
import { resolveAssetFile, resolveAssetFileForMaterialization } from "../assets/handlers";
import { getAssetTextStatus } from "../assets/logic/asset-texts-logic";

const getString = (value: unknown) => (typeof value === "string" ? value : null);

/**
 * A file node's backing Asset, read from the `busabase_asset_usages` row that
 * `syncFileNodeAssetUsage` maintains — NOT from `node.metadata.assetId`.
 *
 * The usage row was always the real reference: it is what the asset library's
 * where-used index and its delete guard count, and every write path already
 * kept it in step. `metadata.assetId` was a second copy of the same fact living
 * in the free-form extension bag, which `content/spec/node-content-storage.md`
 * (D1) rules out — two sources of truth that can drift, and a
 * product-enforced field the generic metadata endpoint could reach.
 *
 * One extra indexed lookup per file-node detail read. That read already issues
 * several queries (`loadNodesByIds`, `resolveAssetFile`, the text-status join)
 * and is never used to render a list, so this is not on a hot path.
 */
const getFileNodeAssetId = async (
  nodeId: string,
  tx?: Awaited<ReturnType<typeof getDb>>,
): Promise<string | null> => {
  const db = tx ?? (await getDb());
  const [usage] = await db
    .select({ assetId: busabaseAssetUsages.assetId })
    .from(busabaseAssetUsages)
    .where(
      and(
        eq(busabaseAssetUsages.nodeId, nodeId),
        eq(busabaseAssetUsages.ownerType, "file_node"),
        eq(busabaseAssetUsages.fieldSlug, "file:asset"),
      ),
    )
    .limit(1);
  return usage?.assetId ?? null;
};

const getFileNode = async (nodeIdOrSlug: string) => {
  const db = await getDb();
  const spaceId = getContextSpaceId();
  // Node ACL: hidden file nodes resolve to null — indistinguishable from absent.
  const visible = buildNodeVisibilityCondition(db);
  const [byId] = await db
    .select()
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.id, nodeIdOrSlug),
        eq(busabaseNodes.spaceId, spaceId),
        eq(busabaseNodes.type, "file"),
        isNull(busabaseNodes.archivedAt),
        visible,
      ),
    )
    .limit(1);
  if (byId) {
    return byId;
  }
  const [bySlug] = await db
    .select()
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.slug, nodeIdOrSlug),
        eq(busabaseNodes.spaceId, spaceId),
        eq(busabaseNodes.type, "file"),
        isNull(busabaseNodes.archivedAt),
        visible,
      ),
    )
    .limit(1);
  return bySlug ?? null;
};

const syncFileNodeAssetUsage = async (
  nodeId: string,
  assetId: string,
  tx?: Awaited<ReturnType<typeof getDb>>,
) => {
  const db = tx ?? (await getDb());
  await db
    .delete(busabaseAssetUsages)
    .where(
      and(
        eq(busabaseAssetUsages.nodeId, nodeId),
        eq(busabaseAssetUsages.ownerType, "file_node"),
        eq(busabaseAssetUsages.recordId, ""),
        eq(busabaseAssetUsages.fieldSlug, "file:asset"),
      ),
    );
  await db
    .insert(busabaseAssetUsages)
    .values({
      id: id("aus"),
      assetId,
      ownerType: "file_node",
      nodeId,
      recordId: "",
      fieldSlug: "file:asset",
    })
    .onConflictDoNothing();
};

const toFileNodeVO = async (node: NodePO): Promise<FileNodeVO> => {
  const assetId = await getFileNodeAssetId(node.id);
  if (!assetId) {
    throw new Error(`File node is missing assetId: ${node.id}`);
  }
  const nodeMap = await loadNodesByIds([node.id]);
  const nodeVO: NodeVO = nodeMap.get(node.id) ?? toNodeVO(node, null);
  const [asset, textStatus] = await Promise.all([
    resolveAssetFile(assetId),
    // Best-effort: a text-status lookup failure must degrade to "missing"
    // rather than break the whole node's render (this join runs once per
    // node across every folder listing — an N+1, and not something a
    // transient text-table hiccup should be able to take down).
    getAssetTextStatus(assetId).catch(() => "missing" as const),
  ]);
  return {
    node: nodeVO,
    asset: {
      id: asset.id,
      attachmentId: asset.attachmentId,
      name: asset.name,
      contentKind: asset.contentKind,
      metadata: asset.metadata,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      size: asset.size,
      url: asset.url,
      contentHash: asset.contentHash,
      usageCount: 0,
      textStatus,
      createdAt: node.createdAt.toISOString(),
    },
  };
};

export const createFileNode = async (
  input: z.input<typeof createFileNodeInputSchema>,
): Promise<(FileNodeVO & { materialized: true }) | (ChangeRequestVO & { materialized: false })> => {
  await ensureReady();
  const db = await getDb();
  const parsed = createFileNodeInputSchema.parse(input);
  const parentNodeId = parsed.parentNodeId ?? rootNodeIdForSpace(getContextSpaceId());
  const existing = await getFileNode(parsed.slug);
  if (existing) {
    if (existing.parentId !== parentNodeId) throw nodeSlugConflict("file", parsed.slug);
    return { ...(await toFileNodeVO(existing)), materialized: true as const };
  }
  const asset = await resolveAssetFile(parsed.assetId);
  const [parentNodeRow] = await db
    .select()
    .from(busabaseNodes)
    .where(eq(busabaseNodes.id, parentNodeId))
    .limit(1);
  const parentNode = assertContainerParent(parentNodeRow, "file", parentNodeId);

  // Permission-aware default: merge immediately if the actor has `write` on
  // the parent node; otherwise (or with explicit `autoMerge: false`) propose
  // the File node as a pending node_create ChangeRequest instead.
  const autoMerge = shouldAutoMerge(
    parsed.autoMerge,
    await hasNodePermission(parentNode.id, "write"),
  );

  if (!autoMerge) {
    const changeRequest = await recordPendingNodeCreate({
      nodeType: "file",
      slug: parsed.slug,
      name: parsed.name,
      description: parsed.description,
      parentNodeId: parentNode.id,
      // This one IS `assetId` in metadata, and correctly so: it is the
      // node_create OPERATION PAYLOAD, not the node row. `materializeFileNode`
      // reads it at merge time to know which Asset to mount, then drops it —
      // the merged node row carries no `assetId`, only a usage row.
      metadata: { assetId: asset.id },
      message: `Create file ${parsed.name}`,
      submittedBy: resolveActorId(CURRENT_USER_ID),
    });
    return { ...changeRequest, materialized: false as const };
  }

  const nodeId = id("nod");
  const timestamp = now();
  try {
    await db.insert(busabaseNodes).values({
      id: nodeId,
      parentId: parentNode.id,
      type: "file",
      slug: parsed.slug,
      name: parsed.name,
      description: parsed.description,
      // The backing Asset is recorded by the usage row below. Keeping it out
      // of metadata avoids maintaining two sources of truth for one relation.
      metadata: {},
      position: 0,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  } catch (error) {
    if (isNodeSlugUniqueViolation(error)) {
      const concurrent = await findActiveNodeByTypeAndSlug(db, {
        nodeType: "file",
        slug: parsed.slug,
      });
      if (concurrent?.parentId === parentNode.id) {
        return { ...(await toFileNodeVO(concurrent)), materialized: true as const };
      }
      throw nodeSlugConflict("file", parsed.slug);
    }
    throw error;
  }
  await syncFileNodeAssetUsage(nodeId, asset.id, db);
  await initializeNodeAcl(
    db,
    getContextSpaceId(),
    nodeId,
    parentNode.id,
    resolveActorId(CURRENT_USER_ID),
  );
  await recordMergedNodeCreate({
    nodeId,
    nodeType: "file",
    slug: parsed.slug,
    name: parsed.name,
    description: parsed.description,
    parentNodeId: parentNode.id,
    // The recorded node_create OPERATION PAYLOAD, which carries `assetId` —
    // same shape the review-first path proposes above, so a directly-created
    // file node and a reviewed one leave identical history. The node ROW still
    // stores no `assetId`; only this ledger entry does.
    metadata: { assetId: asset.id },
    message: `Create file ${parsed.name}`,
    submittedBy: resolveActorId(CURRENT_USER_ID),
  });
  const [node] = await db.select().from(busabaseNodes).where(eq(busabaseNodes.id, nodeId)).limit(1);
  if (!node) {
    throw new Error("Failed to create file node");
  }
  return { ...(await toFileNodeVO(node)), materialized: true as const };
};

export const getFileNodeDetail = async (nodeIdOrSlug: string): Promise<FileNodeVO> => {
  await ensureReady();
  const node = await getFileNode(nodeIdOrSlug);
  if (!node) {
    throw new ORPCError("NOT_FOUND", { message: `File not found: ${nodeIdOrSlug}` });
  }
  return toFileNodeVO(node);
};

// `listFileNodes` is gone with `GET /files`. It resolved a full AssetVO (plus a
// text-status lookup) PER row to answer "which File nodes exist" — the N+1 the
// unified summary list (`logic/nodes.ts`'s `listNodeSummaries`) exists to
// remove. `getFileNodeDetail` above still resolves the Asset for one node.

export const materializeFileNode = async (ctx: MergeCtx, args: MaterializeArgs) => {
  const { db, timestamp } = ctx;
  const { parentNode, fields } = args;
  const assetId = getString(fields.metadata?.assetId);
  if (!assetId) {
    throw new Error("File node create requires metadata.assetId");
  }
  const asset = await resolveAssetFileForMaterialization(assetId, db);
  // `assetId` arrives as a CREATE INPUT and is deliberately not persisted into
  // node metadata: the backing Asset is recorded by `syncFileNodeAssetUsage`
  // below, and `getFileNodeAssetId` reads it back from there. Keeping a second
  // copy in the free-form bag gave two sources of truth for one fact.
  //
  // The rest of the caller's metadata IS carried through — dropping it silently
  // discarded `metadata.visibility`, so a file node created as "private" came
  // out workspace-visible.
  const { assetId: _createInputAssetId, ...metadata } = fields.metadata ?? {};
  const nodeId = id("nod");
  await db.insert(busabaseNodes).values({
    id: nodeId,
    parentId: parentNode.id,
    type: "file",
    slug: fields.slug as string,
    name: fields.name as string,
    description: fields.description ?? "",
    metadata,
    position: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await syncFileNodeAssetUsage(nodeId, asset.id, db);
  return nodeId;
};

registerMaterializer("file", materializeFileNode);
registerNodeRuntime("file", {
  hydrateDetail: async (node) => ({ type: "file", ...(await getFileNodeDetail(node.id)) }),
});
