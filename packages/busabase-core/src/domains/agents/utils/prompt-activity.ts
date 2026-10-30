import type { AgentSessionVO } from "busabase-contract/domains/agents/types";

export const getPromptActivityState = (status: AgentSessionVO["status"], sending: boolean) => ({
  active: sending || status === "busy" || status === "waiting_permission",
  starting: sending && status === "connecting",
});

/**
 * Whether the composer should refuse input right now.
 *
 * `ended`/`failed` used to disable the composer outright. But
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
 * Whether the model picker should refuse a new selection right now.
 *
 * `idle` is always selectable. `connecting` is also allowed for
 * `remote-websocket` sessions: the backend's `setAgentSessionConfigOption`
 * awaits the same readiness this status reflects and re-validates the
 * choice against whatever the agent actually confirmed before dispatching
 * (see its guard in `agent-session-manager.ts`), so letting the user queue a
 * pick while the handshake is still in flight does not bypass that check —
 * it only lets a cached choice travel with the connection instead of making
 * the user wait and re-open the picker. `local-subprocess` is excluded: it
 * has no equivalent cross-worker lease to serialize a model change against a
 * concurrent first prompt, so this would be a different, unreviewed safety
 * question for that transport. `busy`/`waiting_permission`/`failed`/`ended`
 * stay disabled, and a config-option mutation already in flight always
 * disables the picker regardless of status.
 */
export const isModelSelectorDisabled = (
  status: AgentSessionVO["status"],
  transport: AgentSessionVO["transport"],
  configOptionPending: boolean,
): boolean => {
  if (configOptionPending) return true;
  if (status === "idle") return false;
  return !(status === "connecting" && transport === "remote-websocket");
};

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
