import "server-only";

import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { ORPCError } from "@orpc/server";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { getContextSpaceId, resolveActorId } from "../context";
import { getDb } from "../db";
import { busabaseNodeShares, busabaseNodes } from "../db/schema";
import { id, now } from "./kernel";
import { assertNodePermission } from "./node-acl";

/**
 * Public link sharing (see `busabase_node_shares`). The second, orthogonal axis
 * next to node principals: this decides whether an ANONYMOUS visitor may reach
 * a node over its own canonical URL, and what they may do there.
 *
 * Everything here writes `busabase_nodes.effective_public_scope`, which is what
 * the read gates in node-acl.ts actually consult — the tree is walked on write,
 * never on read.
 */

export type NodeShareScope = "none" | "public";
export type NodeShareCapability = "read" | "submit";

const scryptAsync = promisify(scrypt);

/** scrypt with a per-password salt; stored as `salt:hash`. */
export async function hashSharePassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

export async function verifySharePassword(password: string, stored: string): Promise<boolean> {
  const [salt, expectedHex] = stored.split(":");
  if (!salt || !expectedHex) {
    return false;
  }
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  const expected = Buffer.from(expectedHex, "hex");
  // Length check first: timingSafeEqual throws on a length mismatch.
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

/** A share is live only while enabled AND unexpired — expiry is enforced here, server-side. */
export const isShareLive = (share: { scope: NodeShareScope; expiresAt: Date | null }): boolean => {
  if (share.scope !== "public") {
    return false;
  }
  return !share.expiresAt || share.expiresAt.getTime() > Date.now();
};

/**
 * Read a node's share row (space-scoped), or null when it was never shared.
 *
 * Requires `read` on the node. Without this gate any space member — including
 * one who cannot see the node at all — could probe an arbitrary node id and
 * learn whether it is published, whether it is password-protected, and when it
 * expires. `manage` (what `setNodeShare` demands) subsumes `read`, so the
 * internal calls below are unaffected.
 */
export async function getNodeShare(nodeId: string) {
  await assertNodePermission(nodeId, "read");
  const db = await getDb();
  const [row] = await db
    .select()
    .from(busabaseNodeShares)
    .where(
      and(
        eq(busabaseNodeShares.nodeId, nodeId),
        eq(busabaseNodeShares.spaceId, getContextSpaceId()),
      ),
    )
    .limit(1);
  return row ?? null;
}

/**
 * Recompute `effective_public_scope` for `rootNodeId` and every descendant.
 *
 * Mirrors `recomputeEffectiveVisibility`'s write-time philosophy: resolve the
 * nearest LIVE share on the ancestor chain (self wins over parent) and
 * materialize the answer onto each node, so read paths stay single-column.
 * Unlike visibility there is no "strictest wins" lattice here — a nearer share
 * simply overrides a farther one, and a revoked/expired share contributes
 * nothing (so revoking a folder closes its subtree unless a child re-opens it).
 */
export async function recomputeEffectivePublicScope(rootNodeId: string): Promise<void> {
  const db = await getDb();
  const spaceId = getContextSpaceId();

  const nodes = await db
    .select({ id: busabaseNodes.id, parentId: busabaseNodes.parentId })
    .from(busabaseNodes)
    .where(eq(busabaseNodes.spaceId, spaceId));
  const shares = await db
    .select({
      nodeId: busabaseNodeShares.nodeId,
      scope: busabaseNodeShares.scope,
      capability: busabaseNodeShares.capability,
      expiresAt: busabaseNodeShares.expiresAt,
    })
    .from(busabaseNodeShares)
    .where(eq(busabaseNodeShares.spaceId, spaceId));

  const parentOf = new Map(nodes.map((n) => [n.id, n.parentId]));
  const liveShareOf = new Map<string, NodeShareCapability>();
  for (const share of shares) {
    if (isShareLive(share)) {
      liveShareOf.set(share.nodeId, share.capability);
    }
  }

  /** Nearest live share walking up from `nodeId`, or null. */
  const resolve = (nodeId: string): NodeShareCapability | null => {
    let cursor: string | null = nodeId;
    const guard = new Set<string>();
    while (cursor && !guard.has(cursor)) {
      guard.add(cursor);
      const own = liveShareOf.get(cursor);
      if (own) {
        return own;
      }
      cursor = parentOf.get(cursor) ?? null;
    }
    return null;
  };

  // Only the changed subtree needs rewriting.
  const childrenOf = new Map<string, string[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const siblings = childrenOf.get(node.parentId) ?? [];
    siblings.push(node.id);
    childrenOf.set(node.parentId, siblings);
  }
  const subtree: string[] = [];
  const stack = [rootNodeId];
  while (stack.length > 0) {
    const nodeId = stack.pop();
    if (!nodeId) continue;
    subtree.push(nodeId);
    stack.push(...(childrenOf.get(nodeId) ?? []));
  }

  const byScope = new Map<NodeShareCapability | null, string[]>();
  for (const nodeId of subtree) {
    const scope = resolve(nodeId);
    const bucket = byScope.get(scope) ?? [];
    bucket.push(nodeId);
    byScope.set(scope, bucket);
  }
  for (const [scope, nodeIds] of byScope) {
    if (nodeIds.length === 0) continue;
    await db
      .update(busabaseNodes)
      .set({ effectivePublicScope: scope })
      .where(and(eq(busabaseNodes.spaceId, spaceId), inArray(busabaseNodes.id, nodeIds)));
  }
}

/** The little a public landing page needs to know about the node it renders. */
export interface PubliclySharedNode {
  id: string;
  slug: string;
  type: string;
  name: string;
}

/**
 * Find a publicly shared node by its `{type}/{slug}` URL pair.
 *
 * Why this exists instead of walking `listNodes()`: the node tree is assembled
 * top-down and `buildNodeTree` only keeps rows whose WHOLE ancestor chain came
 * back — a deliberate property, since a hidden folder should hide its subtree.
 * But public sharing is per-node and explicitly does NOT require sharing the
 * ancestors: you share one base, not the workspace root that contains it. Those
 * two rules collide, and the tree wins: a shared child of an unshared parent is
 * dropped, so an anonymous visitor resolving a link through the tree would find
 * nothing unless the space root itself were public — which would expose
 * everything. Resolving the target node directly is what makes a per-node share
 * actually reachable at its own URL.
 *
 * This is NOT a weaker check. `effective_public_scope` is the very column the
 * anonymous branch of `buildNodeVisibilityCondition` tests; the authority is
 * identical, only the ancestor coupling is gone.
 */
export async function findPubliclySharedNode(
  type: string,
  slug: string,
): Promise<PubliclySharedNode | null> {
  const db = await getDb();
  const [row] = await db
    .select({
      id: busabaseNodes.id,
      slug: busabaseNodes.slug,
      type: busabaseNodes.type,
      name: busabaseNodes.name,
    })
    .from(busabaseNodes)
    .where(
      and(
        eq(busabaseNodes.spaceId, getContextSpaceId()),
        eq(busabaseNodes.type, type),
        eq(busabaseNodes.slug, slug),
        isNull(busabaseNodes.archivedAt),
        isNotNull(busabaseNodes.effectivePublicScope),
      ),
    )
    .limit(1);
  return row ? { id: row.id, slug: row.slug, type: row.type, name: row.name ?? row.slug } : null;
}

/**
 * Turn public sharing on (or update its settings). Requires `manage` on the
 * node — deciding who may expose a node to the internet is itself a
 * privileged act (Feishu gates link sharing behind its "can manage" role).
 */
export async function setNodeShare(
  nodeId: string,
  input: {
    scope: NodeShareScope;
    capability?: NodeShareCapability;
    /** Plaintext; hashed here. `null` clears it. Only allowed while scope="public". */
    password?: string | null;
    expiresAt?: Date | null;
  },
) {
  await assertNodePermission(nodeId, "manage");
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const actorId = resolveActorId("local-user");
  const timestamp = now();

  if (input.password && input.scope !== "public") {
    // A password only means anything on the public tier (Feishu offers it only
    // for the internet scope) — accepting one otherwise would imply protection
    // that nothing enforces.
    throw new ORPCError("BAD_REQUEST", {
      message: "A share password can only be set while the node is publicly shared.",
    });
  }

  const existing = await getNodeShare(nodeId);
  const passwordHash =
    input.password === undefined
      ? (existing?.passwordHash ?? null)
      : input.password === null
        ? null
        : await hashSharePassword(input.password);

  if (existing) {
    await db
      .update(busabaseNodeShares)
      .set({
        scope: input.scope,
        capability: input.capability ?? existing.capability,
        passwordHash,
        expiresAt: input.expiresAt === undefined ? existing.expiresAt : input.expiresAt,
        updatedBy: actorId,
        updatedAt: timestamp,
      })
      .where(eq(busabaseNodeShares.id, existing.id));
  } else {
    await db.insert(busabaseNodeShares).values({
      id: id("shr"),
      spaceId,
      nodeId,
      scope: input.scope,
      capability: input.capability ?? "read",
      passwordHash,
      expiresAt: input.expiresAt ?? null,
      createdBy: actorId,
      updatedBy: actorId,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  await recomputeEffectivePublicScope(nodeId);
  return getNodeShare(nodeId);
}

/**
 * Revoke public access. Flips `scope` to "none" IN PLACE — the row and its id
 * are kept so re-enabling later produces the very same link (the URL never
 * contained a secret, so there is nothing to rotate).
 */
export async function disableNodeShare(nodeId: string) {
  return setNodeShare(nodeId, { scope: "none" });
}
