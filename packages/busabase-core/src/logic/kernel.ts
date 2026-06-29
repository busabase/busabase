import { createHash } from "node:crypto";
import { LOCAL_SPACE_ID } from "../context";

export const CURRENT_USER_ID = "local-admin";
export const ROOT_NODE_ID = "nod_root";

/**
 * Per-space root node id. The local (open-source) tenant keeps the legacy fixed
 * id so its seed data and node references are unchanged; every cloud space gets
 * its own derived root so node trees never collide across spaces.
 */
export const rootNodeIdForSpace = (spaceId: string) =>
  spaceId === LOCAL_SPACE_ID ? ROOT_NODE_ID : `${ROOT_NODE_ID}_${spaceId}`;

export const now = () => new Date();

export const id = (prefix: string) =>
  `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 9)}`;

export const requireBaseId = (baseId: string | null, context: string) => {
  if (!baseId) {
    throw new Error(`${context} requires baseId`);
  }
  return baseId;
};

export const hashText = (content: string) =>
  `sha256:${createHash("sha256").update(content).digest("hex")}`;

import { z } from "zod";

export const listInputSchema = z
  .object({
    limit: z.number().int().min(1).max(100).optional().default(50),
  })
  .optional()
  .default({ limit: 50 });
