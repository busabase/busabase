"use client";

import type { AcpAttachment, AcpBlock } from "@acp-ui/core/reduce";
import { AcpComposer, type AcpComposerDraft } from "@acp-ui/web/composer";
import { AcpSessionMeta } from "@acp-ui/web/session-meta";
import { AcpConversation } from "@acp-ui/web/transcript";
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hasApiKeyLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AgentSessionVO } from "busabase-contract/domains/agents/types";
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { type CoreI18nMessages, fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { presentCoreError } from "../../../i18n/localize-error";
import { useAgentIntegrationTarget } from "../../dashboard/agent-integration-context";
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
import { useAgentModelScope } from "../agent-model-scope-context";
import { type AgentSessionStatusUpdate, useAgentSession } from "../hooks/use-agent-session";
import {
  agentModelCatalogScope,
  toAgentModelCatalogEntry,
  toAgentModelCatalogTombstone,
  useAgentModelListStore,
} from "../store/agent-model-list-store";
import { withNodeContext } from "../utils/agent-message-context";
import { sendOrContinueAgentPrompt } from "../utils/agent-session-continuation";
import { shouldRenderAgentMessage } from "../utils/agent-visible-message";
import {
  getPromptActivityState,
  isComposerDisabled,
  isModelSelectorDisabled,
} from "../utils/prompt-activity";
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

interface PendingTurnState {
  operationId: number;
  previousUserBlockIds: string[];
}

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

/**
 * Overlay a locally-known session onto the server-derived list so it is
 * visible the instant a mutation resolves, without writing into the query
 * cache: `bridged` wins over any row the query already carries for the same
 * id (a response can be stricter/fresher than a 4s-stale poll), and is
 * prepended when the list doesn't have it yet. Retire the bridge once a
 * query response actually contains it — see the `useEffect` below — so a
 * later authoritative refetch is what ends up owning that row, never this
 * overlay.
 */
const overlaySessionBridge = (
  sessions: readonly AgentSessionVO[],
  bridged: AgentSessionVO | null,
): AgentSessionVO[] => {
  if (!bridged) return [...sessions];
  const withoutBridged = sessions.filter((session) => session.id !== bridged.id);
  return [bridged, ...withoutBridged];
};

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
export function AgentDetailView(props: AgentDetailViewProps) {
  const scope = useAgentModelScope();
  return <AgentDetailViewContent key={JSON.stringify([scope, props.agentSlug])} {...props} />;
}

function AgentDetailViewContent({
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
  /**
   * The session a `create`/`setConfigOption` response just confirmed, kept
   * here — not in the query cache — until a real query response contains it.
   * `agentSessions` overlays this onto the server-derived list so the UI
   * reflects a mutation's result immediately without a `setQueryData` write
   * that an unrelated later refetch could then stomp on, or that could stomp
   * on a fresher concurrent refetch itself.
   */
  const [sessionBridge, setSessionBridge] = useState<AgentSessionVO | null>(null);
  const bridgeQueryTime = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // Mirrors `sessionBridge` for callbacks that must read its latest value
  // without taking it as a dependency — see `handleMetadataRefresh` below.
  // Depending on `sessionBridge` directly would give that callback a new
  // identity on every bridge update, and since it is passed into
  // `useAgentSession` as `onMetadataRefresh`, that would recreate the
  // `AcpSessionPort` and tear down/reopen the live subscription for no
  // reason other than a bridge write.
  const sessionBridgeRef = useRef(sessionBridge);
  useEffect(() => {
    sessionBridgeRef.current = sessionBridge;
  }, [sessionBridge]);
  /**
   * The subscription's live status for the active session, applied on top of
   * both the query-derived list and the session bridge above. Replaces the
   * previous `setQueryData` patch from `use-agent-session.ts`: a status
   * notification is a UI-only annotation now, not a cache write a refetch
   * could race. Cleared whenever the active session changes, since a status
   * notification is only ever about the session the subscription is open on.
   */
  const [statusOverlay, setStatusOverlay] = useState<AgentSessionStatusUpdate | null>(null);

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

  const applyStatusOverlay = useCallback(
    (session: AgentSessionVO): AgentSessionVO =>
      statusOverlay &&
      statusOverlay.sessionId === session.id &&
      // A poll that already landed a `lastActivityAt` at least as recent as
      // the overlay is, by definition, at least as fresh — defer to it so a
      // slow-to-retire overlay can never hold a session on a status the
      // server has since moved past.
      session.lastActivityAt <= statusOverlay.lastActivityAt
        ? {
            ...session,
            status: statusOverlay.status,
            lastActivityAt: statusOverlay.lastActivityAt,
            ...(statusOverlay.error ? { error: statusOverlay.error } : {}),
          }
        : session,
    [statusOverlay],
  );

  const agentSessions = useMemo(
    () =>
      overlaySessionBridge(
        [
          ...new Map(
            (sessions.data?.pages.flatMap((page) => page.items) ?? []).map((session) => [
              session.id,
              session,
            ]),
          ).values(),
        ],
        sessionBridge,
      ).map(applyStatusOverlay),
    [sessions.data, sessionBridge, applyStatusOverlay],
  );

  // Retire only after a query result newer than the mutation's snapshot.
  // Session activity timestamps do not advance for every config change.
  useEffect(() => {
    if (!sessionBridge) return;
    const pages = sessions.data?.pages.flatMap((page) => page.items) ?? [];
    const caughtUp = pages.find((item) => item.id === sessionBridge.id);
    if (
      caughtUp &&
      sessions.dataUpdatedAt > bridgeQueryTime.current &&
      caughtUp.lastActivityAt >= sessionBridge.lastActivityAt
    ) {
      setSessionBridge(null);
    }
  }, [sessionBridge, sessions.data, sessions.dataUpdatedAt]);

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

  // SSR and the first client render both see an empty, stable snapshot
  // (`skipHydration: true`); this is what reads the real one in afterward.
  useEffect(() => {
    if (!useAgentModelListStore.persist.hasHydrated()) {
      void useAgentModelListStore.persist.rehydrate();
    }
  }, []);

  const modelScope = useAgentModelScope();
  const catalogScope = useMemo(
    () =>
      agentModelCatalogScope(
        modelScope.host,
        modelScope.workspaceKey,
        modelScope.actorId,
        agentSlug,
      ),
    [modelScope, agentSlug],
  );
  const setCatalog = useAgentModelListStore((state) => state.setCatalog);
  const cachedCatalog = useAgentModelListStore((state) => state.getCatalog(catalogScope));
  const lastStatusSeqRef = useRef<number>(-1);
  // The highest metadata-refresh request generation issued so far. Each
  // `onMetadataRefresh` signal starts a new generation; a fetch that resolves
  // after a NEWER generation has already started must not write — the newer
  // signal means something has already superseded whatever that fetch saw.
  const metadataRequestGenerationRef = useRef(0);
  // The scope a request generation was issued under. A workspace/account
  // switch bumps `catalogScope` without necessarily bumping the generation
  // counter on its own, so this is checked independently before any write.
  const metadataRequestScopeRef = useRef(catalogScope);

  // A workspace/account switch changes `catalogScope` while this view can
  // stay mounted (the dashboard root re-renders the provider, not this
  // component). Everything keyed on the OLD scope — the bridge, the status
  // overlay, their fencing refs, and any metadata request already in
  // flight — must drop immediately: carrying any of it across the switch
  // could show one actor's in-flight session state, or write one actor's
  // confirmed catalog, under another actor's scope.
  useEffect(() => {
    setSessionBridge(null);
    setStatusOverlay(null);
    lastStatusSeqRef.current = -1;
    metadataRequestGenerationRef.current += 1;
    metadataRequestScopeRef.current = catalogScope;
  }, [catalogScope]);

  /**
   * Confirmed, live metadata only — never derived from whichever session the
   * user happens to be viewing, and never from a `create` response.
   *
   * Triggered exclusively by `use-agent-session`'s `onMetadataRefresh`
   * signal, which fires only on the subscription's own first-readiness and
   * config-option-update events — never on the plain 4s poll. On that
   * signal, this issues its OWN explicit RPC (not a derivation of the
   * component's current `active`/render state) to fetch this agent's fresh
   * session list, finds the row the signal was about, and — only if that
   * session is still the newest LIVE session for this agent (by
   * `lastActivityAt` among non-terminal rows, folding in the session bridge
   * so a just-created session counts immediately) — writes its `modelOption`
   * to the shared catalog, including an explicit `null` write when the fresh
   * row confirms no model option (a revoked capability must clear a stale
   * cached entry, not leave it standing).
   *
   * Request-generation fenced: a scope switch (handled above) or a NEWER
   * metadata-refresh signal for the same scope bumps the generation before
   * this resolves, and a stale generation's result is discarded rather than
   * written — ordering follows signal arrival, not RPC completion order.
   */
  const handleMetadataRefresh = useCallback(
    (signal: { sessionId: string; seq: number }) => {
      const generation = ++metadataRequestGenerationRef.current;
      const requestScope = catalogScope;
      metadataRequestScopeRef.current = requestScope;
      void orpc.agents.sessions.listPaged
        // `listPaged` sorts by `lastActivityAt` descending (same as the
        // unpaged `list`), so the newest-live session for this agent is
        // always on page 1 regardless of how many older sessions exist below
        // the cap — no need to page through everything. `limit` is capped at
        // 50 server-side (`ListAgentSessionsPagedInputSchema`); passing more
        // would fail input validation.
        .call({ slug: agentSlug, limit: 50 })
        .then((page) => {
          if (
            !mounted.current ||
            metadataRequestGenerationRef.current !== generation ||
            metadataRequestScopeRef.current !== requestScope
          ) {
            return;
          }
          const signaledSession = page.items.find((item) => item.id === signal.sessionId);
          if (
            !signaledSession ||
            !["idle", "busy", "waiting_permission"].includes(signaledSession.status)
          )
            return;
          // "Newest LIVE session for this agent" — not "the session the user
          // happens to have open". A historical, already-ready session the
          // user clicked into in the rail must never be mistaken for the
          // agent's current handshake just because it also satisfies
          // readiness; only the most-recently-active non-terminal session
          // (folding in the bridge, so a session this view just created wins
          // immediately even before the fresh query row's `lastActivityAt`
          // catches up) is allowed to write the catalog.
          const liveCandidates = [
            ...page.items,
            ...(sessionBridgeRef.current ? [sessionBridgeRef.current] : []),
          ].filter((item) => item.status !== "ended" && item.status !== "failed");
          const newestLive = liveCandidates.reduce<AgentSessionVO | null>(
            (newest, item) =>
              !newest || item.lastActivityAt > newest.lastActivityAt ? item : newest,
            null,
          );
          if (!newestLive || newestLive.id !== signaledSession.id) return;
          setSessionBridge(signaledSession);
          setCatalog(
            requestScope,
            signaledSession.modelOption
              ? toAgentModelCatalogEntry(
                  signaledSession.modelOption,
                  signaledSession.lastActivityAt,
                )
              : toAgentModelCatalogTombstone(signaledSession.lastActivityAt),
          );
        })
        .catch(() => {
          // Best-effort refresh: a failed fetch leaves the existing cached
          // catalog (or lack thereof) exactly as it was. The next readiness
          // or config-option signal gets another chance; there is nothing
          // useful to surface to the user over a missed background refresh.
        });
    },
    [agentSlug, catalogScope, orpc, setCatalog],
  );

  const createSession = useMutation({
    ...orpc.agents.sessions.create.mutationOptions(),
    onSuccess: (session: AgentSessionVO) => {
      if (!mounted.current) return;
      // Bridge the response into the rendered list immediately — it already
      // carries the (provisional) `modelOption` from PUL-307's connecting-state
      // cache — rather than waiting on the invalidation below. `agentSessions`,
      // and so `active`, is derived from this bridge plus the two queries, so
      // without it a newly created session falls back to the previous
      // `activeSessionId` (or null) until the refetch lands, and the composer
      // footer shows the PREVIOUS session's model, or none, for that window.
      // The persisted catalog itself is NOT written here — only
      // `handleMetadataRefresh`'s own fresh RPC fetch, triggered by the
      // subscription's first-readiness signal once ACP actually connects, is
      // trusted to confirm it.
      bridgeQueryTime.current = sessions.dataUpdatedAt;
      setSessionBridge(session);
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
      if (!mounted.current) return;
      // Bridge the response into the rendered list immediately for the same
      // reason session creation does. The persisted catalog write still
      // comes only from `handleMetadataRefresh`, driven by this mutation's
      // own `config_option_update` event on the subscription — not from this
      // response directly — so the same newest-live-session fence applies
      // uniformly to every write path instead of this mutation getting a
      // shortcut around it.
      metadataRequestGenerationRef.current += 1;
      bridgeQueryTime.current = sessions.dataUpdatedAt;
      setSessionBridge(session);
      handleMetadataRefresh({ sessionId: session.id, seq: 0 });
      void refreshSessionLists();
    },
  });

  /**
   * Covers both known-terminal sessions and the stale-cache window where the
   * backend became terminal after the latest list poll. Every send goes
   * through the continuation helper so the prompt RPC's pre-record rejection,
   * rather than a four-second-old status, is authoritative. Pending operations
   * stay keyed by session so switching conversations neither double-sends nor
   * inherits another session's activity, progress baseline, or error.
   */
  const [pendingTurns, setPendingTurns] = useState<Record<string, PendingTurnState>>({});
  const [continuationErrors, setContinuationErrors] = useState<Record<string, string>>({});
  const turnOperationCounter = useRef(0);
  const activePendingTurn = activeSessionId ? pendingTurns[activeSessionId] : undefined;
  const continuing = activePendingTurn !== undefined;
  const continuationError = activeSessionId ? (continuationErrors[activeSessionId] ?? null) : null;

  // Transcript, prompting and permission answering are all `@acp-ui/core`, the
  // same interaction core acprouter drives — only the transport below it is
  // busabase's own.
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const targetSpaceId = useAgentIntegrationTarget()?.targetSpaceId;
  const handleStatusUpdate = useCallback((update: AgentSessionStatusUpdate) => {
    // Reject a replayed-but-stale status: the subscription resumes from
    // `afterSeq` on every reconnect, so a seq at or below the last one
    // already applied is a redelivery, not new information, and applying it
    // again could stomp a status a newer poll has since reported.
    if (update.seq <= lastStatusSeqRef.current) return;
    lastStatusSeqRef.current = update.seq;
    setStatusOverlay(update);
  }, []);
  const chat = useAgentSession(
    orpc,
    activeSessionId,
    sessionListOptions.queryKey,
    handleStatusUpdate,
    handleMetadataRefresh,
  );
  // A status notification only ever concerns the session the subscription is
  // currently open on. Switching sessions must not let the previous one's
  // last-known status linger and get applied to the newly active row.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only the trigger (activeSessionId changing) matters, not a value read in the body.
  useEffect(() => {
    setStatusOverlay(null);
    lastStatusSeqRef.current = -1;
  }, [activeSessionId]);
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
    activePendingTurn === undefined
      ? hasAgentProgressAfterLatestUserMessage(chat.blocks)
      : hasAgentProgressForPendingTurn(chat.blocks, activePendingTurn.previousUserBlockIds);
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

  // A prompt response can be lost after the server accepted it (the reported
  // reverse-proxy 504 is exactly that ambiguous outcome). Once the subscribed
  // session says this turn is running, that status is authoritative: retract
  // the stale send error instead of showing "couldn't continue" beside an
  // endless-looking "replying" indicator.
  useEffect(() => {
    if (
      !activeSessionId ||
      (active?.status !== "busy" && active?.status !== "waiting_permission")
    ) {
      return;
    }
    setContinuationErrors((previous) => {
      if (!(activeSessionId in previous)) return previous;
      const next = { ...previous };
      delete next[activeSessionId];
      return next;
    });
  }, [active?.status, activeSessionId]);

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
      const body = withNodeContext(text, activeContextNode, locale, targetSpaceId);
      const operationId = ++turnOperationCounter.current;
      let operationSessionId = active.id;
      const operationSessionIds = new Set([operationSessionId]);
      setContinuationErrors((previous) => {
        if (!(operationSessionId in previous)) return previous;
        const next = { ...previous };
        delete next[operationSessionId];
        return next;
      });
      setPendingTurns((previous) => ({
        ...previous,
        [operationSessionId]: { operationId, previousUserBlockIds: currentUserBlockIds },
      }));
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
            const previousSessionId = operationSessionId;
            operationSessionId = sessionId;
            operationSessionIds.add(sessionId);
            setPendingTurns((previous) => {
              return {
                ...previous,
                [sessionId]: { operationId, previousUserBlockIds: [] },
              };
            });
            setContinuationErrors((previous) => {
              if (!(sessionId in previous)) return previous;
              const next = { ...previous };
              delete next[sessionId];
              return next;
            });
            setSelectedSessionId(sessionId);
            await refreshSessionLists();
            setPendingTurns((previous) => {
              if (previous[previousSessionId]?.operationId !== operationId) return previous;
              const next = { ...previous };
              delete next[previousSessionId];
              return next;
            });
          },
        },
        { sessionId: active.id, status: active.status },
        agentSlug,
        body,
        attachments,
      )
        .then(refreshSessionLists)
        .catch((error: unknown) => {
          const message = presentCoreError(
            messages,
            locale,
            error,
            messages.agents.continueConversationFailed,
          );
          setContinuationErrors((previous) => ({
            ...previous,
            [operationSessionId]: message,
          }));
        })
        .finally(() => {
          setPendingTurns((previous) => {
            const next = { ...previous };
            let changed = false;
            for (const sessionId of operationSessionIds) {
              if (next[sessionId]?.operationId !== operationId) continue;
              delete next[sessionId];
              changed = true;
            }
            return changed ? next : previous;
          });
        });
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
      targetSpaceId,
    ],
  );

  const agentName = active?.agentName ?? agentSessions[0]?.agentName ?? agentSlug;
  const transport = active?.transport ?? agentSessions[0]?.transport ?? "local-subprocess";
  const remoteNeedsReconnect =
    transport === "remote-websocket" &&
    connections.data !== undefined &&
    !connections.data.some((connection) => connection.slug === agentSlug && connection.connected);

  /**
   * Shown while no confirmed `modelOption` exists yet (startup, or before any
   * session for this agent has ever answered). Built from the id/name/options
   * triple only — never a remembered `currentValue` — because the cache can
   * only ever answer "what choices does this agent generally offer", not
   * "what is THIS session's live selection". Remote startup choices are
   * applied only after the server confirms readiness and validates them.
   */
  const cachedModelPreview = useMemo(
    () =>
      active?.modelOption || !cachedCatalog || cachedCatalog.configId === null
        ? null
        : {
            id: cachedCatalog.configId,
            name: cachedCatalog.name,
            // Deliberately NOT `cachedCatalog.options[0]?.value`: the cache
            // never recorded which option this session actually had selected
            // (see `AgentModelCatalogEntry`'s doc comment), so inferring one
            // from list order would show a choice nobody confirmed. An empty,
            // unconfirmed placeholder is correct here — `ModelSelectorRow` is
            // rendered `disabled` in this branch regardless (see `disabled`
            // below), so there is no selected-looking affordance to mislead.
            currentValue: "",
            options: cachedCatalog.options,
          },
    [active?.modelOption, cachedCatalog],
  );
  const displayModelOption = active?.modelOption ?? cachedModelPreview;

  if (sessions.isPending && !sessionBridge) {
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
                  displayModelOption ? (
                    <ModelSelectorRow
                      modelOption={displayModelOption}
                      disabled={
                        !active ||
                        isModelSelectorDisabled(
                          active.status,
                          active.transport,
                          setConfigOption.isPending,
                        )
                      }
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
                          configId: displayModelOption.id,
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
                availableCommands={chat.availableCommands}
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
