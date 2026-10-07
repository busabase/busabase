/**
 * Who hears about one event — the PURE half of node-subscription notifications.
 *
 * Everything here is deterministic over plain values (no db, no context), so the
 * policy that decides the recipient list can be unit-tested exhaustively and is
 * shared, unchanged, by every host that delivers notifications. The db half —
 * loading subscription rows, ancestor chains, participants — lives in
 * `node-subscriptions.ts`.
 *
 * Policy (the Busabase Cloud app's notification delivery policy spec):
 * - Subscriptions inherit down the CURRENT ancestor chain; the nearest row wins,
 *   so a muted row on a child overrides a folder subscription for that child.
 * - At most `NOTIFICATION_IMMEDIATE_RECIPIENT_CAP` people per event. When more
 *   are eligible: the pinned actors (the submitter, for outcome events) first,
 *   then the node creator, then everyone else by most recent interaction.
 * - The actor never hears about their own action; everyone appears once.
 */

/** Immediate recipients per event. The rest still see the work in Inbox / node history. */
export const NOTIFICATION_IMMEDIATE_RECIPIENT_CAP = 20;

export interface NodeSubscriptionRowLite {
  nodeId: string;
  actorId: string;
  mutedAt: Date | null;
  lastInteractedAt: Date;
}

export interface EffectiveNodeSubscriber {
  actorId: string;
  /** The node whose row subscribes them: the node itself, or the ancestor folder it inherits from. */
  viaNodeId: string;
  lastInteractedAt: Date;
}

/**
 * Collapse subscription rows on a node and its ancestors into the people who are
 * effectively subscribed to the node.
 *
 * `chainLeafFirst` is `[node, parent, grandparent, …]`. For each actor the row on
 * the NEAREST chain entry decides: unmuted → subscribed via that node; muted →
 * not subscribed (a nearer mute silences a farther subscription, and a nearer
 * subscription overrides a farther mute). Rows on nodes outside the chain are
 * ignored, which is what makes a moved node stop reaching its old folder.
 */
export const resolveEffectiveSubscribers = (
  chainLeafFirst: readonly string[],
  rows: readonly NodeSubscriptionRowLite[],
): EffectiveNodeSubscriber[] => {
  const depthOf = new Map<string, number>();
  chainLeafFirst.forEach((nodeId, depth) => {
    if (!depthOf.has(nodeId)) depthOf.set(nodeId, depth);
  });

  const nearest = new Map<string, { row: NodeSubscriptionRowLite; depth: number }>();
  for (const row of rows) {
    const depth = depthOf.get(row.nodeId);
    if (depth === undefined || !row.actorId) continue;
    const current = nearest.get(row.actorId);
    if (!current || depth < current.depth) nearest.set(row.actorId, { row, depth });
  }

  const subscribers: EffectiveNodeSubscriber[] = [];
  for (const { row } of nearest.values()) {
    if (row.mutedAt) continue;
    subscribers.push({
      actorId: row.actorId,
      viaNodeId: row.nodeId,
      lastInteractedAt: row.lastInteractedAt,
    });
  }
  return subscribers;
};

export interface NotificationCandidate {
  actorId: string;
  /** Drives ordering past the pinned/creator slots; null sorts last. */
  lastInteractedAt: Date | null;
}

export interface RankNotificationRecipientsInput {
  candidates: readonly NotificationCandidate[];
  /** Never notified (the actor who caused the event). */
  excludeActorIds?: readonly (string | null | undefined)[];
  /**
   * Always first and always included, in this order, even when absent from
   * `candidates` — the submitter of an approved/rejected Change Request.
   */
  pinnedActorIds?: readonly (string | null | undefined)[];
  /** Promoted right after the pinned actors, but ONLY if already a candidate. */
  creatorActorId?: string | null;
}

/**
 * Deduplicate, drop the excluded, and order candidates by the delivery policy:
 * pinned → creator → most recent interaction (ties broken by id, so the order is
 * stable). Returns every eligible id; capping is a separate step because the
 * host still filters by access before it can know which 20 to keep.
 */
export const rankNotificationRecipients = ({
  candidates,
  excludeActorIds = [],
  pinnedActorIds = [],
  creatorActorId,
}: RankNotificationRecipientsInput): string[] => {
  const excluded = new Set(excludeActorIds.filter((id): id is string => Boolean(id)));

  const latest = new Map<string, Date | null>();
  for (const candidate of candidates) {
    if (!candidate.actorId || excluded.has(candidate.actorId)) continue;
    const previous = latest.get(candidate.actorId);
    if (
      previous === undefined ||
      (candidate.lastInteractedAt &&
        (!previous || candidate.lastInteractedAt.getTime() > previous.getTime()))
    ) {
      latest.set(candidate.actorId, candidate.lastInteractedAt);
    }
  }

  const ordered: string[] = [];
  const placed = new Set<string>();
  const place = (actorId: string) => {
    if (placed.has(actorId) || excluded.has(actorId)) return;
    placed.add(actorId);
    ordered.push(actorId);
  };

  for (const actorId of pinnedActorIds) {
    if (actorId) place(actorId);
  }
  if (creatorActorId && latest.has(creatorActorId)) place(creatorActorId);

  const rest = [...latest.entries()]
    .filter(([actorId]) => !placed.has(actorId))
    .sort(([aId, aTime], [bId, bTime]) => {
      const a = aTime?.getTime() ?? Number.NEGATIVE_INFINITY;
      const b = bTime?.getTime() ?? Number.NEGATIVE_INFINITY;
      if (a !== b) return b - a;
      return aId < bId ? -1 : aId > bId ? 1 : 0;
    });
  for (const [actorId] of rest) place(actorId);
  return ordered;
};

/** `rankNotificationRecipients` + the immediate-delivery cap, for hosts with no extra filter. */
export const selectNotificationRecipients = (
  input: RankNotificationRecipientsInput,
  cap = NOTIFICATION_IMMEDIATE_RECIPIENT_CAP,
): string[] => rankNotificationRecipients(input).slice(0, Math.max(0, cap));
