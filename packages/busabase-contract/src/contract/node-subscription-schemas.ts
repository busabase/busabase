import { z } from "zod";
import { NODE_TYPES } from "../domains/registry";

/**
 * The current actor's subscription to one node, as the node `[...]` menu shows it.
 *
 * - `subscribed` — a live row on THIS node (`source` says whether it was created
 *   automatically by creating/submitting/commenting/voting, or by a manual
 *   Subscribe).
 * - `inherited` — no row on this node, but the nearest ancestor with a row is
 *   subscribed; `via` names that folder.
 * - `muted` — the nearest row is THIS node's, and it is muted (the actor
 *   unsubscribed here). Auto triggers never undo this.
 * - `none` — no row on the node or any ancestor, or the nearest row is an
 *   ancestor's mute.
 */
export const NodeSubscriptionStateSchema = z.enum(["subscribed", "inherited", "muted", "none"]);

export const NodeSubscriptionViaSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(NODE_TYPES),
  slug: z.string(),
});

export const NodeSubscriptionVOSchema = z.object({
  nodeId: z.string(),
  state: NodeSubscriptionStateSchema,
  source: z.enum(["auto", "manual"]).nullable(),
  via: NodeSubscriptionViaSchema.nullable(),
});

export const GetNodeSubscriptionInputSchema = z.object({
  nodeId: z.string(),
});

export const SetNodeSubscriptionInputSchema = z.object({
  nodeId: z.string(),
  /**
   * `true` subscribes (manual, clears any mute on this node); `false` mutes this
   * node for the actor — even when the subscription is inherited from a folder,
   * in which case only this node is muted and the folder subscription stays.
   */
  subscribed: z.boolean(),
});

export type NodeSubscriptionState = z.infer<typeof NodeSubscriptionStateSchema>;
export type NodeSubscriptionVO = z.infer<typeof NodeSubscriptionVOSchema>;
export type GetNodeSubscriptionInput = z.infer<typeof GetNodeSubscriptionInputSchema>;
export type SetNodeSubscriptionInput = z.infer<typeof SetNodeSubscriptionInputSchema>;
