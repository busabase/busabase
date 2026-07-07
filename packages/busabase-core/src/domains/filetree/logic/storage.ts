import "server-only";

import { ORPCError } from "@orpc/server";
import type { FileTreeFileVO } from "busabase-contract/types";
import { and, eq, isNull } from "drizzle-orm";
import { storage } from "openlib/storage";
import { getContextSpaceId } from "../../../context";
import { getDb } from "../../../db";
import { busabaseNodes, type NodePO } from "../../../db/schema";

export const normalizeFilePath = (filePath: string) => {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new ORPCError("BAD_REQUEST", { message: `Invalid file path: ${filePath}` });
  }
  return normalized;
};

export const storagePrefix = (nodeId: string) => `busabase/nodes/${nodeId}/current/`;

export const resolveStoragePrefix = (node: NodePO, types?: readonly string[]) => {
  if (types && !types.includes(node.type)) {
    throw new Error(`Node is not a file-tree node: ${node.id}`);
  }
  return node.metadata.storagePrefix || storagePrefix(node.id);
};

export const getFileTreeNode = async (type: string, nodeIdOrSlug: string) => {
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const [byId] = await db
    .select()
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.id, nodeIdOrSlug),
        eq(busabaseNodes.spaceId, spaceId),
        isNull(busabaseNodes.archivedAt),
      ),
    )
    .limit(1);
  const [node] =
    byId && byId.type === type
      ? [byId]
      : await db
          .select()
          .from(busabaseNodes)
          .where(
            and(
              eq(busabaseNodes.slug, nodeIdOrSlug),
              eq(busabaseNodes.spaceId, spaceId),
              eq(busabaseNodes.type, type),
              isNull(busabaseNodes.archivedAt),
            ),
          )
          .limit(1);
  return node ?? null;
};

export const readTextFile = async (node: NodePO, filePath: string) => {
  const path = normalizeFilePath(filePath);
  return (await storage.getObject(`${resolveStoragePrefix(node)}${path}`)).toString("utf8");
};

export const writeTextFile = async (node: NodePO, filePath: string, content: string) => {
  const path = normalizeFilePath(filePath);
  await storage.uploadFileToKey(
    Buffer.from(content, "utf8"),
    `${resolveStoragePrefix(node)}${path}`,
    path.endsWith(".json") ? "application/json" : "text/plain; charset=utf-8",
  );
};

export const deleteTextFile = async (node: NodePO, filePath: string) => {
  await storage.deleteObject(`${resolveStoragePrefix(node)}${normalizeFilePath(filePath)}`);
};

export const listStorageFiles = async (node: NodePO): Promise<FileTreeFileVO[]> => {
  const prefix = resolveStoragePrefix(node);
  const result = await storage.listObjects(prefix, 1000);
  const folders = new Map<string, FileTreeFileVO>();
  const files = result.objects.map((object): FileTreeFileVO => {
    const relativePath = object.key.slice(prefix.length);
    const parts = relativePath.split("/");
    for (let index = 1; index < parts.length; index++) {
      const folderPath = parts.slice(0, index).join("/");
      if (!folders.has(folderPath)) {
        folders.set(folderPath, {
          path: folderPath,
          name: parts[index - 1] ?? folderPath,
          type: "folder",
          size: 0,
          updatedAt: null,
        });
      }
    }
    return {
      path: relativePath,
      name: parts.at(-1) ?? relativePath,
      type: "file",
      size: object.size,
      updatedAt: object.lastModified.toISOString(),
    };
  });
  return [...folders.values(), ...files].sort((a, b) => a.path.localeCompare(b.path));
};
