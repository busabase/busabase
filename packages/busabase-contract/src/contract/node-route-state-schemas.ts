import { z } from "zod";
import { NODE_TYPES } from "../domains/registry";

/**
 * Lightweight route guard for the dashboard. Archived variants intentionally
 * carry metadata only: resolving a tombstone must never hydrate node content.
 */
export const NodeRouteStateVOSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("active"),
    nodeId: z.string(),
  }),
  z.object({
    status: z.literal("archived"),
    nodeId: z.string(),
    type: z.enum(NODE_TYPES),
    name: z.string(),
    slug: z.string(),
    archivedAt: z.string(),
    canRestore: z.boolean(),
  }),
  z.object({
    status: z.literal("unavailable"),
  }),
]);

export type NodeRouteStateVO = z.infer<typeof NodeRouteStateVOSchema>;
