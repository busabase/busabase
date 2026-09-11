import { eventIterator, oc } from "@orpc/contract";
import { z } from "zod";
import {
  AgentCatalogEntryVOSchema,
  AgentConnectionVOSchema,
  AgentSessionEventVOSchema,
  AgentSessionIdInputSchema,
  AgentSessionStatusSchema,
  AgentSessionVOSchema,
  CreateAgentSessionInputSchema,
  DisconnectAgentInputSchema,
  ListAgentConnectionsInputSchema,
  PromptAgentSessionInputSchema,
  RespondToAgentPermissionInputSchema,
  SetAgentSessionConfigOptionInputSchema,
} from "./types";

/**
 * Agents contract — Busabase acting as an ACP *client*, driving external agents.
 *
 * Every procedure here is RPC-only (no `.route(...)`): these drive processes and
 * long-lived sockets, which is not something to publish as a REST/MCP tool
 * surface. It also keeps `subscribe`'s Event Iterator out of OpenAPI generation,
 * matching how `live.subscribe` is declared.
 */
export const agentsContract = {
  /** Connectable backends. Availability is resolved per request, not cached in the client. */
  catalog: oc.output(AgentCatalogEntryVOSchema.array()),

  disconnect: oc.input(DisconnectAgentInputSchema).output(
    z.object({
      ok: z.boolean(),
      deletedSessionCount: z.number().int().nonnegative(),
    }),
  ),

  connections: {
    /** Connected backends in the current user's personal or active-space scope. */
    list: oc.input(ListAgentConnectionsInputSchema).output(AgentConnectionVOSchema.array()),
  },

  sessions: {
    list: oc.output(AgentSessionVOSchema.array()),

    create: oc.input(CreateAgentSessionInputSchema).output(AgentSessionVOSchema),

    /**
     * Send a message. A terminal session returns `accepted: false` instead of
     * relying on error text; `promptRecorded` tells the caller whether automatic
     * continuation can resend without duplicating a server echo.
     */
    prompt: oc.input(PromptAgentSessionInputSchema).output(
      z.discriminatedUnion("accepted", [
        z.object({ accepted: z.literal(true), sessionId: z.string() }),
        z.object({
          accepted: z.literal(false),
          sessionId: z.string(),
          status: AgentSessionStatusSchema.extract(["ended", "failed"]),
          promptRecorded: z.boolean(),
          message: z.string(),
        }),
      ]),
    ),

    cancel: oc.input(AgentSessionIdInputSchema).output(z.object({ ok: z.boolean() })),

    close: oc.input(AgentSessionIdInputSchema).output(z.object({ ok: z.boolean() })),

    /**
     * Answer a pending `session/request_permission`. There is no auto-approve
     * and no "remember this choice" in this pass (deliberate, see spec) — every
     * request blocks the turn until a human calls this.
     */
    respondToPermission: oc
      .input(RespondToAgentPermissionInputSchema)
      .output(z.object({ ok: z.boolean() })),

    /**
     * Change the session's advertised model via ACP `session/set_config_option`.
     * `value` is validated against the session's currently advertised options
     * server-side — this is not a passthrough to the agent.
     */
    setConfigOption: oc.input(SetAgentSessionConfigOptionInputSchema).output(AgentSessionVOSchema),

    /**
     * Live event stream for one session. Replays buffered events from `afterSeq`
     * first so a client that reconnects mid-turn does not lose the tokens it
     * missed, then follows live.
     */
    subscribe: oc
      .input(z.object({ sessionId: z.string().min(1), afterSeq: z.number().int().default(-1) }))
      .output(eventIterator(AgentSessionEventVOSchema)),
  },
};
