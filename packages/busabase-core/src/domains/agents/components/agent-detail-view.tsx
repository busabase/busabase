"use client";

import type { AcpAttachment } from "@acp-ui/core/reduce";
import { AcpComposer } from "@acp-ui/web/composer";
import { AcpSessionMeta } from "@acp-ui/web/session-meta";
import { AcpConversation } from "@acp-ui/web/transcript";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AgentSessionVO } from "busabase-contract/domains/agents/types";
import { Button } from "kui/button";
import { ArrowLeft, Bot, MessageSquarePlus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
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
}

/**
 * One agent (by catalog slug), scoped to all of its sessions. The chat panel
 * shows one session at a time; the sidebar switches between them (or starts a
 * new one) without leaving the page. This is the "Agent Detail" the List page
 * navigates into — connecting a *new* agent type happens on the Add page, not
 * here.
 */
export function AgentDetailView({ orpc, agentSlug, onBack }: AgentDetailViewProps) {
  const queryClient = useQueryClient();
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);

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
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-64 shrink-0 flex-col gap-1 overflow-y-auto border-r p-3">
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
