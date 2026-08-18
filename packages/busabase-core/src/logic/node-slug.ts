import "server-only";

import { ORPCError } from "@orpc/server";
import type { NodeType } from "busabase-contract/domains";
import { and, eq, isNull, ne } from "drizzle-orm";
import { getContextSpaceId } from "../context";
import type { getDb } from "../db";
import { busabaseNodes, type NodePO } from "../db/schema";

type Database = Awaited<ReturnType<typeof getDb>>;

export const NODE_SLUG_CONFLICT_REASON = "NODE_SLUG_CONFLICT";
export const NODE_SLUG_UNIQUE_INDEX = "busabase_nodes_space_type_slug_uniq";

interface NodeSlugIdentity {
  nodeType: NodeType;
  slug: string;
  excludeNodeId?: string;
}

export const findActiveNodeByTypeAndSlug = async (
  db: Database,
  identity: NodeSlugIdentity,
): Promise<NodePO | null> => {
  const [node] = await db
    .select()
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.spaceId, getContextSpaceId()),
        eq(busabaseNodes.type, identity.nodeType),
        eq(busabaseNodes.slug, identity.slug),
        isNull(busabaseNodes.archivedAt),
        ...(identity.excludeNodeId ? [ne(busabaseNodes.id, identity.excludeNodeId)] : []),
      ),
    )
    .limit(1);
  return node ?? null;
};

export const nodeSlugConflict = (nodeType: NodeType, slug: string) =>
  new ORPCError("CONFLICT", {
    message: `The ${nodeType} slug "${slug}" is already used in this workspace. Choose a different slug.`,
    data: {
      reason: NODE_SLUG_CONFLICT_REASON,
      nodeType,
      slug,
    },
  });

export const assertNodeSlugAvailable = async (
  db: Database,
  identity: NodeSlugIdentity,
): Promise<void> => {
  if (await findActiveNodeByTypeAndSlug(db, identity)) {
    throw nodeSlugConflict(identity.nodeType, identity.slug);
  }
};

const errorField = (error: unknown, field: "code" | "constraint"): unknown => {
  if (!error || typeof error !== "object") return undefined;
  const direct = (error as Record<string, unknown>)[field];
  if (direct !== undefined) return direct;
  const cause = (error as { cause?: unknown }).cause;
  return cause && typeof cause === "object" ? (cause as Record<string, unknown>)[field] : undefined;
};

export const isNodeSlugUniqueViolation = (error: unknown): boolean =>
  errorField(error, "code") === "23505" &&
  errorField(error, "constraint") === NODE_SLUG_UNIQUE_INDEX;

export const isNodeSlugConflictError = (error: unknown): boolean =>
  error instanceof ORPCError &&
  error.code === "CONFLICT" &&
  (error.data as { reason?: unknown } | undefined)?.reason === NODE_SLUG_CONFLICT_REASON;
