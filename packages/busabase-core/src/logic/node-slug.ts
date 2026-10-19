import "server-only";

import { ORPCError } from "@orpc/server";
import type { NodeType } from "busabase-contract/domains";
import { and, eq, isNull, like, ne, or } from "drizzle-orm";
import { getContextSpaceId } from "../context";
import type { getDb } from "../db";
import { busabaseBases, busabaseNodes, type NodePO } from "../db/schema";

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

/**
 * `identity.slug` if no active node of that type holds it, otherwise the first
 * free `slug-2`, `slug-3`, … — for restoring a node out of the Trash.
 *
 * An archived node frees its slug, so a new node can take it while the old one
 * sits in the Trash (delete "Tasks", create "Tasks" again). Restore used to fail
 * with "rename it first", but an archived node cannot be renamed, so the Trash
 * item could never come back. Restore now takes the next free slug instead; the
 * node that holds the slug keeps it.
 *
 * `reserved` holds slugs that are not active yet but will be once the same merge
 * finishes (the rest of a folder being restored together). A Base also checks the
 * `busabase_bases` row, whose slug index is separate from the node's.
 */
export const findAvailableNodeSlug = async (
  db: Database,
  identity: NodeSlugIdentity,
  reserved: ReadonlySet<string> = new Set(),
): Promise<string> => {
  const spaceId = getContextSpaceId();
  // One query for the slug and its numbered variants. `like` treats `_` as a
  // wildcard, which only widens the candidates; the exact check is the Set below.
  const nodeRows = await db
    .select({ slug: busabaseNodes.slug })
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.spaceId, spaceId),
        eq(busabaseNodes.type, identity.nodeType),
        or(eq(busabaseNodes.slug, identity.slug), like(busabaseNodes.slug, `${identity.slug}-%`)),
        isNull(busabaseNodes.archivedAt),
        ...(identity.excludeNodeId ? [ne(busabaseNodes.id, identity.excludeNodeId)] : []),
      ),
    );
  const baseRows =
    identity.nodeType === "base"
      ? await db
          .select({ slug: busabaseBases.slug })
          .from(busabaseBases)
          .where(
            and(
              eq(busabaseBases.spaceId, spaceId),
              or(
                eq(busabaseBases.slug, identity.slug),
                like(busabaseBases.slug, `${identity.slug}-%`),
              ),
              isNull(busabaseBases.archivedAt),
              ...(identity.excludeNodeId ? [ne(busabaseBases.nodeId, identity.excludeNodeId)] : []),
            ),
          )
      : [];
  const taken = new Set(reserved);
  for (const row of [...nodeRows, ...baseRows]) taken.add(row.slug);
  if (!taken.has(identity.slug)) return identity.slug;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${identity.slug}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
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
