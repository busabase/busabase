import "server-only";

import { ORPCError } from "@orpc/server";
import type { FolderVO } from "busabase-contract/domains/folder/types";
import { and, asc, eq, isNull } from "drizzle-orm";
import { getContextSpaceId } from "../../context";
import { getDb } from "../../db";
import { busabaseNodes, type NodePO } from "../../db/schema";
import { id } from "../../logic/kernel";
import { type MaterializeArgs, registerMaterializer } from "../../logic/materialize";
import { buildNodeVisibilityCondition } from "../../logic/node-acl";
import { ensureReady } from "../../logic/seed";
import { loadNodesByIds, type MergeCtx, toNodeVO } from "../../logic/store";

const getFolderNode = async (nodeIdOrSlug: string) => {
  const db = await getDb();
  const spaceId = getContextSpaceId();
  // Node ACL: hidden folders resolve to null — indistinguishable from absent.
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
    byId && byId.type === "folder"
      ? [byId]
      : await db
          .select()
          .from(busabaseNodes)
          .where(
            and(
              eq(busabaseNodes.slug, nodeIdOrSlug),
              eq(busabaseNodes.spaceId, spaceId),
              eq(busabaseNodes.type, "folder"),
              isNull(busabaseNodes.archivedAt),
              visible,
            ),
          )
          .limit(1);
  return node ?? null;
};

const toFolderVO = async (folderNode: NodePO): Promise<FolderVO> => {
  const db = await getDb();
  const childRows = await db
    .select()
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.parentId, folderNode.id),
        isNull(busabaseNodes.archivedAt),
        buildNodeVisibilityCondition(db),
      ),
    )
    .orderBy(asc(busabaseNodes.position), asc(busabaseNodes.createdAt));
  // Hydrate the folder + children together so base children resolve their baseId.
  const nodeMap = await loadNodesByIds([folderNode.id, ...childRows.map((row) => row.id)]);
  const node = nodeMap.get(folderNode.id) ?? toNodeVO(folderNode, null);
  const children = childRows.map((row) => nodeMap.get(row.id) ?? toNodeVO(row, null));
  return { node, children };
};

export const getFolder = async (nodeIdOrSlug: string): Promise<FolderVO> => {
  await ensureReady();
  const folderNode = await getFolderNode(nodeIdOrSlug);
  if (!folderNode) {
    throw new ORPCError("NOT_FOUND", { message: `Folder not found: ${nodeIdOrSlug}` });
  }
  return toFolderVO(folderNode);
};

export const listFolders = async (): Promise<FolderVO[]> => {
  await ensureReady();
  const db = await getDb();
  const folders = await db
    .select()
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.spaceId, getContextSpaceId()),
        eq(busabaseNodes.type, "folder"),
        isNull(busabaseNodes.archivedAt),
        buildNodeVisibilityCondition(db),
      ),
    )
    .orderBy(asc(busabaseNodes.position), asc(busabaseNodes.createdAt));
  return Promise.all(folders.map(toFolderVO));
};

// node_create materialization for a Folder node: just the generic node row. Folder
// registers it explicitly (rather than relying on the kernel fallback) so the kernel
// owns no folder-specific knowledge.
export const materializeFolderNode = async (
  ctx: MergeCtx,
  args: MaterializeArgs,
): Promise<string> => {
  const { db, timestamp } = ctx;
  const { parentNode, fields } = args;
  const nodeId = id("nod");
  await db.insert(busabaseNodes).values({
    id: nodeId,
    parentId: parentNode.id,
    type: "folder",
    slug: fields.slug as string,
    name: fields.name as string,
    description: fields.description ?? "",
    metadata: fields.metadata ?? {},
    position: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  return nodeId;
};

registerMaterializer("folder", materializeFolderNode);
