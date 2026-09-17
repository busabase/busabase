"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AgentCatalogEntryVO, AgentSessionVO } from "busabase-contract/domains/agents/types";
import { Badge } from "kui/badge";
import { Button } from "kui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "kui/dialog";
import { ArrowLeft, Bot } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  type CoreI18nMessages,
  type CoreLocale,
  coreMessagesEn,
  fmt,
  useCoreI18n,
  useCoreLocale,
} from "../../../i18n";
import { presentCoreError } from "../../../i18n/localize-error";
import { DialogContent } from "../../dashboard/components/localized-dialog-content";
import { AgentLoadingState, AgentQueryErrorState } from "./agent-query-state";
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
  const [showBudaConnect, setShowBudaConnect] = useState(false);
  const [budaError, setBudaError] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionErrorEntrySlug, setSessionErrorEntrySlug] = useState<string | null>(null);
  const budaTriggerRef = useRef<HTMLElement | null>(null);

  const openBudaConnect = () => {
    if (!showBudaConnect && document.activeElement instanceof HTMLElement) {
      budaTriggerRef.current = document.activeElement;
    }
    setBudaError(null);
    setSessionError(null);
    setSessionErrorEntrySlug(null);
    setShowBudaConnect(true);
    const path = `/api/agents/buda/oauth/start${spaceId ? `?spaceId=${encodeURIComponent(spaceId)}` : ""}`;
    const popup = window.open(path, "busabase-buda-oauth", "popup,width=560,height=760");
    if (!popup) setBudaError(messages.agents.allowPopups);
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
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "busabase:buda-error") {
        setBudaError(
          presentCoreError(
            messages,
            locale,
            event.data.message ? new Error(String(event.data.message)) : null,
            messages.agents.budaConnectionFailed,
          ),
        );
      } else if (event.data?.type === "busabase:buda-connected") {
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
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [createSession, locale, messages, orpc.agents.catalog, queryClient]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
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
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {(() => {
                const entries = [...(catalog.data ?? [])];
                const localAgents = entries.filter((e) => e.transport === "local-subprocess");
                const areLocalAgentsDisabled =
                  localAgents.length > 0 &&
                  localAgents.every((e) => !e.available && !e.connectionRequired && !e.comingSoon);

                if (areLocalAgentsDisabled) {
                  const budaIndex = entries.findIndex((e) => e.slug === "buda");
                  if (budaIndex > -1) {
                    const [buda] = entries.splice(budaIndex, 1);
                    entries.unshift(buda);
                  }
                }
                return entries;
              })().map((entry: AgentCatalogEntryVO) => {
                const pendingSlug = createSession.isPending
                  ? createSession.variables?.slug
                  : undefined;
                const isUnavailable =
                  !entry.available && !entry.connectionRequired && !entry.comingSoon;
                return (
                  <div
                    className={`flex h-full flex-col gap-3 rounded-lg border p-4 ${
                      isUnavailable
                        ? "opacity-50 bg-muted/40 grayscale-[50%] transition-opacity hover:opacity-70"
                        : ""
                    }`}
                    data-agent-slug={entry.slug}
                    data-testid="agent-catalog-card"
                    key={entry.slug}
                  >
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="flex min-w-0 items-center gap-2 font-medium text-sm">
                          <Bot className="size-4 shrink-0" />
                          <span className="min-w-0 break-words">{entry.name}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-1">
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
                      ) : entry.slug === "buda" && entry.connectionRequired ? (
                        <Button className="min-h-11 sm:min-h-9" onClick={openBudaConnect} size="sm">
                          {messages.agents.connectBuda}
                        </Button>
                      ) : entry.available ? (
                        <Button
                          className="min-h-11 sm:min-h-9"
                          disabled={createSession.isPending}
                          onClick={() => {
                            setSessionError(null);
                            setSessionErrorEntrySlug(entry.slug);
                            createSession.mutate({ slug: entry.slug });
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
        onOpenChange={(open) => {
          setShowBudaConnect(open);
          if (!open) {
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
            <Button className="min-h-11 sm:min-h-9" onClick={openBudaConnect}>
              {messages.agents.openBuda}
            </Button>
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
