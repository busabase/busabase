import "server-only";

import { ORPCError } from "@orpc/server";
import type { FolderBodyFormat, FolderVO } from "busabase-contract/domains/folder/types";
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
import { assertNodeStorageId } from "../../logic/node-storage-key";
import { ensureReady } from "../../logic/seed";
import { loadNodesByIds, type MergeCtx, toNodeVO } from "../../logic/store";
import { syncDocAssetUsages } from "../assets/handlers";

const FOLDER_README_MIME: Record<FolderBodyFormat, string> = {
  markdown: "text/markdown; charset=utf-8",
  html: "text/html; charset=utf-8",
};

export const folderStoragePrefix = (nodeId: string) => {
  assertNodeStorageId(nodeId);
  return `busabase/nodes/${nodeId}/folder/`;
};
// Exported so grep/readLines address the same object `readFolderBody` reads.
// Never Doc's `…/doc/doc.md`.
export const folderReadmeKey = (nodeId: string) => `${folderStoragePrefix(nodeId)}readme.md`;
// An HTML readme is a raw `.html` object, like an HTML node's `index.html`, so
// grep matches the real source.
export const folderReadmeHtmlKey = (nodeId: string) => `${folderStoragePrefix(nodeId)}readme.html`;
const folderReadmeKeyFor = (nodeId: string, format: FolderBodyFormat) =>
  format === "html" ? folderReadmeHtmlKey(nodeId) : folderReadmeKey(nodeId);
/** Both readme objects a folder may own — what a purge has to clean up. */
export const folderReadmeKeys = (nodeId: string) => [
  folderReadmeKey(nodeId),
  folderReadmeHtmlKey(nodeId),
];

/**
 * Which readme object is live. The format is not stored anywhere else: it is
 * whichever object exists, and `readme.html` wins when both do. A write
 * uploads the new object before deleting the other one, so the only way both
 * exist is a delete that failed — and that write threw, so its merge rolled
 * back. If it was a switch to HTML, HTML is already right; if it was a switch
 * to Markdown, the unmerged change correctly leaves the HTML page in place.
 *
 * `getObjectMetadata`, not `objectExists`: on S3 the latter reads every
 * failure (a timed-out HEAD included) as "absent", which would let a backup
 * fall through to the empty Markdown key and silently drop an HTML readme.
 * This answers "absent" only for a real 404 and throws otherwise.
 */
export const resolveFolderReadme = async (
  nodeId: string,
): Promise<{ key: string; format: FolderBodyFormat }> => {
  const htmlKey = folderReadmeHtmlKey(nodeId);
  return (await storage.getObjectMetadata(htmlKey))
    ? { key: htmlKey, format: "html" }
    : { key: folderReadmeKey(nodeId), format: "markdown" };
};

export const writeFolderBody = async (
  nodeId: string,
  body: string,
  format: FolderBodyFormat = "markdown",
) => {
  await storage.uploadFileToKey(
    Buffer.from(body, "utf8"),
    folderReadmeKeyFor(nodeId, format),
    FOLDER_README_MIME[format],
  );
  // One readme per folder. A failed delete throws on purpose (see
  // `resolveFolderReadme`); deleting a missing object is a no-op.
  await storage.deleteObject(folderReadmeKeyFor(nodeId, format === "html" ? "markdown" : "html"));
};

// Missing object (and a failed read) is an empty readme — a folder can exist
// with no body object at all, and a storage hiccup must not take the folder's
// children down with it. Same swallow as `readDocBody`.
export const readFolderBody = async (
  nodeId: string,
): Promise<{ body: string; bodyFormat: FolderBodyFormat }> => {
  const readme = await resolveFolderReadme(nodeId).catch(() => null);
  if (!readme) return { body: "", bodyFormat: "markdown" };
  const body = (await storage.getObject(readme.key).catch(() => Buffer.from(""))).toString("utf8");
  return { body, bodyFormat: readme.format };
};

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
    ...(await readFolderBody(folderNode.id)),
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

// node-targeted merge handler for folder_update: write the proposed readme in
// its format. Children, description, and Doc storage are untouched.
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
  // Absent `bodyFormat` is Markdown: every folder_update recorded before HTML
  // readmes existed, and every Markdown write since, carries none.
  await writeFolderBody(node.id, body, fields.bodyFormat ?? "markdown");
  // Asset reads are authorized through usage rows, so an image embedded in the
  // readme with no usage is readable only by its uploader and space managers —
  // everyone else, a public-share visitor included, gets a broken image. Same
  // whole-node usage Doc writes (`ownerType: "doc"` names that body shape, not
  // the node type; Where-Used reads the node's real type). The scan only looks
  // for `/api/assets/{id}/raw` URLs, so it reads an HTML readme's `src`
  // attributes as well as Markdown. Runs on the merge transaction, as in
  // `mergeDocUpdate`.
  await syncDocAssetUsages(node.id, body, ctx.db);
};
