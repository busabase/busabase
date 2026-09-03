"use client";

import type { AcpAttachment } from "@acp-ui/core/reduce";
import { AcpComposer, type AcpComposerDraft } from "@acp-ui/web/composer";
import { AcpSessionMeta } from "@acp-ui/web/session-meta";
import { AcpConversation } from "@acp-ui/web/transcript";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AgentSessionVO } from "busabase-contract/domains/agents/types";
import { Button } from "kui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "kui/dropdown-menu";
import { ArrowLeft, Bot, ChevronDown, MessageSquarePlus } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AGENT_CHAT_TAB_TYPE,
  type AgentChatTabPayload,
  agentChatTabId,
  consumeAgentChatDraft,
} from "../../dashboard/components/side-panel-sources";
import { registerSidePanelTab, type SidePanelTabProps } from "../../dashboard/side-panel-registry";
import { useSidePanelStore } from "../../dashboard/store/side-panel-store";
import { useAgentSession } from "../hooks/use-agent-session";
import { AgentLoadingState, AgentQueryErrorState } from "./agent-query-state";
import { TransportBadge } from "./transport-badge";

/**
 * A session whose process is gone cannot take another message. Persisted
 * sessions made this reachable: before they survived a restart, an `ended`
 * session simply disappeared and the input was never shown for one.
 */
const isFinished = (status: AgentSessionVO["status"]) => status === "ended" || status === "failed";

const STATUS_LABEL: Record<AgentSessionVO["status"], string> = {
  connecting: "connecting…",
  idle: "idle",
  busy: "replying…",
  waiting_permission: "waiting for your decision",
  ended: "ended",
  failed: "failed",
};

interface AgentDetailViewProps {
  orpc: BusabaseQueryUtils;
  agentSlug: string;
  onBack: () => void;
  /**
   * Select this session on mount, and again whenever it changes. Ask Agent
   * resolves the (node, agent) session *before* opening this view, so the view
   * is told which conversation to show rather than guessing "the newest one" —
   * which would land a question about one node in another node's transcript.
   */
  initialSessionId?: string;
  /**
   * A prompt to prefill (never send) into the composer. See `AcpComposerDraft`:
   * re-supplying the same `id` is a no-op, so this is safe to leave hanging in
   * a prop.
   */
  draft?: AcpComposerDraft | null;
  /** Fired once the draft is in the field, so the owner can retire it. */
  onDraftApplied?: (id: string) => void;
}

/**
 * One agent (by catalog slug), scoped to all of its sessions. The chat panel
 * shows one session at a time; the sidebar switches between them (or starts a
 * new one) without leaving the page. This is the "Agent Detail" the List page
 * navigates into — connecting a *new* agent type happens on the Add page, not
 * here.
 */
export function AgentDetailView({
  orpc,
  agentSlug,
  onBack,
  initialSessionId,
  draft,
  onDraftApplied,
}: AgentDetailViewProps) {
  const queryClient = useQueryClient();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(
    initialSessionId ?? null,
  );

  // Follow the caller's target when it changes. This is what makes a SECOND
  // Ask Agent — about a different node, in the already-open tab — switch the
  // conversation instead of prefilling the previous node's transcript. Not
  // folded into the `activeSessionId` memo below because a manual click in the
  // session rail must still win afterwards.
  useEffect(() => {
    if (initialSessionId) setSelectedSessionId(initialSessionId);
  }, [initialSessionId]);

  const sessions = useQuery({
    ...orpc.agents.sessions.list.queryOptions(),
    refetchInterval: 4000,
  });

  const agentSessions = useMemo(
    () =>
      (sessions.data ?? [])
        .filter((s: AgentSessionVO) => s.slug === agentSlug)
        .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt)),
    [sessions.data, agentSlug],
  );

  // Derived, not effect-driven: a manual selection wins only while it still
  // names one of *this* agent's sessions. Switching agentSlug (or the
  // selected session ending) naturally falls back to the most recent session
  // for the current agent — no reset effect needed, and the 4s list refetch
  // can't clobber a still-valid manual selection.
  const activeSessionId = useMemo(() => {
    if (selectedSessionId && agentSessions.some((s) => s.id === selectedSessionId)) {
      return selectedSessionId;
    }
    return agentSessions[0]?.id ?? null;
  }, [selectedSessionId, agentSessions]);
  const active = agentSessions.find((s) => s.id === activeSessionId) ?? null;

  const createSession = useMutation({
    ...orpc.agents.sessions.create.mutationOptions(),
    onSuccess: (session: AgentSessionVO) => {
      void queryClient.invalidateQueries({ queryKey: orpc.agents.sessions.list.queryKey() });
      setSelectedSessionId(session.id);
    },
  });

  // Transcript, prompting and permission answering are all `@acp-ui/core`, the
  // same interaction core acprouter drives — only the transport below it is
  // busabase's own.
  const chat = useAgentSession(orpc, activeSessionId);

  const send = useCallback(
    (text: string, attachments?: AcpAttachment[]) => {
      if (!activeSessionId) return;
      void chat.sendPrompt(text, attachments).then(() => {
        void queryClient.invalidateQueries({ queryKey: orpc.agents.sessions.list.queryKey() });
      });
    },
    [activeSessionId, chat, queryClient, orpc],
  );

  const agentName = active?.agentName ?? agentSessions[0]?.agentName ?? agentSlug;
  const transport = active?.transport ?? agentSessions[0]?.transport ?? "local-subprocess";

  if (sessions.isPending) {
    return <AgentLoadingState />;
  }

  if (sessions.isError) {
    return (
      <AgentQueryErrorState
        error={sessions.error}
        onRetry={() => void sessions.refetch()}
        title="Couldn't load agent sessions"
      />
    );
  }

  return (
    // A container, not a media query: this view is rendered both full-page and
    // inside the side panel, whose width the user drags between 320 and 760px.
    // The viewport says nothing useful about either.
    <div className="@container/agent flex min-h-0 flex-1">
      {/* The 256px session rail costs more than it earns once the container is
          narrow — at a 420px panel it would leave 164px for the conversation.
          Below @2xl it collapses into the header dropdown instead. */}
      <aside className="hidden w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r p-3 @2xl/agent:flex">
        <Button variant="ghost" size="sm" className="mb-2 justify-start" onClick={onBack}>
          <ArrowLeft className="size-4" />
          Agents
        </Button>

        <div className="flex items-center gap-2 px-1 pb-1">
          <Bot className="size-4" />
          <span className="truncate font-medium text-sm">{agentName}</span>
        </div>
        <TransportBadge transport={transport} />

        <Button
          variant="outline"
          size="sm"
          className="mt-3"
          disabled={createSession.isPending}
          onClick={() => createSession.mutate({ slug: agentSlug })}
        >
          <MessageSquarePlus className="size-4" />
          New session
        </Button>

        <div className="mt-3 flex flex-col gap-1">
          {agentSessions.map((session) => (
            <button
              type="button"
              key={session.id}
              onClick={() => setSelectedSessionId(session.id)}
              className={`flex items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-accent ${
                session.id === activeSessionId ? "bg-accent" : ""
              }`}
            >
              <span className="truncate">{new Date(session.createdAt).toLocaleTimeString()}</span>
              <span className="ml-2 shrink-0 text-muted-foreground text-xs">
                {STATUS_LABEL[session.status]}
              </span>
            </button>
          ))}
        </div>
      </aside>

      <section className="flex min-h-0 flex-1 flex-col">
        {active ? (
          <>
            <header className="flex items-center gap-2 border-b px-4 py-3">
              {/* Everything the hidden rail offers, folded into one control.
                  Only mounted while the rail is gone, so the two can never
                  present the same actions twice. */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    // Icon-only, so it needs a name of its own — without one
                    // this is an unlabelled button to a screen reader, and the
                    // only route to sessions / New session / back at this width.
                    aria-label="Agent menu"
                    className="-ml-2 h-auto shrink-0 gap-1 px-2 py-1 @2xl/agent:hidden"
                    size="sm"
                    title="Agent menu"
                    variant="ghost"
                  >
                    <Bot className="size-4" />
                    <ChevronDown className="size-3 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-60">
                  <DropdownMenuItem onSelect={onBack}>
                    <ArrowLeft className="size-4" />
                    Agents
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={createSession.isPending}
                    onSelect={() => createSession.mutate({ slug: agentSlug })}
                  >
                    <MessageSquarePlus className="size-4" />
                    New session
                  </DropdownMenuItem>
                  {agentSessions.length > 0 ? (
                    <>
                      <DropdownMenuSeparator />
                      <div className="max-h-64 overflow-y-auto">
                        {agentSessions.map((session) => (
                          <DropdownMenuItem
                            key={session.id}
                            onSelect={() => setSelectedSessionId(session.id)}
                          >
                            <span className="flex-1 truncate">
                              {new Date(session.createdAt).toLocaleTimeString()}
                            </span>
                            <span className="shrink-0 text-muted-foreground text-xs">
                              {STATUS_LABEL[session.status]}
                            </span>
                          </DropdownMenuItem>
                        ))}
                      </div>
                    </>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="min-w-0">
                <span className="font-medium text-sm">{agentName}</span>
                <AcpSessionMeta
                  className="truncate text-muted-foreground text-xs"
                  title={chat.title}
                  usage={chat.usage}
                />
              </div>
              <span className="ml-auto shrink-0 text-muted-foreground text-xs">
                {STATUS_LABEL[active.status]}
              </span>
            </header>

            {active.error ? (
              <p className="border-b bg-destructive/10 px-4 py-2 text-destructive text-sm">
                {active.error}
              </p>
            ) : null}

            <AcpConversation
              blocks={chat.blocks}
              streaming={active.status === "busy"}
              onAnswerPermission={chat.answerPermission}
              emptyTitle="Connected."
              emptyDescription="Send a message to start."
            />

            <AcpComposer
              className="border-0 border-t p-3"
              draft={draft}
              onDraftApplied={onDraftApplied}
              disabled={
                active.status === "busy" ||
                active.status === "waiting_permission" ||
                isFinished(active.status)
              }
              onSend={send}
              placeholder={
                isFinished(active.status)
                  ? "This session has ended — start a new one to keep going."
                  : active.status === "waiting_permission"
                    ? "Respond to the request above to continue…"
                    : `Message ${agentName}…`
              }
              onStop={chat.cancel}
              sending={active.status === "busy"}
            />
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center p-8 text-center">
            <div className="max-w-sm">
              <Bot className="mx-auto size-8 text-muted-foreground" />
              <h3 className="mt-3 font-medium">No sessions yet</h3>
              <p className="mt-1 text-muted-foreground text-sm">
                Start a new session with {agentName} to begin.
              </p>
              <Button
                className="mt-3"
                disabled={createSession.isPending}
                onClick={() => createSession.mutate({ slug: agentSlug })}
              >
                <MessageSquarePlus className="size-4" />
                New session
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * The same view, rendered inside the side panel.
 *
 * Deliberately not a second implementation: `AgentDetailView` adapts to its
 * container, so a 420px panel gets the header dropdown and a full page gets
 * the session rail, from one component. "Back" closes the tab rather than
 * navigating — inside a panel, backing out of an agent is dismissing it.
 */
function AgentChatSidePanelTab({ orpc, payload }: SidePanelTabProps) {
  const { agentSlug, sessionId, draft } = payload as AgentChatTabPayload;
  const onDraftApplied = useCallback(
    (id: string) => consumeAgentChatDraft(agentSlug, id),
    [agentSlug],
  );
  return (
    <AgentDetailView
      agentSlug={agentSlug}
      draft={draft ?? null}
      initialSessionId={sessionId}
      onBack={() => useSidePanelStore.getState().closeTab(agentChatTabId(agentSlug))}
      onDraftApplied={onDraftApplied}
      orpc={orpc}
    />
  );
}
registerSidePanelTab(AGENT_CHAT_TAB_TYPE, AgentChatSidePanelTab);
