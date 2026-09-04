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
 * Every node in the current space that carries its OWN live public share —
 * one query for the whole space, NOT one `getNodeShare` per row, so a sidebar
 * tree of any size costs a single extra round trip.
 *
 * "Own" is the point: this deliberately reads `busabase_node_shares` rather
 * than the materialized `busabase_nodes.effective_public_scope`, which is the
 * INHERITED answer (a doc under a shared folder has a scope but nobody
 * published the doc). See `NodeVO.shared`.
 *
 * No permission assertion here, unlike `getNodeShare`: every caller feeds this
 * into an already ACL-filtered node listing and intersects by id, so a node the
 * actor cannot see never reaches them regardless of what this returns.
 */
export async function listOwnLiveShareNodeIds(): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db
    .select({
      nodeId: busabaseNodeShares.nodeId,
      scope: busabaseNodeShares.scope,
      expiresAt: busabaseNodeShares.expiresAt,
    })
    .from(busabaseNodeShares)
    .where(
      and(
        eq(busabaseNodeShares.spaceId, getContextSpaceId()),
        eq(busabaseNodeShares.scope, "public"),
      ),
    );
  // Expiry is enforced HERE rather than in SQL, through the same `isShareLive`
  // predicate every other read uses — an expired share must not show a marker
  // saying the node is published when the link no longer opens.
  return new Set(rows.filter(isShareLive).map((row) => row.nodeId));
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
      passwordHash: busabaseNodeShares.passwordHash,
    })
    .from(busabaseNodeShares)
    .where(eq(busabaseNodeShares.spaceId, spaceId));

  const parentOf = new Map(nodes.map((n) => [n.id, n.parentId]));
  const liveShareOf = new Map<string, { capability: NodeShareCapability; hasPassword: boolean }>();
  for (const share of shares) {
    if (isShareLive(share)) {
      liveShareOf.set(share.nodeId, {
        capability: share.capability,
        hasPassword: share.passwordHash != null,
      });
    }
  }

  /**
   * Nearest live share walking up from `nodeId`, or null.
   *
   * The password rides along with the capability rather than being resolved
   * separately, because both answers must come from the SAME share row: a
   * password on a farther ancestor must not lock a node that a nearer,
   * password-free share re-opened, which is the same "nearer wins" rule the
   * capability already follows.
   */
  const resolve = (
    nodeId: string,
  ): { capability: NodeShareCapability; hasPassword: boolean } | null => {
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

  // Bucketed by the (scope, requiresPassword) PAIR so each distinct outcome is
  // one UPDATE, the same way the scope-only version was.
  const byOutcome = new Map<string, { nodeIds: string[]; resolved: ReturnType<typeof resolve> }>();
  for (const nodeId of subtree) {
    const resolved = resolve(nodeId);
    const key = `${resolved?.capability ?? "none"}:${resolved?.hasPassword ? "pw" : "open"}`;
    const bucket = byOutcome.get(key) ?? { nodeIds: [], resolved };
    bucket.nodeIds.push(nodeId);
    byOutcome.set(key, bucket);
  }
  for (const { nodeIds, resolved } of byOutcome.values()) {
    if (nodeIds.length === 0) continue;
    await db
      .update(busabaseNodes)
      .set({
        effectivePublicScope: resolved?.capability ?? null,
        // A node that isn't public at all can't be password-locked; keeping the
        // flag false there means the ACL predicate never has to special-case it.
        effectivePublicRequiresPassword: resolved ? resolved.hasPassword : false,
      })
      .where(and(eq(busabaseNodes.spaceId, spaceId), inArray(busabaseNodes.id, nodeIds)));
  }
}

/** The little a public landing page needs to know about the node it renders. */
export interface PubliclySharedNode {
  id: string;
  slug: string;
  type: string;
  name: string;
  /**
   * The link is password-protected. Resolution deliberately still SUCCEEDS in
   * this case — a challenge page has to know the node exists in order to ask
   * for the password. Nothing is readable until `unlockPublicShare` succeeds
   * and the host puts the id on the request context: every actual data read
   * goes through `getPublicScopeOf` / `buildNodeVisibilityCondition`, both of
   * which treat a locked node as absent.
   */
  requiresPassword: boolean;
}

/**
 * Find a publicly shared node by its `{type}/{id-or-slug}` URL pair.
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
  nodeRef: string,
): Promise<PubliclySharedNode | null> {
  const db = await getDb();
  const columns = {
    id: busabaseNodes.id,
    slug: busabaseNodes.slug,
    type: busabaseNodes.type,
    name: busabaseNodes.name,
    requiresPassword: busabaseNodes.effectivePublicRequiresPassword,
  };
  const activePublicConditions = [
    eq(busabaseNodes.spaceId, getContextSpaceId()),
    eq(busabaseNodes.type, type),
    isNull(busabaseNodes.archivedAt),
    isNotNull(busabaseNodes.effectivePublicScope),
  ] as const;
  // A node id is itself a legal slug (both match `^[a-z0-9-]+$`), so one node's
  // slug can equal another SAME-TYPE node's id. Resolving that with a single
  // `or(id, slug)` + `limit(1)` picks a row non-deterministically, which would
  // let the page a visitor sees and the share whose password gates it be two
  // different nodes. Resolve by id first, then fall back to slug only when that
  // slug is unambiguous — identical to `unlockPublicShare` below, so both ends
  // of the public-share path always land on the same node.
  const [byId] = await db
    .select(columns)
    .from(busabaseNodes)
    .where(and(...activePublicConditions, eq(busabaseNodes.id, nodeRef)))
    .limit(1);
  const slugMatches = byId
    ? []
    : await db
        .select(columns)
        .from(busabaseNodes)
        .where(and(...activePublicConditions, eq(busabaseNodes.slug, nodeRef)))
        .limit(2);
  const row = byId ?? (slugMatches.length === 1 ? slugMatches[0] : null);
  return row
    ? {
        id: row.id,
        slug: row.slug,
        type: row.type,
        name: row.name ?? row.slug,
        requiresPassword: row.requiresPassword,
      }
    : null;
}

/**
 * The live share row that actually gates `nodeId` — its own, or the nearest one
 * up the ancestor chain. Mirrors `recomputeEffectivePublicScope`'s `resolve`,
 * but for a single node at request time, so the password check consults the very
 * same share that opened the node.
 *
 * Deliberately does NOT go through `getNodeShare`: that one asserts `read` on
 * the node, which an anonymous visitor standing in front of the password prompt
 * does not have — that is the whole point of the prompt.
 */
const resolveGatingShare = async (nodeId: string) => {
  const db = await getDb();
  const spaceId = getContextSpaceId();
  let cursor: string | null = nodeId;
  const guard = new Set<string>();
  while (cursor && !guard.has(cursor)) {
    guard.add(cursor);
    const [share] = await db
      .select()
      .from(busabaseNodeShares)
      .where(and(eq(busabaseNodeShares.nodeId, cursor), eq(busabaseNodeShares.spaceId, spaceId)))
      .limit(1);
    if (share && isShareLive(share)) return share;
    const [node]: { parentId: string | null }[] = await db
      .select({ parentId: busabaseNodes.parentId })
      .from(busabaseNodes)
      .where(and(eq(busabaseNodes.id, cursor), eq(busabaseNodes.spaceId, spaceId)))
      .limit(1);
    cursor = node?.parentId ?? null;
  }
  return null;
};

/**
 * Check a plaintext share password against the share gating a public node.
 *
 * Returns the node id on success — the host stores that (in a signed cookie, in
 * busabase-cloud's case) and replays it as `unlockedShareNodeIds` on subsequent
 * requests. Returns null for a wrong password, an unknown node, and a node that
 * isn't publicly shared at all, so a failed attempt can't be used to enumerate
 * which of those it was.
 *
 * A node with no password on its gating share unlocks trivially: callers may
 * treat "unlock succeeded" as the single condition to proceed, without
 * branching on whether a password was required.
 *
 * NOT rate-limited here. Throttling belongs at the host's HTTP edge, where the
 * client IP lives; this function has no notion of a caller identity to key on.
 */
export async function unlockPublicShare(
  nodeIdOrSlug: string,
  password: string,
  nodeType?: string,
): Promise<{ nodeId: string } | null> {
  const db = await getDb();
  const spaceId = getContextSpaceId();
  const activePublicConditions = [
    eq(busabaseNodes.spaceId, spaceId),
    isNull(busabaseNodes.archivedAt),
    isNull(busabaseNodes.deletedAt),
    isNotNull(busabaseNodes.effectivePublicScope),
  ] as const;
  const [byId] = await db
    .select({ id: busabaseNodes.id })
    .from(busabaseNodes)
    .where(
      and(
        ...activePublicConditions,
        eq(busabaseNodes.id, nodeIdOrSlug),
        ...(nodeType ? [eq(busabaseNodes.type, nodeType)] : []),
      ),
    )
    .limit(1);
  const slugMatches = byId
    ? []
    : await db
        .select({ id: busabaseNodes.id })
        .from(busabaseNodes)
        .where(
          and(
            ...activePublicConditions,
            eq(busabaseNodes.slug, nodeIdOrSlug),
            ...(nodeType ? [eq(busabaseNodes.type, nodeType)] : []),
          ),
        )
        .limit(2);
  const node = byId ?? (slugMatches.length === 1 ? slugMatches[0] : null);
  if (!node) return null;

  const share = await resolveGatingShare(node.id);
  if (!share) return null;
  if (!share.passwordHash) return { nodeId: node.id };
  return (await verifySharePassword(password, share.passwordHash)) ? { nodeId: node.id } : null;
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
