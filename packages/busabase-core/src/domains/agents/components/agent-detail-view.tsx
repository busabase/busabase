"use client";

import type { AcpAttachment, AcpBlock } from "@acp-ui/core/reduce";
import { AcpComposer, type AcpComposerDraft } from "@acp-ui/web/composer";
import { AcpSessionMeta } from "@acp-ui/web/session-meta";
import { AcpConversation } from "@acp-ui/web/transcript";
import {
  type InfiniteData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { hasApiKeyLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AgentSessionsPageVO, AgentSessionVO } from "busabase-contract/domains/agents/types";
import { Message, MessageContent } from "kui/ai-elements/message";
import { Button } from "kui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "kui/dropdown-menu";
import {
  ArrowLeft,
  AtSign,
  Bot,
  Check,
  ChevronDown,
  Loader2,
  MessageSquarePlus,
  MoreHorizontal,
  PanelRight,
  PowerOff,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { type CoreI18nMessages, fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { presentCoreError } from "../../../i18n/localize-error";
import { resolveSpaceId } from "../../dashboard/components/node-agent-prompts-dialog";
import { ConfirmActionDialog } from "../../dashboard/components/primitives";
import {
  AGENT_CHAT_TAB_TYPE,
  type AgentChatTabPayload,
  agentChatTabId,
  consumeAgentChatDraft,
} from "../../dashboard/components/side-panel-sources";
import { useWorkspacePermissionLevel } from "../../dashboard/components/split-submit-button";
import { formatDetailTime, formatFullTime } from "../../dashboard/helpers/format";
import type { LoadedNode } from "../../dashboard/node-detail-registry";
import { registerSidePanelTab, type SidePanelTabProps } from "../../dashboard/side-panel-registry";
import { useCurrentNodeStore } from "../../dashboard/store/current-node-store";
import { useSidePanelStore } from "../../dashboard/store/side-panel-store";
import { useAgentSession } from "../hooks/use-agent-session";
import { withNodeContext } from "../utils/agent-message-context";
import { sendOrContinueAgentPrompt } from "../utils/agent-session-continuation";
import { shouldRenderAgentMessage } from "../utils/agent-visible-message";
import { getPromptActivityState, isComposerDisabled } from "../utils/prompt-activity";
import { AgentLoadingState, AgentQueryErrorState } from "./agent-query-state";
import { ModelSelectorRow } from "./model-selector-row";
import { TransportBadge } from "./transport-badge";

const statusLabel = (status: AgentSessionVO["status"], messages: CoreI18nMessages): string =>
  ({
    connecting: messages.agents.statusConnecting,
    idle: messages.agents.statusIdle,
    busy: messages.agents.statusBusy,
    waiting_permission: messages.agents.statusWaitingPermission,
    ended: messages.agents.statusEnded,
    failed: messages.agents.statusFailed,
  })[status];

/**
 * "Jul 30, 12:34 PM" rather than a bare time: sessions persist, so two
 * sessions started on different days (or a session sitting a week old) would
 * otherwise show identical or ambiguous labels. `formatFullTime` (the
 * complete localized timestamp) backs the accessible name, since the visible
 * label truncates in both the rail and the compact menu.
 */
const sessionTimeLabel = (createdAt: string, locale: string) => ({
  short: formatDetailTime(createdAt, locale),
  full: formatFullTime(createdAt, locale),
});

const sessionItemLabel = (
  createdAt: string,
  status: AgentSessionVO["status"],
  locale: string,
  messages: CoreI18nMessages,
) => {
  const time = sessionTimeLabel(createdAt, locale);
  const statusText = statusLabel(status, messages);
  return {
    ...time,
    status: statusText,
    accessible: fmt(messages.agents.sessionItemLabel, {
      status: statusText,
      time: time.full,
    }),
  };
};

const AGENT_SESSION_PAGE_SIZE = 20;

const hasAgentProgressAfterLatestUserMessage = (blocks: readonly AcpBlock[]): boolean => {
  let latestUserMessage = -1;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block?.kind === "message" && block.role === "user") {
      latestUserMessage = index;
      break;
    }
  }

  return blocks.slice(latestUserMessage + 1).some((block) => {
    return block.kind !== "message" || block.role !== "user";
  });
};

const hasAgentProgressForPendingTurn = (
  blocks: readonly AcpBlock[],
  previousUserBlockIds: readonly string[],
): boolean => {
  const previousIds = new Set(previousUserBlockIds);
  const currentUserIndex = blocks.findLastIndex(
    (block) => block.kind === "message" && block.role === "user" && !previousIds.has(block.id),
  );

  if (currentUserIndex < 0) return false;
  return blocks.slice(currentUserIndex + 1).some((block) => {
    return block.kind !== "message" || block.role !== "user";
  });
};

function AgentActivityIndicator({ label }: { label: string }) {
  return (
    <Message data-testid="agent-activity-indicator" from="assistant">
      <MessageContent>
        <div
          aria-live="polite"
          className="flex min-h-5 items-center gap-2 text-muted-foreground text-sm"
          role="status"
        >
          <Loader2
            aria-hidden="true"
            className="size-4 text-foreground/75 motion-safe:animate-spin"
          />
          <span>{label}</span>
        </div>
      </MessageContent>
    </Message>
  );
}

/**
 * "There is no live process behind this id" — `requireSession` in
 * `agent-session-manager.ts` throws `Unknown agent session: <id>`, and the
 * router passes that message through verbatim.
 *
 * Read as an outcome, not a failure: ending something that had already ended
 * is the result the user asked for. It is also the COMMON reply on Busabase
 * Cloud rather than an edge case — Cloud never runs the restart reaper
 * (`endOrphanedLocalSessions` is called only from the OSS host's
 * instrumentation), so every session created before a deploy still looks live
 * in the list with nothing behind it. A red error there would teach people
 * that the button is broken.
 */
const isSessionAlreadyGone = (error: unknown): boolean =>
  error instanceof Error && error.message.startsWith("Unknown agent session:");

const updateSessionPages = (
  previous: InfiniteData<AgentSessionsPageVO> | undefined,
  update: (session: AgentSessionVO) => AgentSessionVO,
) =>
  previous
    ? {
        ...previous,
        pages: previous.pages.map((page) => ({
          ...page,
          items: page.items.map(update),
        })),
      }
    : previous;

interface AgentDetailViewProps {
  orpc: BusabaseQueryUtils;
  agentSlug: string;
  onBack: () => void;
  /**
   * Keep session navigation in the header menu even when the container is wide.
   * Side panels use this so widening the panel never inserts a third column
   * between the node and the conversation.
   */
  compactSessionNavigation?: boolean;
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
  /**
   * The node the user is looking at in the main area, offered as removable
   * context above the composer.
   *
   * Only the side-panel instance passes this, and deliberately so: "the node
   * you have open" is a fact that exists when a node is on the left and the
   * agent is on the right. On the full agent page there is no such node — the
   * agent IS what the user is looking at — so a chip there could only ever
   * offer a stale one.
   */
  contextNode?: LoadedNode | null;
  /**
   * Move this conversation into the side panel, so it can sit beside the node
   * the user goes on to work in.
   *
   * Only the full page passes it — inside the panel the conversation is already
   * there, and a button that re-pins it where it is would be a no-op with a
   * label. This is also what makes the context chip reachable: the chip only
   * exists in the panel instance, so "open in side panel" is the door to it.
   */
  onOpenInSidePanel?: (sessionId: string, agentName: string) => void;
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
  compactSessionNavigation = false,
  initialSessionId,
  draft,
  onDraftApplied,
  contextNode = null,
  onOpenInSidePanel,
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

  const sessionListOptions = useMemo(
    () =>
      orpc.agents.sessions.listPaged.infiniteOptions({
        input: (pageParam: string | undefined) => ({
          slug: agentSlug,
          limit: AGENT_SESSION_PAGE_SIZE,
          cursor: pageParam,
        }),
        initialPageParam: undefined as string | undefined,
        getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
      }),
    [agentSlug, orpc],
  );
  const sessions = useInfiniteQuery({
    ...sessionListOptions,
    refetchInterval: 4000,
  });
  const connections = useQuery({
    ...orpc.agents.connections.list.queryOptions({ input: { scope: "mine" } }),
    refetchInterval: 4000,
  });

  /**
   * Both session lists, refreshed together: this view reads the paged one, and
   * the side panel's agent picker reads `sessions.list`. Anything that changes
   * a session's existence or status has to move both, or one surface keeps
   * showing a conversation in a state it left seconds ago.
   */
  const refreshSessionLists = useCallback(
    () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: sessionListOptions.queryKey }),
        queryClient.invalidateQueries({ queryKey: orpc.agents.sessions.list.queryKey() }),
      ]),
    [orpc, queryClient, sessionListOptions.queryKey],
  );

  const agentSessions = useMemo(
    () => [
      ...new Map(
        (sessions.data?.pages.flatMap((page) => page.items) ?? []).map((session) => [
          session.id,
          session,
        ]),
      ).values(),
    ],
    [sessions.data],
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
      setSelectedSessionId(session.id);
      void refreshSessionLists();
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Could not start a new session.");
    },
  });

  const setConfigOption = useMutation({
    ...orpc.agents.sessions.setConfigOption.mutationOptions(),
    onSuccess: (session: AgentSessionVO) => {
      // Replace, not merge: the response carries the agent's complete,
      // possibly-changed config state (e.g. a reasoning-effort option tied to
      // the new model), and the cache should reflect exactly that rather than
      // a stale local guess.
      queryClient.setQueryData<InfiniteData<AgentSessionsPageVO>>(
        sessionListOptions.queryKey,
        (previous) =>
          updateSessionPages(previous, (item) => (item.id === session.id ? session : item)),
      );
      queryClient.setQueryData(
        orpc.agents.sessions.list.queryKey(),
        (previous: AgentSessionVO[] | undefined) =>
          previous?.map((item) => (item.id === session.id ? session : item)),
      );
    },
  });

  /**
   * Covers both known-terminal sessions and the stale-cache window where the
   * backend became terminal after the latest list poll. Every send goes
   * through the continuation helper so the prompt RPC's pre-record rejection,
   * rather than a four-second-old status, is authoritative. The same flag
   * spans create-session-then-first-prompt so the composer cannot double-send.
   */
  const [continuing, setContinuing] = useState(false);
  const [continuationError, setContinuationError] = useState<string | null>(null);
  const [pendingTurnUserBlockIds, setPendingTurnUserBlockIds] = useState<string[] | null>(null);

  // A stale continuation error must not survive a switch away from the
  // session that produced it — including the switch `onSessionCreated`
  // itself makes onto the freshly continued session.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the trigger (activeSessionId changing) matters, not a value read in the body.
  useEffect(() => {
    setContinuationError(null);
    if (!continuing) setPendingTurnUserBlockIds(null);
  }, [activeSessionId]);

  // Transcript, prompting and permission answering are all `@acp-ui/core`, the
  // same interaction core acprouter drives — only the transport below it is
  // busabase's own.
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const chat = useAgentSession(orpc, activeSessionId, sessionListOptions.queryKey);
  const promptActivity = active
    ? getPromptActivityState(active.status, chat.sending || continuing)
    : { active: false, starting: false };
  const currentUserBlockIds = useMemo(
    () =>
      chat.blocks.flatMap((block) =>
        block.kind === "message" && block.role === "user" ? [block.id] : [],
      ),
    [chat.blocks],
  );
  const hasCurrentAgentProgress =
    pendingTurnUserBlockIds === null
      ? hasAgentProgressAfterLatestUserMessage(chat.blocks)
      : hasAgentProgressForPendingTurn(chat.blocks, pendingTurnUserBlockIds);
  const showActivityIndicator =
    active !== null &&
    (promptActivity.active || active.status === "connecting") &&
    !hasCurrentAgentProgress;
  const activityLabel = active
    ? active.status === "busy"
      ? messages.agents.statusBusy
      : active.status === "connecting" && !continuing && !chat.sending
        ? messages.agents.statusConnecting
        : messages.agents.statusStarting
    : "";

  useEffect(() => {
    if (!promptActivity.active) setPendingTurnUserBlockIds(null);
  }, [promptActivity.active]);

  /**
   * The node whose context the user has waved off, by id.
   *
   * Keyed by id rather than a boolean so dismissing is scoped to THAT node:
   * navigate to a different one and the chip comes back, because the answer to
   * "did you mean this node?" changed. Nothing about "no, not the Visits table"
   * implies "and never any node again".
   */
  const [dismissedContextId, setDismissedContextId] = useState<string | null>(null);
  const activeContextNode =
    contextNode && contextNode.id !== dismissedContextId ? contextNode : null;

  const [endConfirmOpen, setEndConfirmOpen] = useState(false);

  /**
   * Stop the agent, keep the conversation.
   *
   * Deliberately NOT wired into `AcpSessionPort.end`, which looks like the
   * natural slot and is a trap: `@acp-ui/core`'s `useAcpSession` calls
   * `port.end?.()` from an effect cleanup keyed on the session id, so
   * implementing it would end the previous conversation every time the user
   * clicks another session in the rail, closes the side-panel tab, navigates
   * away, or React StrictMode double-mounts in dev. That slot was written for
   * acprouter's ephemeral sessions; busabase's are durable and user-created,
   * so ending one is an explicit act and this is an explicit button.
   *
   * `selectedSessionId` is left alone on purpose — the user stays on the
   * transcript they just ended, which is the whole promise the dialog makes.
   */
  const endSession = useMutation({
    ...orpc.agents.sessions.close.mutationOptions(),
    onSuccess: () => {
      setEndConfirmOpen(false);
      toast.success(messages.agents.endSessionDone);
      void refreshSessionLists();
    },
    onError: (error: Error) => {
      if (isSessionAlreadyGone(error)) {
        setEndConfirmOpen(false);
        toast.info(messages.agents.endSessionAlreadyEnded);
        void refreshSessionLists();
        return;
      }
      // The router's `fail()` returns the server's own wording, so show it
      // under the headline rather than instead of it.
      toast.error(messages.agents.endSessionFailed, { description: error.message });
    },
  });

  // A confirmation is about ONE conversation. If the selection moves while the
  // dialog is open — a second Ask Agent targeting a different session — retract
  // the question instead of letting "End session" land on another transcript.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the trigger (activeSessionId changing) matters, not a value read in the body.
  useEffect(() => {
    setEndConfirmOpen(false);
  }, [activeSessionId]);

  /**
   * Mirrors the server: the whole agents family sits behind
   * `assertWorkspacePermission("write")`, so offering this to a `read` member
   * could only ever produce a 403. Terminal sessions hide it outright rather
   * than disabling it — there is no process left to release, and a greyed-out
   * control invites the "why can't I?" the label can't answer.
   */
  const permissionLevel = useWorkspacePermissionLevel();
  const canEndSession =
    active !== null &&
    active.status !== "ended" &&
    active.status !== "failed" &&
    hasApiKeyLevel(permissionLevel, "write");

  const send = useCallback(
    (text: string, attachments?: AcpAttachment[]) => {
      if (!active) return;
      // The chip is a promise made in the UI ("your message will say which node
      // you mean"), so it is kept here, at send time, rather than by pre-filling
      // the textbox — which would make the user delete the line to opt out and
      // leave them editing our words instead of writing their own.
      const body = withNodeContext(text, activeContextNode, locale, resolveSpaceId());

      setContinuationError(null);
      setPendingTurnUserBlockIds(currentUserBlockIds);
      setContinuing(true);
      void sendOrContinueAgentPrompt(
        {
          createSession: async (slug) => createSession.mutateAsync({ slug }),
          sendPrompt: async (sessionId, promptText, promptAttachments) => {
            const result = await orpc.agents.sessions.prompt.call({
              sessionId,
              text: promptText,
              ...(promptAttachments && promptAttachments.length > 0
                ? { attachments: [...promptAttachments] }
                : {}),
            });
            return result.accepted
              ? { accepted: true }
              : {
                  accepted: false,
                  promptRecorded: result.promptRecorded,
                  message: result.message,
                };
          },
          onSessionCreated: async (sessionId) => {
            setSelectedSessionId(sessionId);
            await refreshSessionLists();
          },
        },
        { sessionId: active.id, status: active.status },
        agentSlug,
        body,
        attachments,
      )
        .then(refreshSessionLists)
        .catch((error: unknown) => {
          setContinuationError(
            presentCoreError(messages, locale, error, messages.agents.continueConversationFailed),
          );
        })
        .finally(() => setContinuing(false));
    },
    [
      active,
      activeContextNode,
      agentSlug,
      createSession,
      currentUserBlockIds,
      locale,
      messages,
      orpc,
      refreshSessionLists,
    ],
  );

  const agentName = active?.agentName ?? agentSessions[0]?.agentName ?? agentSlug;
  const transport = active?.transport ?? agentSessions[0]?.transport ?? "local-subprocess";
  const remoteNeedsReconnect =
    transport === "remote-websocket" &&
    connections.data !== undefined &&
    !connections.data.some((connection) => connection.slug === agentSlug && connection.connected);

  if (sessions.isPending) {
    return <AgentLoadingState />;
  }

  if (sessions.isError) {
    return (
      <AgentQueryErrorState
        error={sessions.error}
        onRetry={() => void sessions.refetch()}
        title={messages.agents.loadSessionsFailedTitle}
      />
    );
  }

  return (
    <>
      {/* A container, not a media query: this view is rendered both full-page
          and inside the side panel, whose configured width the user drags
          between 320 and 760px (and whose flex host can make the content
          narrower). The viewport says nothing useful about either. */}
      <div
        className="@container/agent flex h-full min-h-0 min-w-0 flex-1 overflow-hidden"
        data-testid="agent-detail-view"
      >
        {/* The 256px session rail costs more than it earns once the container is
          narrow. Below @2xl it collapses into the header dropdown instead. A
          side-panel conversation always stays in that compact mode so widening
          the panel cannot turn the page into three columns. */}
        {compactSessionNavigation ? null : (
          <aside className="hidden w-64 shrink-0 flex-col gap-1 border-r p-3 @2xl/agent:flex">
            <Button
              variant="ghost"
              size="sm"
              className="mb-2 min-w-0 shrink-0 justify-start"
              onClick={onBack}
            >
              <ArrowLeft className="size-4" />
              {messages.agents.backToAgents}
            </Button>

            <div className="flex min-w-0 shrink-0 items-center gap-2 px-1 pb-1">
              <Bot className="size-4 shrink-0" />
              <span className="min-w-0 truncate font-medium text-sm">{agentName}</span>
            </div>
            <div className="shrink-0">
              <TransportBadge transport={transport} />
            </div>

            <Button
              variant="outline"
              size="sm"
              className="mt-3 min-w-0 shrink-0"
              disabled={createSession.isPending || remoteNeedsReconnect}
              onClick={() => createSession.mutate({ slug: agentSlug })}
            >
              <MessageSquarePlus className="size-4" />
              <span className="truncate">{messages.agents.newSession}</span>
            </Button>

            <nav
              aria-label={messages.agents.sessionListLabel}
              className="mt-3 flex min-h-0 min-w-0 flex-1 flex-col gap-1 overflow-y-auto"
            >
              {agentSessions.map((session) => {
                const isActive = session.id === activeSessionId;
                const label = sessionItemLabel(session.createdAt, session.status, locale, messages);
                return (
                  <button
                    type="button"
                    key={session.id}
                    aria-current={isActive ? "true" : undefined}
                    aria-label={label.accessible}
                    data-testid="agent-session-item"
                    onClick={() => setSelectedSessionId(session.id)}
                    title={label.accessible}
                    className={`flex min-w-0 items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-accent ${
                      isActive ? "bg-accent" : ""
                    }`}
                  >
                    <Check
                      aria-hidden="true"
                      className={`size-3.5 shrink-0 ${isActive ? "opacity-100" : "opacity-0"}`}
                    />
                    <span className="min-w-0 flex-1 truncate">{label.short}</span>
                    <span className="ml-2 shrink-0 text-muted-foreground text-xs">
                      {label.status}
                    </span>
                  </button>
                );
              })}
              {sessions.hasNextPage ? (
                <Button
                  className="mt-1 min-w-0 shrink-0"
                  disabled={sessions.isFetchingNextPage}
                  onClick={() => void sessions.fetchNextPage()}
                  size="sm"
                  variant="ghost"
                >
                  {sessions.isFetchingNextPage ? (
                    <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                  ) : (
                    <ChevronDown aria-hidden="true" className="size-3.5" />
                  )}
                  <span className="truncate">
                    {sessions.isFetchingNextPage
                      ? messages.common.loading
                      : messages.search.loadMore}
                  </span>
                </Button>
              ) : null}
            </nav>
          </aside>
        )}

        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {active ? (
            <>
              <header className="flex min-w-0 items-center gap-2 border-b px-4 py-3">
                {/* Everything the hidden rail offers, folded into one control.
                  Only mounted while the rail is gone, so the two can never
                  present the same actions twice. */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      // Icon-only, so it needs a name of its own — without one
                      // this is an unlabelled button to a screen reader, and the
                      // only route to sessions / New session / back at this width.
                      aria-label={messages.agents.agentMenu}
                      className={`-ml-2 h-11 min-w-11 shrink-0 gap-1 px-2 py-1 ${
                        compactSessionNavigation ? "" : "@2xl/agent:hidden"
                      }`}
                      size="sm"
                      title={messages.agents.agentMenu}
                      variant="ghost"
                    >
                      <Bot className="size-4" />
                      <ChevronDown className="size-3 opacity-60" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-60">
                    <DropdownMenuItem className="min-h-11" onSelect={onBack}>
                      <ArrowLeft className="size-4" />
                      {messages.agents.backToAgents}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="min-h-11"
                      disabled={createSession.isPending || remoteNeedsReconnect}
                      onSelect={() => createSession.mutate({ slug: agentSlug })}
                    >
                      <MessageSquarePlus className="size-4" />
                      {messages.agents.newSession}
                    </DropdownMenuItem>
                    {/* The header's ••• menu is hidden at this width, so ending
                      the conversation folds in here rather than disappearing
                      with the rail. */}
                    {canEndSession ? (
                      <DropdownMenuItem
                        className="min-h-11"
                        disabled={endSession.isPending}
                        onSelect={() => setEndConfirmOpen(true)}
                        variant="destructive"
                      >
                        <PowerOff className="size-4" />
                        {messages.agents.endSession}
                      </DropdownMenuItem>
                    ) : null}
                    {agentSessions.length > 0 ? (
                      <>
                        <DropdownMenuSeparator />
                        <div
                          aria-label={messages.agents.sessionListLabel}
                          className="max-h-64 overflow-y-auto"
                          role="group"
                        >
                          {agentSessions.map((session) => {
                            const isActive = session.id === activeSessionId;
                            const label = sessionItemLabel(
                              session.createdAt,
                              session.status,
                              locale,
                              messages,
                            );
                            return (
                              <DropdownMenuItem
                                key={session.id}
                                aria-current={isActive ? "true" : undefined}
                                aria-label={label.accessible}
                                className="min-h-11"
                                data-testid="agent-session-item"
                                onSelect={() => setSelectedSessionId(session.id)}
                                title={label.accessible}
                              >
                                <Check
                                  aria-hidden="true"
                                  className={`size-3.5 shrink-0 ${isActive ? "opacity-100" : "opacity-0"}`}
                                />
                                <span className="min-w-0 flex-1 truncate">{label.short}</span>
                                <span className="shrink-0 text-muted-foreground text-xs">
                                  {label.status}
                                </span>
                              </DropdownMenuItem>
                            );
                          })}
                          {sessions.hasNextPage ? (
                            <DropdownMenuItem
                              className="min-h-11"
                              disabled={sessions.isFetchingNextPage}
                              onSelect={(event) => {
                                event.preventDefault();
                                void sessions.fetchNextPage();
                              }}
                            >
                              {sessions.isFetchingNextPage ? (
                                <Loader2 aria-hidden="true" className="size-3.5 animate-spin" />
                              ) : (
                                <ChevronDown aria-hidden="true" className="size-3.5" />
                              )}
                              {sessions.isFetchingNextPage
                                ? messages.common.loading
                                : messages.search.loadMore}
                            </DropdownMenuItem>
                          ) : null}
                        </div>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>

                <div className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-sm" title={agentName}>
                    {agentName}
                  </span>
                  <AcpSessionMeta
                    className="truncate text-muted-foreground text-xs"
                    title={chat.title}
                    usage={chat.usage}
                  />
                </div>
                {/* Session-scoped actions, at the width where the agent menu
                  above is hidden — the two must never offer the same action
                  twice. `@2xl` is the same breakpoint the rail appears at. */}
                {!compactSessionNavigation && canEndSession ? (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        aria-label={messages.agents.sessionActions}
                        className="hidden size-11 shrink-0 text-muted-foreground @2xl/agent:inline-flex"
                        size="icon-sm"
                        title={messages.agents.sessionActions}
                        type="button"
                        variant="ghost"
                      >
                        <MoreHorizontal className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        className="min-h-11"
                        disabled={endSession.isPending}
                        onSelect={() => setEndConfirmOpen(true)}
                        variant="destructive"
                      >
                        <PowerOff className="size-4" />
                        {messages.agents.endSession}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                ) : null}
                {onOpenInSidePanel ? (
                  <Button
                    aria-label={messages.agents.openInSidePanel}
                    className="size-11 shrink-0 text-muted-foreground"
                    onClick={() => onOpenInSidePanel(active.id, agentName)}
                    size="icon-sm"
                    title={messages.agents.openInSidePanel}
                    type="button"
                    variant="ghost"
                  >
                    <PanelRight className="size-4" />
                  </Button>
                ) : null}
              </header>

              {active.error && shouldRenderAgentMessage(active.error) ? (
                <p
                  role="alert"
                  className="min-w-0 break-words border-b bg-destructive/10 px-4 py-2 text-destructive text-sm"
                >
                  {presentCoreError(
                    messages,
                    locale,
                    new Error(active.error),
                    messages.agents.continueConversationFailed,
                  )}
                </p>
              ) : null}

              {continuationError && shouldRenderAgentMessage(continuationError) ? (
                <p
                  role="alert"
                  className="min-w-0 break-words border-b bg-destructive/10 px-4 py-2 text-destructive text-sm"
                >
                  {continuationError}
                </p>
              ) : null}

              <AcpConversation
                labels={{
                  permissionAnswered: messages.agents.permissionAnswered,
                  permissionTimeout: (count) => fmt(messages.agents.permissionTimeout, { count }),
                  permissionTimingOut: messages.agents.permissionTimingOut,
                  toolStatuses: {
                    "approval-requested": messages.agents.toolStatusApprovalRequested,
                    "approval-responded": messages.agents.toolStatusApprovalResponded,
                    "input-available": messages.agents.toolStatusRunning,
                    "input-streaming": messages.agents.toolStatusPending,
                    "output-available": messages.agents.toolStatusCompleted,
                    "output-denied": messages.agents.toolStatusDenied,
                    "output-error": messages.agents.toolStatusError,
                  },
                  tools: {
                    explored: (count) =>
                      fmt(messages.agents.toolsExplored, {
                        count,
                        plural: count === 1 ? "" : "s",
                      }),
                    searched: (count) =>
                      fmt(messages.agents.toolsSearched, {
                        count,
                        plural: count === 1 ? "" : "es",
                      }),
                    edited: (count) =>
                      fmt(messages.agents.toolsEdited, {
                        count,
                        plural: count === 1 ? "" : "s",
                      }),
                    ran: (count) =>
                      fmt(messages.agents.toolsRan, {
                        count,
                        plural: count === 1 ? "" : "s",
                      }),
                    usedTools: (count) =>
                      fmt(messages.agents.toolsUsed, {
                        count,
                        plural: count === 1 ? "" : "s",
                      }),
                  },
                  reasoning: {
                    thinking: messages.agents.thinking,
                    brief: messages.agents.briefReasoning,
                    duration: (seconds) =>
                      fmt(messages.agents.reasoningDuration, { count: seconds }),
                  },
                }}
                blocks={chat.blocks}
                className="min-h-0 min-w-0 flex-1"
                streaming={promptActivity.active}
                activity={
                  showActivityIndicator ? (
                    <AgentActivityIndicator label={activityLabel} />
                  ) : undefined
                }
                onAnswerPermission={chat.answerPermission}
                emptyTitle={messages.agents.conversationConnectedTitle}
                emptyDescription={messages.agents.conversationConnectedBody}
              />

              <AcpComposer
                labels={{
                  attachFile: messages.agents.attachFile,
                  removeAttachment: messages.agents.removeAttachment,
                  submitPrompt: messages.agents.submitPrompt,
                  stopPrompt: messages.agents.stopPrompt,
                  fileTooLarge: (limit) => fmt(messages.agents.fileTooLarge, { limit }),
                  tooManyFiles: (count) => fmt(messages.agents.tooManyFiles, { count }),
                  attachmentFailed: messages.agents.attachmentFailed,
                }}
                className="min-w-0 shrink-0 p-3"
                draft={draft}
                onDraftApplied={onDraftApplied}
                disabled={isComposerDisabled(
                  active.status,
                  promptActivity.active,
                  setConfigOption.isPending,
                )}
                headerControls={
                  activeContextNode ? (
                    <AgentContextChip
                      node={activeContextNode}
                      onDismiss={() => setDismissedContextId(activeContextNode.id)}
                    />
                  ) : undefined
                }
                footerControls={
                  active.modelOption ? (
                    <ModelSelectorRow
                      modelOption={active.modelOption}
                      disabled={setConfigOption.isPending || active.status !== "idle"}
                      error={
                        setConfigOption.error
                          ? presentCoreError(
                              messages,
                              locale,
                              setConfigOption.error,
                              messages.agents.continueConversationFailed,
                            )
                          : undefined
                      }
                      onChange={(value) =>
                        setConfigOption.mutate({
                          sessionId: active.id,
                          configId: active.modelOption?.id ?? "",
                          value,
                        })
                      }
                    />
                  ) : undefined
                }
                onSend={send}
                placeholder={
                  active.status === "waiting_permission"
                    ? messages.agents.composerWaitingPlaceholder
                    : fmt(messages.agents.composerDefaultPlaceholder, { name: agentName })
                }
                // Available through `starting` too: the backend can cancel a
                // prompt waiting for ACP readiness without ending the durable
                // conversation, so every active composer state has a real Stop.
                onStop={chat.cancel}
                sending={promptActivity.active}
              />
            </>
          ) : (
            <div className="flex min-w-0 flex-1 items-center justify-center p-8 text-center">
              <div className="max-w-sm">
                <Bot className="mx-auto size-8 text-muted-foreground" />
                <h3 className="mt-3 font-medium">{messages.agents.noSessionsTitle}</h3>
                <p className="mt-1 text-muted-foreground text-sm">
                  {fmt(messages.agents.noSessionsBody, { name: agentName })}
                </p>
                <Button
                  className="mt-3"
                  disabled={createSession.isPending}
                  onClick={() => createSession.mutate({ slug: agentSlug })}
                >
                  <MessageSquarePlus className="size-4" />
                  {messages.agents.newSession}
                </Button>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Outside the `@container/agent` div on purpose: `container-type`
          applies layout containment, which makes that element the containing
          block for `position: fixed` descendants — the dialog would then be
          pinned to (and clipped by) the agent panel instead of the viewport. */}
      <ConfirmActionDialog
        body={
          active
            ? fmt(
                active.status === "busy" || active.status === "waiting_permission"
                  ? messages.agents.endSessionBusyBody
                  : messages.agents.endSessionBody,
                { name: agentName },
              )
            : ""
        }
        confirmLabel={messages.agents.endSession}
        onCancel={() => setEndConfirmOpen(false)}
        onConfirm={() => {
          if (active) endSession.mutate({ sessionId: active.id });
        }}
        open={endConfirmOpen && active !== null}
        pending={endSession.isPending}
        title={messages.agents.endSessionTitle}
      />
    </>
  );
}

/**
 * "You have this node open — I'll mention it."
 *
 * Rendered as the shared composer's `headerControls`, inside the same bordered
 * `InputGroup` as the textarea — the composer is shared with acprouter
 * (`@acp-ui/web`), which has no notion of a workspace node, so the chip itself
 * stays here rather than in the shared component, which stays as dumb as its
 * README promises.
 *
 * Removable, and says what it does before it does it — the alternative (silently
 * appending a line to what someone wrote) is the kind of helpfulness people
 * discover only by reading their own message back in a transcript.
 */
function AgentContextChip({ node, onDismiss }: { node: LoadedNode; onDismiss: () => void }) {
  const messages = useCoreI18n();
  return (
    // No border/padding of its own — `PromptInputHeader`'s addon already
    // draws the composer's one bordered surface and its own spacing, so a
    // second divider here would recreate the double-divider this chip moved
    // inside the composer to avoid.
    // The hint is the row's `title`, keeping the compact chip focused on the
    // node name while the tooltip explains what including it will do.
    // `aria-label` carries the same hint to screen readers and touch, which
    // never see a `title` tooltip.
    <div
      aria-label={messages.agents.contextChipHint}
      className="flex w-full min-w-0 items-center gap-2 text-xs"
      role="group"
      title={messages.agents.contextChipHint}
    >
      <span className="flex min-w-0 items-center gap-1 rounded-md border bg-muted/50 px-2 py-0.5">
        <AtSign className="size-3 shrink-0 text-muted-foreground" />
        <span className="min-w-0 truncate font-medium">{node.name}</span>
        <button
          aria-label={messages.agents.contextChipRemove}
          className="-my-2 -mr-2 ml-0.5 inline-flex size-11 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          onClick={onDismiss}
          title={messages.agents.contextChipRemove}
          type="button"
        >
          <X className="size-3" />
        </button>
      </span>
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
  // Only the panel reads this: it is the instance that sits beside an open node.
  const contextNode = useCurrentNodeStore((state) => state.node);
  const onDraftApplied = useCallback(
    (id: string) => consumeAgentChatDraft(agentSlug, id),
    [agentSlug],
  );
  return (
    <AgentDetailView
      agentSlug={agentSlug}
      compactSessionNavigation
      contextNode={contextNode}
      draft={draft ?? null}
      initialSessionId={sessionId}
      onBack={() => useSidePanelStore.getState().closeTab(agentChatTabId(agentSlug))}
      onDraftApplied={onDraftApplied}
      orpc={orpc}
    />
  );
}
registerSidePanelTab(AGENT_CHAT_TAB_TYPE, AgentChatSidePanelTab);
