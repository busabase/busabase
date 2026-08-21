import type { AcpAttachment, AcpBlock, AcpPermissionBlock, AcpUiEvent, AcpUsage } from "../reduce";

/**
 * What a host must supply to drive a conversation. The *transport* stays in the
 * app; only the *sequence* is shared.
 *
 * The two existing implementations transport events very differently — acprouter
 * gets an async iterator per prompt over a remote relay, busabase holds one
 * long-lived `subscribe` stream that resumes from the last `seq` after a drop —
 * and neither of those is worth disturbing: they are the most complex,
 * most battle-tested code either app has. But the *order of operations* is
 * identical in both: start a session, follow its events, send a prompt, answer a
 * permission, end. That sequence, and every piece of state it implies, is what
 * `useAcpSession` owns.
 */
export interface AcpSessionPort {
  /**
   * Establish the session and return its id. Called once per session identity;
   * the hook guards against React StrictMode's deliberate double-invoke, which
   * previously spawned two real agent processes for one opened sheet.
   */
  start(signal: AbortSignal): Promise<string>;

  /**
   * Deliver this session's events to `onEvent` until unsubscribed.
   *
   * A per-prompt iterator satisfies this just as well as a long-lived stream —
   * the adapter simply forwards whatever it receives.
   */
  subscribe(
    sessionId: string,
    onEvent: (event: AcpUiEvent) => void,
    signal: AbortSignal,
  ): () => void;

  /**
   * Send the user's text, optionally with images/audio attached. Resolves
   * when accepted, not when the reply is done.
   */
  prompt(
    sessionId: string,
    text: string,
    attachments: readonly AcpAttachment[] | undefined,
    signal: AbortSignal,
  ): Promise<void>;

  /**
   * Answer a pending permission request.
   *
   * Resolve `false` when the answer arrived too late (acprouter's 5-minute
   * server-side timeout already fired), so the card can be put back rather than
   * left showing a choice that was never applied.
   */
  answerPermission(
    sessionId: string,
    block: AcpPermissionBlock,
    optionId: string,
  ): Promise<boolean>;

  /** Optional teardown, so a conversation nobody prompted still gets cleaned up. */
  end?(sessionId: string): void;

  /**
   * Best-effort: ask the agent to stop the turn currently in flight, without
   * ending the session — the user can still send another prompt afterward.
   * ACP's `session/cancel` is a notification (fire-and-forget); the pending
   * `prompt()` call resolves on its own once the agent responds with
   * `stopReason: "cancelled"`, the same way it resolves for any other stop
   * reason, so no separate "turn cancelled" state needs to be threaded back.
   *
   * Optional, so a host with no reachable connection to notify (there is none
   * among the current two) can omit it — the composer's stop button then
   * simply doesn't cancel anything rather than calling something that isn't
   * there.
   */
  cancel?(sessionId: string): Promise<void>;

  /**
   * Optional persisted history, folded before live events are applied.
   *
   * acprouter already stores every event and already exposes `listSessionEvents`
   * — its UI just never calls it, so closing the sheet loses the conversation.
   * Supplying this closes that gap with no backend work.
   */
  history?(sessionId: string, signal: AbortSignal): Promise<AcpUiEvent[]>;

  /**
   * `true` when the server echoes the user's prompt back as an event.
   *
   * A real difference between the two hosts, not a style choice: busabase emits
   * a `user_message` event server-side, so appending locally too would show the
   * prompt twice; acprouter emits nothing, so the hook must append it or the
   * user's own words never appear. Defaults to `false`.
   */
  serverEchoesPrompt?: boolean;
}

export interface AcpSessionState {
  sessionId: string | null;
  blocks: AcpBlock[];
  /** A prompt is in flight. */
  sending: boolean;
  ended: boolean;
  error: string | null;
  /**
   * The agent's own title for this conversation, when it has sent one via
   * `session_info_update` — `null` until then. Session-level, not a
   * transcript block, same reasoning as `usage` below.
   */
  title: string | null;
  /**
   * Token usage as of the most recent `usage_update`, or `null` before the
   * agent has sent one. Deliberately not a transcript block: real usage
   * showed 3 `usage_update`s in a single turn, which would flood the message
   * list if rendered inline — this is a snapshot a host can show wherever
   * makes sense (a footer, a badge), the way `sending`/`ended` already are.
   */
  usage: AcpUsage | null;
  sendPrompt: (text: string, attachments?: readonly AcpAttachment[]) => Promise<void>;
  answerPermission: (block: AcpPermissionBlock, optionId: string) => Promise<void>;
  /** No-op when the port supplied no `cancel`, or when no turn is in flight. */
  cancel: () => Promise<void>;
}
