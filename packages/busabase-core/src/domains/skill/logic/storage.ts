import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import { storage } from "openlib/storage";
import { getContextSpaceId } from "../../../context";
import { getDb } from "../../../db";
import { busabaseNodes, type NodePO } from "../../../db/schema";
import type { SkillFileVO } from "../../../types";

export const normalizeSkillFilePath = (filePath: string) => {
  const normalized = filePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (
    !normalized ||
    normalized.includes("\0") ||
    normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`Invalid skill file path: ${filePath}`);
  }
  return normalized;
};

export const skillStoragePrefix = (nodeId: string) => `busabase/nodes/${nodeId}/current/`;

export const resolveSkillStoragePrefix = (node: NodePO) => {
  if (node.type !== "skill") {
    throw new Error(`Node is not a Skill: ${node.id}`);
  }
  return node.metadata.storagePrefix || skillStoragePrefix(node.id);
};

export const getSkillNode = async (nodeIdOrSlug: string) => {
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
    byId && byId.type === "skill"
      ? [byId]
      : await db
          .select()
          .from(busabaseNodes)
          .where(
            and(
              eq(busabaseNodes.slug, nodeIdOrSlug),
              eq(busabaseNodes.spaceId, spaceId),
              eq(busabaseNodes.type, "skill"),
              isNull(busabaseNodes.archivedAt),
            ),
          )
          .limit(1);
  return node ?? null;
};

export const readSkillTextFile = async (node: NodePO, filePath: string) => {
  const path = normalizeSkillFilePath(filePath);
  return (await storage.getObject(`${resolveSkillStoragePrefix(node)}${path}`)).toString("utf8");
};

export const writeSkillTextFile = async (node: NodePO, filePath: string, content: string) => {
  const path = normalizeSkillFilePath(filePath);
  await storage.uploadFileToKey(
    Buffer.from(content, "utf8"),
    `${resolveSkillStoragePrefix(node)}${path}`,
    path.endsWith(".json") ? "application/json" : "text/plain; charset=utf-8",
  );
};

export const deleteSkillFile = async (node: NodePO, filePath: string) => {
  await storage.deleteObject(
    `${resolveSkillStoragePrefix(node)}${normalizeSkillFilePath(filePath)}`,
  );
};

export const listSkillStorageFiles = async (node: NodePO): Promise<SkillFileVO[]> => {
  const prefix = resolveSkillStoragePrefix(node);
  const result = await storage.listObjects(prefix, 1000);
  const folders = new Map<string, SkillFileVO>();
  const files = result.objects.map((object): SkillFileVO => {
    const relativePath = object.key.slice(prefix.length);
    const parts = relativePath.split("/");
    for (let index = 1; index < parts.length; index++) {
      const folderPath = parts.slice(0, index).join("/");
      if (!folders.has(folderPath)) {
        folders.set(folderPath, {
          path: folderPath,
          name: parts[index - 1],
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
