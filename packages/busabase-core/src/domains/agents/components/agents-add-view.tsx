"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AgentCatalogEntryVO, AgentSessionVO } from "busabase-contract/domains/agents/types";
import { Badge } from "kui/badge";
import { Button } from "kui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "kui/dialog";
import { ArrowLeft, Bot } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type CoreI18nMessages,
  type CoreLocale,
  coreMessagesEn,
  fmt,
  useCoreI18n,
  useCoreLocale,
} from "../../../i18n";
import { budaOauthText } from "../../../i18n/buda-oauth-copy";
import { presentCoreError } from "../../../i18n/localize-error";
import { DialogContent } from "../../dashboard/components/localized-dialog-content";
import {
  type DesktopAgentSlug,
  type DesktopAgentStatus,
  requestDesktopAgent,
} from "../utils/desktop-codex";
import { readRouterOauthOrigin } from "../utils/router-oauth-origin";
import { AgentLoadingState, AgentQueryErrorState } from "./agent-query-state";
import { RouterEnrollmentDialog } from "./router-enrollment-dialog";
import { TransportBadge } from "./transport-badge";

interface AgentsAddViewProps {
  orpc: BusabaseQueryUtils;
  onBack: () => void;
  onConnected: (slug: string) => void;
  spaceId?: string;
}

export const catalogDescription = (entry: AgentCatalogEntryVO, messages: CoreI18nMessages) => {
  const key =
    entry.slug === "claude-acp"
      ? "catalogClaudeDescription"
      : entry.slug === "codex-acp"
        ? "catalogCodexDescription"
        : entry.slug === "buda"
          ? "catalogBudaDescription"
          : null;
  // Registry-provided and user-authored descriptions remain source metadata.
  return key && entry.description === coreMessagesEn.agents[key]
    ? messages.agents[key]
    : entry.description;
};

/** `true` when the reason describes an expected host limitation, not a failure. */
export const isExpectedLimitation = (reason: string | null): boolean =>
  reason === coreMessagesEn.agents.unavailableOnCloud || reason === "Coming soon.";

/**
 * `true` when the card renders no usable action — matches the final `else`
 * branch below (no button, just an unavailable-reason message), plus the two
 * other branches that intentionally show a disabled control: `comingSoon`
 * (text only) and an already-added local agent (button present but disabled).
 * `isDesktopAgentAvailable` mirrors the render's `desktopAgentEntry` check,
 * which overrides `available` for a locally-detected Codex/Claude install.
 */
export const isCardDisabled = (
  entry: Pick<AgentCatalogEntryVO, "available" | "comingSoon" | "connectionRequired">,
  isAlreadyAdded: boolean,
  isDesktopAgentAvailable = false,
): boolean =>
  entry.comingSoon ||
  isAlreadyAdded ||
  (!entry.available && !isDesktopAgentAvailable && !entry.connectionRequired && !entry.comingSoon);

/**
 * Actionable cards first, disabled ones last — relative order within each
 * group is preserved (stable sort), so Buda's existing lead position ahead of
 * disabled local agents carries through unchanged, and so does catalog order
 * otherwise.
 */
export const sortCatalogEntries = (
  entries: AgentCatalogEntryVO[],
  isEntryDisabled: (entry: AgentCatalogEntryVO) => boolean,
): AgentCatalogEntryVO[] =>
  [...entries].sort((a, b) => Number(isEntryDisabled(a)) - Number(isEntryDisabled(b)));

export const localizeUnavailableReason = (
  reason: string | null,
  messages: CoreI18nMessages,
  locale: CoreLocale,
): string => {
  if (reason === coreMessagesEn.agents.unavailableOnCloud) {
    return messages.agents.unavailableOnCloud;
  }
  if (reason === coreMessagesEn.agents.budaEnvRequired) {
    return messages.agents.budaEnvRequired;
  }
  if (reason === coreMessagesEn.agents.budaSignInRequired) {
    return messages.agents.budaSignInRequired;
  }
  if (reason === "Coming soon.") return messages.agents.comingSoon;

  const missingBinary =
    /^`([^`]+)` was not found on this machine\. Install Node\.js to use (.+)\.$/.exec(reason ?? "");
  if (missingBinary) {
    return fmt(messages.agents.missingLocalBinary, {
      binary: locale === "en" ? `\`${missingBinary[1]}\`` : (missingBinary[1] ?? ""),
      name: missingBinary[2] ?? "",
    });
  }
  return presentCoreError(
    messages,
    locale,
    reason ? new Error(reason) : null,
    messages.agents.unavailableFallback,
  );
};

/** Browse the catalog and connect one. This is the only place the catalog is shown. */
export function AgentsAddView({ orpc, onBack, onConnected, spaceId }: AgentsAddViewProps) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const queryClient = useQueryClient();
  const catalog = useQuery(orpc.agents.catalog.queryOptions());
  const connections = useQuery(
    orpc.agents.connections.list.queryOptions({ input: { scope: "mine" } }),
  );
  const [showBudaConnect, setShowBudaConnect] = useState(false);
  const [budaError, setBudaError] = useState<string | null>(null);
  const [budaAuthorizing, setBudaAuthorizing] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionErrorEntrySlug, setSessionErrorEntrySlug] = useState<string | null>(null);
  const [desktopAgents, setDesktopAgents] = useState<
    Partial<Record<DesktopAgentSlug, DesktopAgentStatus>>
  >({});
  const [installSlug, setInstallSlug] = useState<DesktopAgentSlug | null>(null);
  const [agentInstalling, setAgentInstalling] = useState(false);
  const budaTriggerRef = useRef<HTMLElement | null>(null);
  const budaWorkspace = useRef(spaceId);
  const budaAuthorization = useRef<{
    popup: Window;
    origin: string;
    flowId: string;
    expiresAt: number;
  } | null>(null);
  const clearBudaAuthorization = useCallback((close = false) => {
    const attempt = budaAuthorization.current;
    budaAuthorization.current = null;
    if (close) attempt?.popup.close();
    setBudaAuthorizing(false);
  }, []);
  const addedAgentSlugs = new Set((connections.data ?? []).map((connection) => connection.slug));

  useEffect(() => {
    if (budaWorkspace.current !== spaceId) {
      budaWorkspace.current = spaceId;
      clearBudaAuthorization(true);
      setShowBudaConnect(false);
      setBudaError(null);
    }
  }, [spaceId, clearBudaAuthorization]);

  useEffect(
    () => () => {
      budaAuthorization.current?.popup.close();
      budaAuthorization.current = null;
    },
    [],
  );

  useEffect(() => {
    let active = true;
    for (const slug of ["codex-acp", "claude-acp"] as const) {
      void requestDesktopAgent(slug, "status")
        .then((status) => {
          if (active && status) setDesktopAgents((previous) => ({ ...previous, [slug]: status }));
        })
        .catch(() => undefined);
    }
    return () => {
      active = false;
    };
  }, []);

  const connectDesktopAgent = async (slug: DesktopAgentSlug) => {
    setSessionErrorEntrySlug(slug);
    setSessionError(null);
    try {
      const status = await requestDesktopAgent(slug, "status");
      if (!status) return;
      setDesktopAgents((previous) => ({ ...previous, [slug]: status }));
      if (!status.installed) {
        setInstallSlug(slug);
      } else if (status.auth !== "ready") {
        setSessionError(
          slug === "claude-acp"
            ? messages.agents.claudeLoginRequired
            : status.auth === "missing"
              ? messages.agents.codexCliMissing
              : messages.agents.codexLoginRequired,
        );
      } else {
        createSession.mutate({ slug });
      }
    } catch (error) {
      setSessionError(
        presentCoreError(messages, locale, error, messages.agents.sessionCreateFailed),
      );
    }
  };

  const installDesktopAgent = async () => {
    if (agentInstalling || !installSlug) return;
    const slug = installSlug;
    setAgentInstalling(true);
    setSessionError(null);
    try {
      const status = await requestDesktopAgent(slug, "install");
      if (!status?.installed) throw new Error("ACP installation did not complete.");
      setDesktopAgents((previous) => ({ ...previous, [slug]: status }));
      setInstallSlug(null);
      void queryClient.invalidateQueries({ queryKey: orpc.agents.catalog.queryKey() });
      if (status.auth !== "ready") {
        setSessionError(
          slug === "claude-acp"
            ? messages.agents.claudeLoginRequired
            : status.auth === "missing"
              ? messages.agents.codexCliMissing
              : messages.agents.codexLoginRequired,
        );
      } else {
        createSession.mutate({ slug });
      }
    } catch (error) {
      setSessionError(
        presentCoreError(messages, locale, error, messages.agents.sessionCreateFailed),
      );
    } finally {
      setAgentInstalling(false);
    }
  };

  const openBudaConnect = () => {
    if (budaAuthorization.current) return;
    if (!showBudaConnect && document.activeElement instanceof HTMLElement) {
      budaTriggerRef.current = document.activeElement;
    }
    setBudaError(null);
    setSessionError(null);
    setSessionErrorEntrySlug(null);
    setShowBudaConnect(true);
    const origin = readRouterOauthOrigin(window.location.origin);
    const flowId = window.crypto.randomUUID();
    const url = new URL("/api/agents/buda/oauth/start", origin);
    if (spaceId) url.searchParams.set("spaceId", spaceId);
    url.searchParams.set("returnOrigin", window.location.origin);
    url.searchParams.set("flowId", flowId);
    const popup = window.open(
      url.toString(),
      `busabase-buda-oauth-${flowId}`,
      "popup,width=560,height=760",
    );
    if (!popup) {
      setBudaError(messages.agents.allowPopups);
      return;
    }
    budaAuthorization.current = { popup, origin, flowId, expiresAt: Date.now() + 600_000 };
    setBudaAuthorizing(true);
  };

  const createSession = useMutation({
    ...orpc.agents.sessions.create.mutationOptions(),
    onSuccess: (session: AgentSessionVO) => {
      setSessionError(null);
      setSessionErrorEntrySlug(null);
      void Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.agents.connections.list.queryKey({ input: { scope: "mine" } }),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.agents.connections.list.queryKey({ input: { scope: "space" } }),
        }),
        queryClient.invalidateQueries({ queryKey: orpc.agents.sessions.list.queryKey() }),
      ]);
      onConnected(session.slug);
    },
    onError: (error) => {
      setSessionError(
        presentCoreError(messages, locale, error, messages.agents.sessionCreateFailed),
      );
    },
  });

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const attempt = budaAuthorization.current;
      if (
        !attempt ||
        event.origin !== attempt.origin ||
        event.source !== attempt.popup ||
        event.data?.flowId !== attempt.flowId
      )
        return;
      if (event.data?.type === "busabase:buda-error") {
        clearBudaAuthorization();
        setBudaError(budaOauthText(locale, event.data.reason));
      } else if (event.data?.type === "busabase:buda-connected") {
        clearBudaAuthorization();
        if (typeof event.data.slug !== "string" || !event.data.slug) {
          setBudaError(messages.agents.budaIdentityMissing);
          return;
        }
        setShowBudaConnect(false);
        setBudaError(null);
        void queryClient.invalidateQueries({ queryKey: orpc.agents.catalog.queryKey() });
        setSessionErrorEntrySlug("buda");
        createSession.mutate({ slug: event.data.slug });
      }
    };
    const timer = window.setInterval(() => {
      const attempt = budaAuthorization.current;
      if (!attempt) return;
      if (Date.now() >= attempt.expiresAt) {
        clearBudaAuthorization(true);
        setBudaError(budaOauthText(locale, "expired"));
      } else if (attempt.popup.closed) {
        clearBudaAuthorization();
        setBudaError(budaOauthText(locale, "closed"));
        void queryClient.invalidateQueries({ queryKey: orpc.agents.catalog.queryKey() });
        void queryClient.invalidateQueries({
          queryKey: orpc.agents.connections.list.queryKey({ input: { scope: "mine" } }),
        });
      }
    }, 500);
    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(timer);
    };
  }, [
    clearBudaAuthorization,
    createSession,
    locale,
    messages,
    orpc.agents.catalog,
    orpc.agents.connections.list,
    queryClient,
  ]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex items-start gap-3 border-b px-4 py-4 sm:items-center sm:px-6">
        <Button className="min-h-11 shrink-0 sm:min-h-9" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="size-4" />
          {messages.agents.back}
        </Button>
        <h1 className="min-w-0 break-words pt-2 font-medium text-lg sm:pt-0">
          {messages.agents.addAgent}
        </h1>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto w-full max-w-5xl">
          {catalog.isPending ? (
            <AgentLoadingState />
          ) : catalog.isError ? (
            <AgentQueryErrorState
              error={catalog.error}
              onRetry={() => void catalog.refetch()}
              title={messages.agents.loadCatalogFailedTitle}
            />
          ) : (catalog.data ?? []).length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <Bot className="size-8 text-muted-foreground" />
              <div>
                <h2 className="font-medium">{messages.agents.catalogEmptyTitle}</h2>
                <p className="mt-1 text-muted-foreground text-sm">
                  {messages.agents.catalogEmptyBody}
                </p>
              </div>
              <Button
                className="min-h-11 sm:min-h-9"
                onClick={() => void catalog.refetch()}
                type="button"
                variant="outline"
              >
                {messages.agents.queryRetry}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-3">
              {sortCatalogEntries(catalog.data ?? [], (entry) =>
                isCardDisabled(
                  entry,
                  (entry.slug === "codex-acp" || entry.slug === "claude-acp") &&
                    addedAgentSlugs.has(entry.slug),
                  (entry.slug === "codex-acp" || entry.slug === "claude-acp") &&
                    desktopAgents[entry.slug] !== undefined,
                ),
              ).map((entry: AgentCatalogEntryVO) => {
                const pendingSlug = createSession.isPending
                  ? createSession.variables?.slug
                  : undefined;
                const desktopAgentEntry =
                  (entry.slug === "codex-acp" || entry.slug === "claude-acp") &&
                  desktopAgents[entry.slug] !== undefined;
                const isAlreadyAdded =
                  (entry.slug === "codex-acp" || entry.slug === "claude-acp") &&
                  addedAgentSlugs.has(entry.slug);
                const isUnavailable =
                  !entry.available &&
                  !entry.connectionRequired &&
                  !entry.comingSoon &&
                  !desktopAgentEntry;
                return (
                  <div
                    className={`flex h-full min-w-0 flex-col gap-3 break-words rounded-lg border p-4 ${
                      isUnavailable || isAlreadyAdded
                        ? "opacity-50 bg-muted/40 grayscale-[50%] transition-opacity hover:opacity-70"
                        : ""
                    }`}
                    data-agent-slug={entry.slug}
                    data-testid="agent-catalog-card"
                    key={entry.slug}
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="flex min-w-0 flex-1 basis-40 items-center gap-2 font-medium text-sm">
                          <Bot className="size-4 shrink-0" />
                          <span className="min-w-0 break-words">{entry.name}</span>
                        </span>
                        <span className="flex max-w-full flex-wrap items-center gap-1">
                          <TransportBadge transport={entry.transport} />
                          {entry.comingSoon && (
                            <Badge variant="secondary">{messages.agents.comingSoon}</Badge>
                          )}
                        </span>
                      </div>
                      <p className="text-muted-foreground text-xs">
                        {catalogDescription(entry, messages)}
                      </p>
                      {entry.connectedAgentName && entry.slug !== "buda" && (
                        <p className="text-muted-foreground text-xs">
                          {fmt(messages.agents.connectedTo, { name: entry.connectedAgentName })}
                        </p>
                      )}
                    </div>

                    <div className="mt-auto flex flex-col gap-2 pt-1">
                      {entry.comingSoon ? (
                        <p className="text-muted-foreground text-xs">
                          {messages.agents.integrationComingSoon}
                        </p>
                      ) : entry.slug === "acprouter" && entry.connectionRequired ? (
                        <RouterEnrollmentDialog
                          key={spaceId}
                          orpc={orpc}
                          spaceId={spaceId}
                          onConnected={onConnected}
                        />
                      ) : entry.slug === "buda" && entry.connectionRequired ? (
                        <Button
                          className="min-h-11 sm:min-h-9"
                          disabled={budaAuthorizing}
                          onClick={openBudaConnect}
                          size="sm"
                        >
                          {messages.agents.connectBuda}
                        </Button>
                      ) : entry.available || desktopAgentEntry ? (
                        <Button
                          className="min-h-11 sm:min-h-9"
                          disabled={createSession.isPending || isAlreadyAdded}
                          onClick={() => {
                            setSessionError(null);
                            setSessionErrorEntrySlug(entry.slug);
                            if (desktopAgentEntry)
                              void connectDesktopAgent(entry.slug as DesktopAgentSlug);
                            else createSession.mutate({ slug: entry.slug });
                          }}
                          size="sm"
                        >
                          {pendingSlug === entry.slug
                            ? messages.agents.statusConnecting
                            : messages.agents.connect}
                        </Button>
                      ) : entry.connectionRequired ? (
                        <Button className="min-h-11 sm:min-h-9" onClick={openBudaConnect} size="sm">
                          {messages.agents.signInBuda}
                        </Button>
                      ) : (
                        <p
                          className={
                            isExpectedLimitation(entry.unavailableReason)
                              ? "text-muted-foreground text-xs"
                              : "text-destructive text-xs"
                          }
                        >
                          {localizeUnavailableReason(entry.unavailableReason, messages, locale)}
                        </p>
                      )}
                      {sessionErrorEntrySlug === entry.slug && sessionError && (
                        <p className="text-destructive text-xs" role="alert">
                          {sessionError}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={installSlug !== null}
        onOpenChange={(open) => {
          if (!agentInstalling && !open) setInstallSlug(null);
        }}
      >
        <DialogContent className="sm:max-w-[440px]">
          <DialogHeader>
            <DialogTitle>
              {installSlug === "claude-acp"
                ? messages.agents.claudeInstallTitle
                : messages.agents.codexInstallTitle}
            </DialogTitle>
            <DialogDescription>
              {installSlug === "claude-acp"
                ? messages.agents.claudeInstallBody
                : messages.agents.codexInstallBody}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              disabled={agentInstalling}
              onClick={() => setInstallSlug(null)}
            >
              {messages.agents.codexInstallCancel}
            </Button>
            <Button disabled={agentInstalling} onClick={() => void installDesktopAgent()}>
              {agentInstalling
                ? installSlug === "claude-acp"
                  ? messages.agents.claudeInstalling
                  : messages.agents.codexInstalling
                : sessionError
                  ? messages.agents.codexInstallRetry
                  : messages.agents.codexInstallAction}
            </Button>
          </div>
          {installSlug && sessionError && (
            <p className="text-destructive text-xs" role="alert">
              {sessionError}
            </p>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        onOpenChange={(open) => {
          setShowBudaConnect(open);
          if (!open) {
            clearBudaAuthorization(true);
            window.setTimeout(() => budaTriggerRef.current?.focus(), 0);
          }
        }}
        open={showBudaConnect}
      >
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] overflow-y-auto sm:max-w-[440px]"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            budaTriggerRef.current?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>{messages.agents.connectBuda}</DialogTitle>
            <DialogDescription>{messages.agents.budaConnectHint}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">{messages.agents.budaConnectDescription}</p>
            <Button
              className="min-h-11 sm:min-h-9"
              disabled={budaAuthorizing}
              onClick={openBudaConnect}
            >
              {messages.agents.openBuda}
            </Button>
            {budaAuthorizing && (
              <p className="text-muted-foreground" role="status">
                {budaOauthText(locale, "waiting")}
              </p>
            )}
            {budaError && (
              <p className="text-destructive text-xs" role="alert">
                {budaError}
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
