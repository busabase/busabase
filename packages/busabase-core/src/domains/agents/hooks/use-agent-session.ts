"use client";

import { attachmentToContentBlock } from "@acp-ui/core/prompt";
import type { AcpUiEvent } from "@acp-ui/core/reduce";
import type { AcpSessionPort } from "@acp-ui/core/session";
import { useAcpSession } from "@acp-ui/core/session";
import { consumeEventIterator } from "@orpc/client";
import { type QueryKey, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { PromptResourceContextListSchema } from "busabase-contract/domains/agents/prompt-context";
import type {
  AgentSessionEventVO,
  AgentSessionVO,
  PromptAttachmentInput,
} from "busabase-contract/domains/agents/types";
import {
  AgentContextResourceVOSchema,
  AgentPromptPresentationSchema,
} from "busabase-contract/domains/agents/types";
import { useMemo, useRef, useState } from "react";
import { translateAcpExtension } from "../utils/acp-fidelity";
import {
  contextResourceToContentBlock,
  promptResourceContextToContentBlock,
} from "../utils/agent-context-resources";
import { shouldRenderAgentMessage } from "../utils/agent-visible-message";

/**
 * One session's live status, reported out-of-band from the query cache. The
 * subscription learns a status change seconds before the next 4s session-list
 * poll would, and used to patch that fact straight into the query cache via
 * `setQueryData` so the UI reflected it immediately. That meant two sources —
 * this subscription and the ordinary poll/refetch — could both "win" a cache
 * write for the same row, and a stale replayed status could stomp a newer
 * polled one. Reporting it to the caller instead (who overlays it onto the
 * query-derived list, the same way the create/config-option session bridge
 * does) keeps the query cache server-owned: this is a transient, UI-only
 * annotation, not a write a refetch has to race.
 */
export interface AgentSessionStatusUpdate {
  sessionId: string;
  status: AgentSessionVO["status"];
  lastActivityAt: string;
  error?: string;
  /**
   * The event's own `seq`, monotonic per session. The subscription can
   * replay from `afterSeq` on reconnect, so without this the consumer has no
   * way to tell a just-replayed, now-stale status from a genuinely new one —
   * it would overwrite whatever a newer poll already reported. Compare with
   * `>=` against the last applied value for this session; never `>` only,
   * since a reconnect can legitimately redeliver the same seq.
   */
  seq: number;
}

export interface AgentSessionSubscriptionHealth {
  sessionId: string;
  state: "connected" | "recovering";
  /** Observation health only; it does not claim that the remote run failed. */
  reason?: "error" | "closed";
}

const NO_COMMITTED_COMMANDS: ReadonlySet<string> = new Set();

/**
 * Translate one persisted busabase event into zero or more shared-model
 * events. Zero for events the transcript does not render, which is
 * deliberately the same set the previous `buildAgentTimeline` ignored. More
 * than one only for a `user_message` that carries attachments — see below.
 */
export function translateAgentSessionEvent(event: AgentSessionEventVO): AcpUiEvent[] {
  if (event.kind === "status" && event.status === "failed")
    return [{ type: "interrupted", at: event.at }];
  if (event.kind === "acpExtension") return translateAcpExtension(event.acpExtension);
  if (event.kind === "inputRequest" && event.inputRequest)
    return [{ type: "input_request", ...event.inputRequest }];
  if (event.kind === "inputResolved" && event.inputRequestId && event.inputResponse)
    return [{ type: "input_resolved", requestId: event.inputRequestId, ...event.inputResponse }];
  if (event.kind === "permissionRequest" && event.permissionRequest) {
    return [
      {
        type: "permission_request",
        requestId: event.permissionRequest.requestId,
        title: event.permissionRequest.title ?? "runs a tool call",
        options: event.permissionRequest.options,
        // No `timeoutAt` on purpose: busabase waits indefinitely and never
        // auto-approves. That is a security property, so the card must not
        // imply the request will lapse on its own.
      },
    ];
  }

  if (
    event.kind === "permissionResolved" &&
    event.permissionRequestId &&
    event.permissionOptionId
  ) {
    return [
      {
        type: "permission_resolved",
        requestId: event.permissionRequestId,
        optionId: event.permissionOptionId,
      },
    ];
  }

  if (event.kind !== "acpUpdate" || !event.acpUpdate || typeof event.acpUpdate !== "object") {
    // `status` drives the header, not the transcript. `error` is currently not
    // rendered either — that matches the previous behaviour exactly, and is
    // noted as a follow-up rather than changed here.
    return [];
  }

  const update = event.acpUpdate as Record<string, unknown>;
  const tag = typeof update.sessionUpdate === "string" ? update.sessionUpdate : "";
  if (tag === "user_message_chunk") {
    const metadata = update._meta as Record<string, unknown> | undefined;
    const busabase = metadata?.["busabase.im"] as Record<string, unknown> | undefined;
    if (busabase?.clientEcho === true) return [];
  }

  // busabase emits its own session-level notes (e.g. an attachment busabase
  // could not send to this agent). Not an ACP tag. Filtered rather than
  // translated unconditionally: a legacy persisted unsupported-HTTP-MCP note
  // and raw ACP transport-close noise are both session-level text that
  // reached this path historically, but neither is something the user should
  // see — see `shouldRenderAgentMessage`.
  if (tag === "note" && typeof update.text === "string") {
    return shouldRenderAgentMessage(update.text) ? [{ type: "note", text: update.text }] : [];
  }

  // Also busabase's own, and NOT the ACP wire shape: the user's prompt is
  // echoed back as `{ sessionUpdate: "user_message", text, attachments? }`,
  // with the text at the top level rather than inside `content`, and any
  // attachments riding alongside rather than as their own content blocks.
  // Left untranslated it would be dropped by the ACP-native reducer and the
  // user's own words (and pictures) would vanish from a replayed session.
  //
  // One `user_message_chunk` for the text, one more per attachment. All chunks
  // from this event share a stable id so they become one message, while the
  // next persisted user event starts a new message even when a cancelled turn
  // produced no intervening agent chunk.
  if (tag === "user_message" && typeof update.text === "string") {
    // The producer records the user's original text explicitly. Old or
    // malformed events keep their full text; content is never pattern-matched.
    const presentation = AgentPromptPresentationSchema.safeParse(update.presentation);
    const text = presentation.success ? presentation.data.text : update.text;
    const attachments = Array.isArray(update.attachments)
      ? (update.attachments as PromptAttachmentInput[])
      : [];
    const contextResources = AgentContextResourceVOSchema.array().safeParse(
      update.contextResources ?? [],
    );
    const resourceContext = PromptResourceContextListSchema.safeParse(update.resourceContext ?? []);
    const messageId = `busabase-user:${event.sessionId}:${event.seq}`;
    return [
      {
        type: "session_update",
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text },
          messageId,
        } as never,
      },
      ...(resourceContext.success ? resourceContext.data : []).map(
        (snapshot): AcpUiEvent => ({
          type: "session_update",
          update: {
            sessionUpdate: "user_message_chunk",
            content: promptResourceContextToContentBlock(snapshot),
            messageId,
          },
        }),
      ),
      // Built through the same helper the send path uses, rather than
      // hand-rolling `{ type: attachment.kind }`: that shape is only a valid
      // ACP content block for `image`/`audio`, so a `file` attachment would
      // produce `{ type: "file" }`, be rejected by the reducer, and silently
      // vanish from a replayed transcript — the very failure the comment
      // above warns about, one kind later.
      ...(contextResources.success ? contextResources.data : []).map(
        (snapshot): AcpUiEvent => ({
          type: "session_update",
          update: {
            sessionUpdate: "user_message_chunk",
            content: contextResourceToContentBlock(snapshot),
            messageId,
          },
        }),
      ),
      ...attachments.map(
        (attachment): AcpUiEvent => ({
          type: "session_update",
          update: {
            sessionUpdate: "user_message_chunk",
            content: attachmentToContentBlock(attachment),
            messageId,
          },
        }),
      ),
    ];
  }

  return [{ type: "session_update", update: update as never }];
}

/**
 * busabase's ACP transport, expressed as an `AcpSessionPort`.
 *
 * The subscription keeps the reconnect behaviour it always had: it resumes from
 * the last `seq` seen rather than from zero, so a connection dropped mid-reply
 * catches up on what it missed instead of losing those tokens or replaying the
 * whole transcript. That is also why no `history` is supplied — subscribing
 * from `seq -1` already replays everything, so there is no separate history
 * fetch to race with.
 *
 * Sessions here are created explicitly by the user, so `start` adopts the one
 * already selected rather than opening a new one.
 */
export function useAgentSession(
  orpc: BusabaseQueryUtils,
  sessionId: string | null,
  pagedSessionQueryKey?: QueryKey,
  onStatusUpdate?: (update: AgentSessionStatusUpdate) => void,
  // Fired on exactly the two signals that can change a session's confirmed
  // model metadata server-side — first readiness after connect, and a
  // config-option change — never on the plain 4s poll tick. Carries the
  // event's own `seq` so the caller can fence a request it issues in
  // response against a newer signal arriving before that request resolves.
  // Deliberately does not fetch anything itself: fetching is the caller's
  // job (see `agent-detail-view.tsx`), because only the caller knows which
  // scope/catalog that fetch's result is allowed to be written into.
  onMetadataRefresh?: (signal: { sessionId: string; seq: number }) => void,
  options?: { supervised?: boolean },
) {
  const queryClient = useQueryClient();
  const supervised = options?.supervised === true;
  const [committedCommands, setCommittedCommands] = useState<{
    sessionId: string;
    ids: ReadonlySet<string>;
  } | null>(null);
  const [subscriptionHealth, setSubscriptionHealth] =
    useState<AgentSessionSubscriptionHealth | null>(null);
  const callbacks = useRef({ onStatusUpdate, onMetadataRefresh });
  callbacks.current = { onStatusUpdate, onMetadataRefresh };
  const port = useMemo<AcpSessionPort>(
    () => ({
      start: async () => sessionId ?? "",

      subscribe: (id, onEvent, signal) => {
        let cancelled = false;
        let unsubscribe: (() => void) | undefined;
        let retryTimer: ReturnType<typeof setTimeout> | undefined;
        let refreshTimer: ReturnType<typeof setTimeout> | undefined;
        let lastSeq = -1;
        let readinessRefreshed = false;
        let terminal = false;
        let connectionGeneration = 0;

        const refreshSessions = () => {
          void queryClient.invalidateQueries({
            queryKey: orpc.agents.sessions.list.queryKey(),
          });
          if (pagedSessionQueryKey) {
            void queryClient.invalidateQueries({ queryKey: pagedSessionQueryKey });
          }
        };
        const refreshSupervisedSession = () => {
          if (!supervised || refreshTimer) return;
          refreshTimer = setTimeout(() => {
            refreshTimer = undefined;
            if (!cancelled) refreshSessions();
          }, 250);
        };

        const connect = () => {
          if (cancelled) return;
          const generation = ++connectionGeneration;
          const subscription = orpc.agents.sessions.subscribe.call(
            { sessionId: id, afterSeq: lastSeq },
            { signal },
          );
          // RPCLink resolves this promise after fetch and successful response
          // decoding, before an idle SSE stream has its first journal event.
          // This acknowledges observation only; it never changes seq/execution.
          const observed = supervised
            ? Promise.resolve(subscription).then((iterator) => {
                if (
                  !cancelled &&
                  !signal.aborted &&
                  generation === connectionGeneration &&
                  iterator &&
                  typeof iterator.next === "function"
                ) {
                  setSubscriptionHealth({ sessionId: id, state: "connected" });
                  refreshSupervisedSession();
                }
                return iterator;
              })
            : subscription;
          unsubscribe = consumeEventIterator(observed, {
            onEvent: (event: AgentSessionEventVO) => {
              if (cancelled || generation !== connectionGeneration || event.seq <= lastSeq) return;
              lastSeq = Math.max(lastSeq, event.seq);
              if (supervised) {
                setSubscriptionHealth((previous) =>
                  previous?.sessionId === id && previous.state === "connected"
                    ? previous
                    : { sessionId: id, state: "connected" },
                );
                if (event.commandId) {
                  const commandId = event.commandId;
                  setCommittedCommands((previous) => {
                    const ids = previous?.sessionId === id ? previous.ids : NO_COMMITTED_COMMANDS;
                    if (ids.has(commandId)) return previous;
                    return { sessionId: id, ids: new Set([...ids, commandId]) };
                  });
                }
                refreshSupervisedSession();
              }
              if (event.kind === "status" && event.status) {
                terminal = event.status === "ended" || event.status === "failed";
                callbacks.current.onStatusUpdate?.({
                  sessionId: id,
                  status: event.status as AgentSessionVO["status"],
                  lastActivityAt: event.at,
                  seq: event.seq,
                  ...(event.status === "failed" && event.message ? { error: event.message } : {}),
                });
                // Replay may start ready, or startup may go straight into a prompt.
                // Keep this guard across reconnects, but not across subscriptions.
                if (
                  !readinessRefreshed &&
                  (event.status === "idle" ||
                    event.status === "busy" ||
                    event.status === "waiting_permission")
                ) {
                  readinessRefreshed = true;
                  refreshSessions();
                  callbacks.current.onMetadataRefresh?.({ sessionId: id, seq: event.seq });
                }
              }
              const update = event.acpUpdate as { sessionUpdate?: unknown } | undefined;
              if (
                event.kind === "acpUpdate" &&
                (update?.sessionUpdate === "config_option_update" ||
                  update?.sessionUpdate === "current_mode_update")
              ) {
                refreshSessions();
                callbacks.current.onMetadataRefresh?.({ sessionId: id, seq: event.seq });
              }
              for (const translated of translateAgentSessionEvent(event)) onEvent(translated);
            },
            onError: () => {
              if (!cancelled && generation === connectionGeneration && supervised) {
                setSubscriptionHealth({ sessionId: id, state: "recovering", reason: "error" });
                refreshSupervisedSession();
              }
            },
            onFinish: () => {
              // A retired owning socket may finish normally. Resume the
              // durable subscription after either kind of transport close.
              if (
                !cancelled &&
                generation === connectionGeneration &&
                !signal.aborted &&
                !terminal
              ) {
                if (supervised) {
                  setSubscriptionHealth((previous) =>
                    previous?.sessionId === id && previous.reason === "error"
                      ? previous
                      : { sessionId: id, state: "recovering", reason: "closed" },
                  );
                  refreshSupervisedSession();
                }
                retryTimer = setTimeout(connect, 3000);
              }
            },
          });
        };

        connect();

        return () => {
          cancelled = true;
          if (retryTimer) clearTimeout(retryTimer);
          if (refreshTimer) clearTimeout(refreshTimer);
          unsubscribe?.();
        };
      },

      prompt: async (id, text, attachments) => {
        await orpc.agents.sessions.prompt.call({
          sessionId: id,
          text,
          ...(attachments && attachments.length > 0 ? { attachments: [...attachments] } : {}),
        });
      },

      answerPermission: async (id, block, optionId) => {
        await orpc.agents.sessions.respondToPermission.call({
          sessionId: id,
          requestId: block.id,
          optionId,
        });
        return true;
      },

      // The backend has had a complete, working session/cancel path since
      answerInput: async (id, block, response) => {
        await orpc.agents.sessions.respondToInput.call({
          sessionId: id,
          requestId: block.id,
          response,
        });
        return true;
      },

      // The backend has had a complete, working session/cancel path since
      // before this package existed (agent-session-manager.ts's
      // `session.cancel` + the router's `cancel` procedure) — it was simply
      // never called from the UI. This is the wiring, not new capability.
      cancel: async (id) => {
        await orpc.agents.sessions.cancel.call({ sessionId: id });
      },

      // The server echoes the prompt back as a `user_message` event, so the
      // core must not append it too — that would show it twice.
      serverEchoesPrompt: true,

      // `end` is deliberately NOT implemented, even though the backend has a
      // working close path and the slot is right here. `useAcpSession` calls
      // `port.end?.()` from an effect cleanup keyed on the session id, so
      // implementing it would end the previous conversation every time the
      // user clicks another session in the rail, closes the side-panel tab,
      // navigates away from /agents, or React StrictMode double-mounts in dev.
      // That slot was written for acprouter's ephemeral sessions; busabase's
      // are durable and user-created. Ending one is an explicit act, wired to
      // the explicit "End session" button in `agent-detail-view.tsx`.
    }),
    [orpc, pagedSessionQueryKey, queryClient, sessionId, supervised],
  );

  return {
    ...useAcpSession(port, sessionId),
    committedCommandIds:
      committedCommands?.sessionId === sessionId ? committedCommands.ids : NO_COMMITTED_COMMANDS,
    subscriptionHealth: subscriptionHealth?.sessionId === sessionId ? subscriptionHealth : null,
  };
}
