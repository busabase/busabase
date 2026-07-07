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

export const readFile = async (node: NodePO, filePath: string) => {
  const path = normalizeFilePath(filePath);
  return storage.getObject(`${resolveStoragePrefix(node)}${path}`);
};

export const readTextFile = async (node: NodePO, filePath: string) => {
  const path = normalizeFilePath(filePath);
  return (await readFile(node, path)).toString("utf8");
};

export const mimeTypeForPath = (path: string) => {
  const lower = path.toLowerCase();
  if (lower.endsWith(".csv")) {
    return "text/csv; charset=utf-8";
  }
  if (lower.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (lower.endsWith(".json")) {
    return "application/json";
  }
  if (lower.endsWith(".pdf")) {
    return "application/pdf";
  }
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  if (lower.endsWith(".webp")) {
    return "image/webp";
  }
  if (lower.endsWith(".svg")) {
    return "image/svg+xml";
  }
  if (lower.endsWith(".mp3")) {
    return "audio/mpeg";
  }
  if (lower.endsWith(".mp4")) {
    return "video/mp4";
  }
  if (lower.endsWith(".wasm")) {
    return "application/wasm";
  }
  if (lower.endsWith(".md") || lower.endsWith(".txt") || lower.endsWith(".xml")) {
    return "text/plain; charset=utf-8";
  }
  return "application/octet-stream";
};

export const writeFile = async (
  node: NodePO,
  filePath: string,
  content: Buffer,
  mimeType?: string,
) => {
  const path = normalizeFilePath(filePath);
  await storage.uploadFileToKey(
    content,
    `${resolveStoragePrefix(node)}${path}`,
    mimeType ?? mimeTypeForPath(path),
  );
};

export const writeTextFile = async (node: NodePO, filePath: string, content: string) => {
  const path = normalizeFilePath(filePath);
  await writeFile(node, path, Buffer.from(content, "utf8"), mimeTypeForPath(path));
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
