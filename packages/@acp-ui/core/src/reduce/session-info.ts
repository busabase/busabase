import type { AcpUiEvent } from "./types";

/**
 * `usage_update` and `session_info_update` — 2 of the 8 `sessionUpdate` kinds
 * this core previously dropped entirely. The other 6
 * (`plan`/`plan_update`/`plan_removed`/`available_commands_update`/
 * `current_mode_update`/`config_option_update`) stay unhandled: checked
 * against real usage (busabase's own dev logs from actual `claude-agent-acp`
 * sessions) and buda's own ACP server implementation (which emits only
 * message/thought/tool_call updates), neither sends any of the 6 — building
 * renderers for events nothing produces is exactly the "renders unreadable
 * JSON nobody asked for" failure mode this package's default branch already
 * guards against elsewhere.
 *
 * `usage_update` and `session_info_update` are session-level facts (current
 * token usage, the agent's own title for the conversation), not something
 * that belongs inline in the message list — real usage showed 3
 * `usage_update`s in a single turn, which would flood a chat transcript if
 * rendered as blocks. They live on `AcpSessionState` instead (see
 * `session/use-acp-session.ts`), the same way `sending`/`ended` do.
 */

export interface AcpUsage {
  /** Tokens currently in context. */
  used: number;
  /** Total context window size, in tokens. */
  size: number;
  /** Cumulative session cost, when the agent reports one. */
  cost?: { amount: number; currency: string };
}

/** `null` when this event carries no usage info at all. */
export function usageOf(event: AcpUiEvent): AcpUsage | null {
  if (event.type !== "session_update" || event.update.sessionUpdate !== "usage_update") {
    return null;
  }
  const { used, size, cost } = event.update;
  return {
    used,
    size,
    ...(cost ? { cost: { amount: cost.amount, currency: cost.currency } } : {}),
  };
}

/** The most recent usage across a batch of events — folds the same way replaying history does for blocks. */
export function foldUsage(events: readonly AcpUiEvent[]): AcpUsage | null {
  let result: AcpUsage | null = null;
  for (const event of events) {
    const usage = usageOf(event);
    if (usage) result = usage;
  }
  return result;
}

/**
 * The agent's own title for this conversation, when it sends one.
 *
 * Returns `undefined` when the event carries no `session_info_update` at all
 * — the caller should leave existing state alone. Returns `null` when the
 * agent explicitly cleared the title: ACP's own schema documents `title` as
 * "set to null to clear," distinct from an update that simply didn't mention
 * title (which this function also reports as `undefined`, via the `in`
 * check, since `update.title` alone can't tell the two apart).
 */
export function sessionTitleOf(event: AcpUiEvent): string | null | undefined {
  if (event.type !== "session_update" || event.update.sessionUpdate !== "session_info_update") {
    return undefined;
  }
  if (!("title" in event.update)) return undefined;
  return event.update.title ?? null;
}

/** The most recently set title across a batch of events, folding the same way replaying history does for blocks. */
export function foldSessionTitle(events: readonly AcpUiEvent[]): string | null {
  let result: string | null = null;
  for (const event of events) {
    const title = sessionTitleOf(event);
    if (title !== undefined) result = title;
  }
  return result;
}
