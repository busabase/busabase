import "server-only";

import { ORPCError } from "@orpc/server";
import type { FolderVO } from "busabase-contract/domains/folder/types";
import { and, asc, eq, isNull } from "drizzle-orm";
import { storage } from "openlib/storage";
import { getContextSpaceId } from "../../context";
import { getDb } from "../../db";
import { busabaseNodes, type CommitPO, type NodePO, type OperationPO } from "../../db/schema";
import { parseCommitPayload } from "../../logic/commit-payload-schemas";
import { id } from "../../logic/kernel";
import { type MaterializeArgs, registerMaterializer } from "../../logic/materialize";
import { buildNodeVisibilityCondition } from "../../logic/node-acl";
import { registerNodeRuntime } from "../../logic/node-runtime";
import { ensureReady } from "../../logic/seed";
import { loadNodesByIds, type MergeCtx, toNodeVO } from "../../logic/store";
import { syncDocAssetUsages } from "../assets/handlers";

const FOLDER_README_MIME = "text/markdown; charset=utf-8";

export const folderStoragePrefix = (nodeId: string) => `busabase/nodes/${nodeId}/folder/`;
// Exported so grep/readLines address the same object `readFolderBody` reads.
// Never Doc's `…/doc/doc.md`.
export const folderReadmeKey = (nodeId: string) => `${folderStoragePrefix(nodeId)}readme.md`;

export const writeFolderBody = async (nodeId: string, body: string) => {
  await storage.uploadFileToKey(
    Buffer.from(body, "utf8"),
    folderReadmeKey(nodeId),
    FOLDER_README_MIME,
  );
};

// Missing object (and a failed read) is an empty readme — a folder can exist
// with no body object at all. Same swallow as `readDocBody`.
export const readFolderBody = async (nodeId: string) =>
  (await storage.getObject(folderReadmeKey(nodeId)).catch(() => Buffer.from(""))).toString("utf8");

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
  return {
    node,
    children,
    storagePrefix: folderStoragePrefix(folderNode.id),
    body: await readFolderBody(folderNode.id),
  };
};

export const getFolder = async (nodeIdOrSlug: string): Promise<FolderVO> => {
  await ensureReady();
  const folderNode = await getFolderNode(nodeIdOrSlug);
  if (!folderNode) {
    throw new ORPCError("NOT_FOUND", { message: `Folder not found: ${nodeIdOrSlug}` });
  }
  return toFolderVO(folderNode);
};

// `listFolders` is gone with `GET /folders`. It ran a children query plus a
// hydration pass PER folder to answer "which folders exist" — the N+1 the
// unified summary list (`logic/nodes.ts`'s `listNodeSummaries`) exists to
// remove. `getFolder` below still hydrates children for one folder at a time.

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
registerNodeRuntime("folder", {
  hydrateDetail: async (node) => ({ type: "folder", ...(await getFolder(node.id)) }),
});

// node-targeted merge handler for folder_update: write the proposed readme.
// Children, description, and Doc storage are untouched.
export const mergeFolderUpdate = async (
  ctx: MergeCtx,
  item: OperationPO,
  node: NodePO,
  headCommit: CommitPO,
) => {
  if (node.type !== "folder") {
    throw new Error(`Invalid folder operation target: ${item.id}`);
  }
  const fields = parseCommitPayload("folder_update", headCommit.payload);
  const body = fields.body ?? "";
  await writeFolderBody(node.id, body);
  // Asset reads are authorized through usage rows, so an image embedded in the
  // readme with no usage is readable only by its uploader and space managers —
  // everyone else, a public-share visitor included, gets a broken image. Same
  // whole-node markdown usage Doc writes (`ownerType: "doc"` names that body
  // shape, not the node type; Where-Used reads the node's real type). Runs on
  // the merge transaction, as in `mergeDocUpdate`.
  await syncDocAssetUsages(node.id, body, ctx.db);
};
