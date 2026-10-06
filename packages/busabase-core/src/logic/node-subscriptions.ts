import "server-only";

/**
 * Node subscriptions — the db half of "who hears about this node".
 *
 * Every read and write of `busabase_node_subscriptions` lives here, plus the
 * resolvers a host needs to turn a `BusabaseNotificationEvent` into candidate
 * recipients: a node's effective subscribers (ancestor walk), a Change
 * Request's participants, the node a Change Request belongs to, and an
 * other-actor read-access filter. The pure ordering/cap policy is in
 * `notification-recipients.ts`.
 *
 * Auto subscriptions are best-effort by construction: `touchAutoNodeSubscriptions`
 * never throws, because a subscription bookkeeping failure must never fail the
 * create/submit/comment/vote that triggered it.
 */

import type {
  NodeSubscriptionVO,
  SetNodeSubscriptionInput,
} from "busabase-contract/contract/node-subscription-schemas";
import type { NodeType } from "busabase-contract/domains";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import {
  ANONYMOUS_ACTOR_ID,
  type BusabaseDatabase,
  type BusabaseNotificationEvent,
  getContextNotificationEventHook,
  getContextSpaceId,
} from "../context";
import { getDb } from "../db";
import {
  busabaseChangeRequests,
  busabaseComments,
  busabaseCommits,
  busabaseNodePrincipals,
  busabaseNodeSubscriptions,
  busabaseNodes,
  busabaseOperations,
  busabaseReviews,
} from "../db/schema";
import { busabaseBases, busabaseRecords } from "../domains/base/schema";
import { MAX_ANCESTOR_DEPTH } from "./ancestor-chain";
import { id, now, rootNodeIdForSpace } from "./kernel";
import { assertNodeVisible } from "./node-acl";
import {
  type EffectiveNodeSubscriber,
  type NotificationCandidate,
  resolveEffectiveSubscribers,
} from "./notification-recipients";

/** Same reviewer id `cr-lifecycle.ts` stamps on machine approvals (kept literal to avoid an import cycle). */
const SYSTEM_ACTOR_PREFIX = "system:";

/**
 * Ids that are not a person who could ever read a notification: the anonymous
 * public-link visitor and system reviewers. Nobody is subscribed under them.
 */
export const isSubscribableActorId = (actorId: string | null | undefined): actorId is string =>
  Boolean(actorId?.trim()) &&
  actorId !== ANONYMOUS_ACTOR_ID &&
  !actorId?.startsWith(SYSTEM_ACTOR_PREFIX);

// ── Writes ────────────────────────────────────────────────────────────────────

/**
 * Auto-subscribe `actorId` to each of `nodeIds` (create / submit / comment /
 * vote). Upsert semantics: a new row is `source: "auto"`; an existing row only
 * has `last_interacted_at` bumped — `source` and, crucially, `muted_at` are
 * never touched, so an unsubscribe survives every later interaction.
 *
 * Best-effort: never throws. Nodes that vanished between the write and this
 * call fail the FK and are simply skipped.
 */
export const touchAutoNodeSubscriptions = async (
  nodeIds: readonly (string | null | undefined)[],
  actorId: string | null | undefined,
  inputDb?: BusabaseDatabase,
): Promise<void> => {
  if (!isSubscribableActorId(actorId)) return;
  const ids = [...new Set(nodeIds.filter((nodeId): nodeId is string => Boolean(nodeId)))];
  if (ids.length === 0) return;
  try {
    const db = inputDb ?? (await getDb());
    const spaceId = getContextSpaceId();
    const timestamp = now();
    // Only nodes that exist in THIS space: a stale or cross-space id must not
    // become a row (and must not abort the batch on an FK violation).
    const existing = await db
      .select({ id: busabaseNodes.id })
      .from(busabaseNodes)
      .where(and(inArray(busabaseNodes.id, ids), eq(busabaseNodes.spaceId, spaceId)));
    if (existing.length === 0) return;
    await db
      .insert(busabaseNodeSubscriptions)
      .values(
        existing.map((node) => ({
          id: id("nsb"),
          spaceId,
          nodeId: node.id,
          actorId,
          source: "auto" as const,
          mutedAt: null,
          lastInteractedAt: timestamp,
          createdAt: timestamp,
        })),
      )
      .onConflictDoUpdate({
        target: [busabaseNodeSubscriptions.nodeId, busabaseNodeSubscriptions.actorId],
        set: { lastInteractedAt: timestamp },
      });
  } catch {
    // Best-effort — subscription bookkeeping never fails the business write.
  }
};

/** Single-node convenience for `touchAutoNodeSubscriptions`. */
export const touchAutoNodeSubscription = (
  nodeId: string | null | undefined,
  actorId: string | null | undefined,
  inputDb?: BusabaseDatabase,
) => touchAutoNodeSubscriptions([nodeId], actorId, inputDb);

/**
 * The current actor's explicit choice from the node `[...]` menu.
 *
 * - Subscribe: upsert a `manual` row and clear any mute on this node.
 * - Unsubscribe: mute THIS node — updating its row, or creating a muted row when
 *   the subscription was inherited from a folder (or did not exist at all, so a
 *   later auto trigger still cannot sign them up). The folder's own row is left
 *   alone: siblings keep notifying.
 */
export const setNodeSubscription = async (
  input: SetNodeSubscriptionInput,
  actorId: string,
): Promise<NodeSubscriptionVO> => {
  const db = await getDb();
  await assertNodeVisible(input.nodeId, actorId);
  const spaceId = getContextSpaceId();
  const timestamp = now();
  if (isSubscribableActorId(actorId)) {
    await db
      .insert(busabaseNodeSubscriptions)
      .values({
        id: id("nsb"),
        spaceId,
        nodeId: input.nodeId,
        actorId,
        source: "manual",
        mutedAt: input.subscribed ? null : timestamp,
        lastInteractedAt: timestamp,
        createdAt: timestamp,
      })
      .onConflictDoUpdate({
        target: [busabaseNodeSubscriptions.nodeId, busabaseNodeSubscriptions.actorId],
        set: input.subscribed
          ? { source: "manual", mutedAt: null, lastInteractedAt: timestamp }
          : { mutedAt: timestamp },
      });
  }
  return getNodeSubscription(input.nodeId, actorId);
};

// ── Reads ─────────────────────────────────────────────────────────────────────

interface ChainNode {
  id: string;
  parentId: string | null;
  name: string;
  slug: string;
  type: NodeType;
  createdBy: string | null;
}

/**
 * `[node, parent, …, root]` — the CURRENT chain, leaf first, bounded and
 * cycle-safe. Empty when the node does not exist in this space.
 */
export const loadNodeChain = async (
  db: BusabaseDatabase,
  spaceId: string,
  nodeId: string,
): Promise<ChainNode[]> => {
  const chain: ChainNode[] = [];
  const visited = new Set<string>();
  let cursor: string | null = nodeId;
  while (cursor && !visited.has(cursor) && chain.length <= MAX_ANCESTOR_DEPTH) {
    visited.add(cursor);
    const [row] = await db
      .select({
        id: busabaseNodes.id,
        parentId: busabaseNodes.parentId,
        name: busabaseNodes.name,
        slug: busabaseNodes.slug,
        type: busabaseNodes.type,
        createdBy: busabaseNodes.createdBy,
      })
      .from(busabaseNodes)
      .where(and(eq(busabaseNodes.id, cursor), eq(busabaseNodes.spaceId, spaceId)))
      .limit(1);
    if (!row) break;
    chain.push(row as ChainNode);
    cursor = row.parentId;
  }
  return chain;
};

const loadSubscriptionRows = (
  db: BusabaseDatabase,
  spaceId: string,
  nodeIds: string[],
  actorId?: string,
) =>
  db
    .select({
      nodeId: busabaseNodeSubscriptions.nodeId,
      actorId: busabaseNodeSubscriptions.actorId,
      source: busabaseNodeSubscriptions.source,
      mutedAt: busabaseNodeSubscriptions.mutedAt,
      lastInteractedAt: busabaseNodeSubscriptions.lastInteractedAt,
    })
    .from(busabaseNodeSubscriptions)
    .where(
      and(
        eq(busabaseNodeSubscriptions.spaceId, spaceId),
        inArray(busabaseNodeSubscriptions.nodeId, nodeIds),
        actorId ? eq(busabaseNodeSubscriptions.actorId, actorId) : undefined,
      ),
    );

/** The current actor's state on one node, as the `[...]` menu renders it. */
export const getNodeSubscription = async (
  nodeId: string,
  actorId: string,
): Promise<NodeSubscriptionVO> => {
  const db = await getDb();
  await assertNodeVisible(nodeId, actorId);
  const spaceId = getContextSpaceId();
  const chain = await loadNodeChain(db, spaceId, nodeId);
  const none: NodeSubscriptionVO = { nodeId, state: "none", source: null, via: null };
  if (chain.length === 0 || !isSubscribableActorId(actorId)) return none;

  const rows = await loadSubscriptionRows(
    db,
    spaceId,
    chain.map((node) => node.id),
    actorId,
  );
  const byNode = new Map(rows.map((row) => [row.nodeId, row]));
  for (const node of chain) {
    const row = byNode.get(node.id);
    if (!row) continue;
    if (node.id === nodeId) {
      return row.mutedAt
        ? { nodeId, state: "muted", source: row.source, via: null }
        : { nodeId, state: "subscribed", source: row.source, via: null };
    }
    // The nearest row is an ancestor's: a live one is inherited, a muted one
    // means this node is simply not subscribed.
    if (row.mutedAt) return none;
    return {
      nodeId,
      state: "inherited",
      source: row.source,
      via: { id: node.id, name: node.name, type: node.type, slug: node.slug },
    };
  }
  return none;
};

export interface NodeNotificationTarget {
  id: string;
  name: string;
  slug: string;
  type: NodeType;
  /** `busabase_nodes.created_by` — nullable for backfilled rows. */
  createdBy: string | null;
}

export interface ResolvedNodeSubscribers {
  /** Null when the node no longer exists in the space. */
  node: NodeNotificationTarget | null;
  /** `[node, parent, …, root]`, for naming the folder a subscriber inherits from. */
  chain: NodeNotificationTarget[];
  subscribers: EffectiveNodeSubscriber[];
}

/**
 * Everyone effectively subscribed to `nodeId`: rows on the node and its current
 * ancestors, nearest row wins, mutes excluded (see `resolveEffectiveSubscribers`).
 */
export const resolveNodeSubscribers = async (
  db: BusabaseDatabase,
  spaceId: string,
  nodeId: string,
): Promise<ResolvedNodeSubscribers> => {
  const chain = await loadNodeChain(db, spaceId, nodeId);
  if (chain.length === 0) return { node: null, chain: [], subscribers: [] };
  const chainIds = chain.map((node) => node.id);
  const rows = await loadSubscriptionRows(db, spaceId, chainIds);
  const targets = chain.map(({ parentId: _parentId, ...node }) => node);
  return {
    node: targets[0] ?? null,
    chain: targets,
    subscribers: resolveEffectiveSubscribers(chainIds, rows),
  };
};

export interface ChangeRequestParticipant extends NotificationCandidate {
  lastInteractedAt: Date;
  roles: Array<"submitter" | "commenter" | "reviewer">;
}

/**
 * The people who took part in a Change Request — submitter, commenters, human
 * voters — each with their latest interaction time. Derived at send time; there
 * is no per-Change-Request follow table.
 */
export const resolveChangeRequestParticipants = async (
  db: BusabaseDatabase,
  spaceId: string,
  changeRequestId: string,
): Promise<ChangeRequestParticipant[]> => {
  const [changeRequest] = await db
    .select({
      submittedBy: busabaseChangeRequests.submittedBy,
      createdAt: busabaseChangeRequests.createdAt,
    })
    .from(busabaseChangeRequests)
    .where(
      and(
        eq(busabaseChangeRequests.id, changeRequestId),
        eq(busabaseChangeRequests.spaceId, spaceId),
      ),
    )
    .limit(1);
  if (!changeRequest) return [];

  const [comments, reviews] = await Promise.all([
    db
      .select({ actorId: busabaseComments.authorId, at: busabaseComments.createdAt })
      .from(busabaseComments)
      .where(
        and(
          eq(busabaseComments.changeRequestId, changeRequestId),
          eq(busabaseComments.spaceId, spaceId),
        ),
      ),
    db
      .select({ actorId: busabaseReviews.reviewerId, at: busabaseReviews.createdAt })
      .from(busabaseReviews)
      .where(eq(busabaseReviews.changeRequestId, changeRequestId)),
  ]);

  const byActor = new Map<string, ChangeRequestParticipant>();
  const add = (actorId: string, at: Date, role: ChangeRequestParticipant["roles"][number]) => {
    if (!isSubscribableActorId(actorId)) return;
    const current = byActor.get(actorId);
    if (!current) {
      byActor.set(actorId, { actorId, lastInteractedAt: at, roles: [role] });
      return;
    }
    if (!current.roles.includes(role)) current.roles.push(role);
    if (at.getTime() > current.lastInteractedAt.getTime()) current.lastInteractedAt = at;
  };
  add(changeRequest.submittedBy, changeRequest.createdAt, "submitter");
  for (const comment of comments) add(comment.actorId, comment.at, "commenter");
  for (const review of reviews) add(review.actorId, review.at, "reviewer");
  return [...byActor.values()];
};

export interface ChangeRequestNotificationTarget {
  id: string;
  status: string;
  submittedBy: string;
  baseId: string | null;
  /**
   * The node the Change Request belongs to: `nodeId ?? base.nodeId ?? the
   * first operation's node`. For a still-pending node_create the node does not
   * exist yet, so this is the PARENT it would be created under and `scope` is
   * `"parent"` — good for "who should hear about this", never for
   * auto-subscribing the submitter (that would subscribe them to the whole
   * folder for proposing one child).
   */
  nodeId: string | null;
  scope: "node" | "parent" | null;
}

export const resolveChangeRequestTarget = async (
  db: BusabaseDatabase,
  spaceId: string,
  changeRequestId: string,
): Promise<ChangeRequestNotificationTarget | null> => {
  const [changeRequest] = await db
    .select({
      id: busabaseChangeRequests.id,
      status: busabaseChangeRequests.status,
      submittedBy: busabaseChangeRequests.submittedBy,
      baseId: busabaseChangeRequests.baseId,
      nodeId: busabaseChangeRequests.nodeId,
    })
    .from(busabaseChangeRequests)
    .where(
      and(
        eq(busabaseChangeRequests.id, changeRequestId),
        eq(busabaseChangeRequests.spaceId, spaceId),
      ),
    )
    .limit(1);
  if (!changeRequest) return null;
  const target = { ...changeRequest, status: String(changeRequest.status) };

  if (changeRequest.nodeId) return { ...target, nodeId: changeRequest.nodeId, scope: "node" };
  if (changeRequest.baseId) {
    const [base] = await db
      .select({ nodeId: busabaseBases.nodeId })
      .from(busabaseBases)
      .where(and(eq(busabaseBases.id, changeRequest.baseId), eq(busabaseBases.spaceId, spaceId)))
      .limit(1);
    if (base?.nodeId) return { ...target, nodeId: base.nodeId, scope: "node" };
  }

  const operations = await db
    .select({
      nodeId: busabaseOperations.nodeId,
      baseId: busabaseOperations.baseId,
      headCommitId: busabaseOperations.headCommitId,
    })
    .from(busabaseOperations)
    .where(eq(busabaseOperations.changeRequestId, changeRequestId))
    .orderBy(asc(busabaseOperations.position), asc(busabaseOperations.createdAt));
  const withNode = operations.find((operation) => operation.nodeId);
  if (withNode?.nodeId) return { ...target, nodeId: withNode.nodeId, scope: "node" };

  const first = operations[0];
  if (first) {
    const [commit] = await db
      .select({ payload: busabaseCommits.payload })
      .from(busabaseCommits)
      .where(eq(busabaseCommits.id, first.headCommitId))
      .limit(1);
    const parentNodeId = commit?.payload?.parentNodeId;
    if (typeof parentNodeId === "string" && parentNodeId) {
      return { ...target, nodeId: parentNodeId, scope: "parent" };
    }
    // A create with no explicit parent lands under the workspace root.
    return { ...target, nodeId: rootNodeIdForSpace(spaceId), scope: "parent" };
  }
  return { ...target, nodeId: null, scope: null };
};

/**
 * The node a comment belongs to, for auto-subscribing its author: the Change
 * Request's node (only when it really is that node, not a pending create's
 * parent), else the commented record's Base node.
 */
export const resolveCommentNodeId = async (
  db: BusabaseDatabase,
  spaceId: string,
  links: { changeRequestId: string | null; recordId: string | null; commitId: string | null },
): Promise<string | null> => {
  if (links.changeRequestId) {
    const target = await resolveChangeRequestTarget(db, spaceId, links.changeRequestId);
    return target?.scope === "node" ? target.nodeId : null;
  }
  if (links.recordId) {
    const [row] = await db
      .select({ nodeId: busabaseBases.nodeId })
      .from(busabaseRecords)
      .innerJoin(busabaseBases, eq(busabaseBases.id, busabaseRecords.baseId))
      .where(and(eq(busabaseRecords.id, links.recordId), eq(busabaseRecords.spaceId, spaceId)))
      .limit(1);
    return row?.nodeId ?? null;
  }
  if (links.commitId) {
    const [commit] = await db
      .select({ nodeId: busabaseCommits.nodeId, baseId: busabaseCommits.baseId })
      .from(busabaseCommits)
      .where(and(eq(busabaseCommits.id, links.commitId), eq(busabaseCommits.spaceId, spaceId)))
      .limit(1);
    if (commit?.nodeId) return commit.nodeId;
    if (commit?.baseId) {
      const [base] = await db
        .select({ nodeId: busabaseBases.nodeId })
        .from(busabaseBases)
        .where(eq(busabaseBases.id, commit.baseId))
        .limit(1);
      return base?.nodeId ?? null;
    }
  }
  return null;
};

/**
 * Which of `actorIds` can currently open `nodeId` — the other-actor sibling of
 * `getEffectiveNodeLevel`, which can only answer for the CURRENT context actor.
 *
 * Same rules, evaluated per candidate:
 * - `managerIds` (space owners/admins, resolved by the host) always pass;
 * - everyone passes a default-visible node (open mode: not `private`;
 *   restricted mode: explicitly `workspace`/`public`; the root always);
 * - otherwise a direct/inherited `user` grant, or any `space` grant, passes.
 * A node missing from the space passes no one.
 */
export const filterActorsWithNodeReadAccess = async (
  db: BusabaseDatabase,
  args: {
    spaceId: string;
    nodeId: string;
    actorIds: readonly string[];
    managerIds: ReadonlySet<string>;
    restrictedVisibility: boolean;
  },
): Promise<Set<string>> => {
  const allowed = new Set<string>();
  if (args.actorIds.length === 0) return allowed;
  const [node] = await db
    .select({ effectiveVisibility: busabaseNodes.effectiveVisibility })
    .from(busabaseNodes)
    .where(and(eq(busabaseNodes.id, args.nodeId), eq(busabaseNodes.spaceId, args.spaceId)))
    .limit(1);
  if (!node) return allowed;

  const visibility = node.effectiveVisibility;
  const defaultVisible =
    args.nodeId === rootNodeIdForSpace(args.spaceId) ||
    (args.restrictedVisibility
      ? visibility === "workspace" || visibility === "public"
      : visibility !== "private");
  if (defaultVisible) {
    for (const actorId of args.actorIds) allowed.add(actorId);
    return allowed;
  }

  const others: string[] = [];
  for (const actorId of args.actorIds) {
    if (args.managerIds.has(actorId)) allowed.add(actorId);
    else others.push(actorId);
  }
  if (others.length === 0) return allowed;

  const grants = await db
    .select({
      principalType: busabaseNodePrincipals.principalType,
      principalId: busabaseNodePrincipals.principalId,
    })
    .from(busabaseNodePrincipals)
    .where(
      and(
        eq(busabaseNodePrincipals.nodeId, args.nodeId),
        or(
          and(
            eq(busabaseNodePrincipals.principalType, "user"),
            inArray(busabaseNodePrincipals.principalId, others),
          ),
          eq(busabaseNodePrincipals.principalType, "space"),
        ),
      ),
    );
  if (grants.some((grant) => grant.principalType === "space")) {
    for (const actorId of others) allowed.add(actorId);
    return allowed;
  }
  for (const grant of grants) allowed.add(grant.principalId);
  return allowed;
};

// ── Event dispatch ────────────────────────────────────────────────────────────

/**
 * Hand one event to the host's `onNotificationEvent`, if any. Call AFTER the
 * write committed. Never throws: a notification failure must never fail (or
 * roll back) the business action that caused it.
 */
export const emitNotificationEvent = async (event: BusabaseNotificationEvent): Promise<void> => {
  const hook = getContextNotificationEventHook();
  if (!hook) return;
  try {
    await hook(event);
  } catch {
    // Best-effort — notification delivery never fails the write.
  }
};

// ── Choke-point announcers ────────────────────────────────────────────────────
//
// One function per kind of business event, called from the write path AFTER it
// committed. Each does the auto-subscribe bookkeeping (always — open source
// keeps subscriptions too) and then hands the event to the host. All are
// best-effort and never throw.

const swallow = async (fn: () => Promise<void>) => {
  try {
    await fn();
  } catch {
    // Best-effort — see the section comment above.
  }
};

/** A Change Request just entered human review (never for one that auto-merges). */
export const announceChangeRequestPendingReview = (args: {
  changeRequestId: string;
  baseId: string | null;
  submittedBy: string;
}): Promise<void> =>
  swallow(async () => {
    const db = await getDb();
    const spaceId = getContextSpaceId();
    const target = await resolveChangeRequestTarget(db, spaceId, args.changeRequestId);
    if (target?.scope === "node")
      await touchAutoNodeSubscription(target.nodeId, args.submittedBy, db);
    await emitNotificationEvent({
      kind: "change_request.pending_review",
      spaceId,
      changeRequestId: args.changeRequestId,
      nodeId: target?.nodeId ?? null,
      baseId: args.baseId,
      actorId: args.submittedBy,
    });
  });

/**
 * A comment was created. Subscribes the author to the comment's node; a comment
 * on a Change Request (or one of its operations) also notifies its participants.
 */
export const announceCommentCreated = (args: {
  commentId: string;
  authorId: string;
  changeRequestId: string | null;
  recordId: string | null;
  commitId: string | null;
}): Promise<void> =>
  swallow(async () => {
    const db = await getDb();
    const spaceId = getContextSpaceId();
    const nodeId = await resolveCommentNodeId(db, spaceId, args);
    await touchAutoNodeSubscription(nodeId, args.authorId, db);
    if (!args.changeRequestId) return;
    await emitNotificationEvent({
      kind: "change_request.commented",
      spaceId,
      changeRequestId: args.changeRequestId,
      commentId: args.commentId,
      actorId: args.authorId,
    });
  });

/** A human vote (approve / request changes) — never the automatic self-approval of a direct write. */
export const announceChangeRequestReviewed = (args: {
  changeRequestId: string;
  reviewerId: string;
  verdict: "approved" | "rejected";
}): Promise<void> =>
  swallow(async () => {
    const db = await getDb();
    const spaceId = getContextSpaceId();
    const target = await resolveChangeRequestTarget(db, spaceId, args.changeRequestId);
    if (target?.scope === "node")
      await touchAutoNodeSubscription(target.nodeId, args.reviewerId, db);
    await emitNotificationEvent({
      kind: "change_request.reviewed",
      spaceId,
      changeRequestId: args.changeRequestId,
      verdict: args.verdict,
      actorId: args.reviewerId,
    });
  });

/** An operation of a Change Request was revised (re-submitted for review). */
export const announceChangeRequestRevised = (args: {
  changeRequestId: string;
  actorId: string;
}): Promise<void> =>
  swallow(async () => {
    const db = await getDb();
    const spaceId = getContextSpaceId();
    const target = await resolveChangeRequestTarget(db, spaceId, args.changeRequestId);
    if (target?.scope === "node") await touchAutoNodeSubscription(target.nodeId, args.actorId, db);
    await emitNotificationEvent({
      kind: "change_request.revised",
      spaceId,
      changeRequestId: args.changeRequestId,
      actorId: args.actorId,
    });
  });

/** A Change Request was closed without merging. */
export const announceChangeRequestRejected = (args: {
  changeRequestId: string;
  submittedBy: string;
  actorId: string;
}): Promise<void> =>
  swallow(async () => {
    await emitNotificationEvent({
      kind: "change_request.resolved",
      spaceId: getContextSpaceId(),
      changeRequestId: args.changeRequestId,
      status: "rejected",
      submittedBy: args.submittedBy,
      wasHumanReviewed: true,
      actorId: args.actorId,
    });
  });

/**
 * A Change Request just merged — through review, or automatically (a
 * write-access edit, `autoMerge`, a structural auto-merge, or a direct write
 * recorded as a merged CR via `recordMergedOperation`).
 *
 * This is where node CREATION subscribes the creator: every node-create path
 * ends in a merged CR whose `mergedNodeIds` carries the new node, so the
 * submitter is subscribed to the CR's node plus every node it merged.
 *
 * Emits `change_request.resolved` for every merge, and additionally
 * `node.changed` for an automatic one — a direct change never sat in anyone's
 * Inbox, so its node's subscribers are the audience.
 */
export const announceChangeRequestMerged = (args: {
  changeRequestId: string;
  submittedBy: string;
  mergedNodeIds: readonly string[];
  automatic: boolean;
  actorId: string;
}): Promise<void> =>
  swallow(async () => {
    const db = await getDb();
    const spaceId = getContextSpaceId();
    const target = await resolveChangeRequestTarget(db, spaceId, args.changeRequestId);
    const primaryNodeId =
      (target?.scope === "node" ? target.nodeId : null) ?? args.mergedNodeIds[0] ?? null;
    await touchAutoNodeSubscriptions([primaryNodeId, ...args.mergedNodeIds], args.submittedBy, db);
    await emitNotificationEvent({
      kind: "change_request.resolved",
      spaceId,
      changeRequestId: args.changeRequestId,
      status: "merged",
      submittedBy: args.submittedBy,
      wasHumanReviewed: !args.automatic,
      actorId: args.actorId,
    });
    if (args.automatic && primaryNodeId) {
      await emitNotificationEvent({
        kind: "node.changed",
        spaceId,
        nodeId: primaryNodeId,
        changeRequestId: args.changeRequestId,
        actorId: args.submittedBy,
      });
    }
  });
