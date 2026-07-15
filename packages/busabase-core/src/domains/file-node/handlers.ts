import "server-only";

import { ORPCError } from "@orpc/server";
import { createFileNodeInputSchema } from "busabase-contract/domains/file-node/contract";
import type { ChangeRequestVO, FileNodeVO, NodeVO } from "busabase-contract/types";
import { and, asc, eq, isNull } from "drizzle-orm";
import type { z } from "zod";
import { getContextSpaceId, resolveActorId } from "../../context";
import { getDb } from "../../db";
import { busabaseAssetUsages, busabaseNodes, type NodePO } from "../../db/schema";
import { CURRENT_USER_ID, id, now, rootNodeIdForSpace } from "../../logic/kernel";
import { type MaterializeArgs, registerMaterializer } from "../../logic/materialize";
import { assertContainerParent } from "../../logic/node-parent";
import { ensureReady } from "../../logic/seed";
import {
  loadNodesByIds,
  type MergeCtx,
  recordMergedNodeCreate,
  recordPendingNodeCreate,
  toNodeVO,
} from "../../logic/store";
import { resolveAssetFile } from "../assets/handlers";
import { getAssetTextStatus } from "../assets/logic/asset-texts-logic";

const getString = (value: unknown) => (typeof value === "string" ? value : null);

const getFileNodeAssetId = (node: NodePO): string | null => getString(node.metadata?.assetId);

const getFileNode = async (nodeIdOrSlug: string) => {
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const [byId] = await db
    .select()
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.id, nodeIdOrSlug),
        eq(busabaseNodes.spaceId, spaceId),
        eq(busabaseNodes.type, "file"),
        isNull(busabaseNodes.archivedAt),
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
  const assetId = getFileNodeAssetId(node);
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
  const existing = await getFileNode(parsed.slug);
  if (existing) {
    return { ...(await toFileNodeVO(existing)), materialized: true as const };
  }
  const asset = await resolveAssetFile(parsed.assetId);
  const parentNodeId = parsed.parentNodeId ?? rootNodeIdForSpace(getContextSpaceId());
  const [parentNodeRow] = await db
    .select()
    .from(busabaseNodes)
    .where(eq(busabaseNodes.id, parentNodeId))
    .limit(1);
  const parentNode = assertContainerParent(parentNodeRow, "file", parentNodeId);

  // Review-first by default: propose the File node as a pending node_create
  // ChangeRequest instead of materializing it immediately. Callers that don't
  // need human review (seed/migration scripts, an explicit no-review agent
  // task) pass `autoMerge: true` to keep today's instant-create behavior.
  if (!parsed.autoMerge) {
    const changeRequest = await recordPendingNodeCreate({
      nodeType: "file",
      slug: parsed.slug,
      name: parsed.name,
      description: parsed.description,
      parentNodeId: parentNode.id,
      metadata: { assetId: asset.id },
      message: `Create file ${parsed.name}`,
      submittedBy: resolveActorId(CURRENT_USER_ID),
    });
    return { ...changeRequest, materialized: false as const };
  }

  const nodeId = id("nod");
  const timestamp = now();
  const metadata = { assetId: asset.id };
  await db.insert(busabaseNodes).values({
    id: nodeId,
    parentId: parentNode.id,
    type: "file",
    slug: parsed.slug,
    name: parsed.name,
    description: parsed.description,
    metadata,
    position: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await syncFileNodeAssetUsage(nodeId, asset.id, db);
  await recordMergedNodeCreate({
    nodeId,
    nodeType: "file",
    slug: parsed.slug,
    name: parsed.name,
    description: parsed.description,
    parentNodeId: parentNode.id,
    metadata,
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

export const listFileNodes = async (): Promise<FileNodeVO[]> => {
  await ensureReady();
  const db = await getDb();
  const nodes = await db
    .select()
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.type, "file"),
        eq(busabaseNodes.spaceId, getContextSpaceId()),
        isNull(busabaseNodes.archivedAt),
      ),
    )
    .orderBy(asc(busabaseNodes.position), asc(busabaseNodes.createdAt));
  return Promise.all(nodes.map(toFileNodeVO));
};

export const materializeFileNode = async (ctx: MergeCtx, args: MaterializeArgs) => {
  const { db, timestamp } = ctx;
  const { parentNode, fields } = args;
  const assetId = getString(fields.metadata?.assetId);
  if (!assetId) {
    throw new Error("File node create requires metadata.assetId");
  }
  const asset = await resolveAssetFile(assetId, db);
  const metadata = { assetId: asset.id };
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
