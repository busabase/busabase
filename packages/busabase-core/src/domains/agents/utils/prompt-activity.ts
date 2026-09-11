import type { AgentSessionVO } from "busabase-contract/domains/agents/types";

export const getPromptActivityState = (status: AgentSessionVO["status"], sending: boolean) => ({
  active: sending || status === "busy",
  starting: sending && status === "connecting",
});

/**
 * Whether the composer should refuse input right now.
 *
 * PUL-214: `ended`/`failed` used to disable the composer outright. But
 * ending is a transport-lifecycle fact, not a turn-busy one — the composer's
 * job is to hold input while a turn is in flight or blocked on the user, not
 * to pre-judge whether sending will succeed. The only states that should
 * close it are a turn already streaming, an open permission request the
 * agent is blocked on, and a config-option change in flight (a model switch
 * must resolve before the next prompt, or the two ACP requests race on the
 * same session).
 */
export const isComposerDisabled = (
  status: AgentSessionVO["status"],
  streaming: boolean,
  configOptionPending: boolean,
): boolean => streaming || status === "waiting_permission" || configOptionPending;

/**
 * The composer's placeholder for the current session state. `waiting_permission`
 * still points the user at the request above; every other state — including
 * `ended`/`failed`, which no longer disable the composer — falls through to
 * the ordinary "message this agent" prompt rather than telling the user to
 * start a new session solely because this one ended or failed.
 */
export const getComposerPlaceholder = (
  status: AgentSessionVO["status"],
  agentName: string,
): string =>
  status === "waiting_permission"
    ? "Respond to the request above to continue…"
    : `Message ${agentName}…`;
