"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type {
  AgentConnectionScope,
  AgentConnectionVO,
  AgentSessionStatus,
} from "busabase-contract/domains/agents/types";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "kui/alert-dialog";
import { Button } from "kui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "kui/dropdown-menu";
import { Tabs, TabsList, TabsTrigger } from "kui/tabs";
import { Bot, MoreHorizontal, Plus, Trash2, Unplug } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { presentCoreError } from "../../../i18n/localize-error";
import { AgentLoadingState, AgentQueryErrorState } from "./agent-query-state";
import { TransportBadge } from "./transport-badge";

const statusLabel = (
  status: AgentSessionStatus,
  messages: ReturnType<typeof useCoreI18n>,
): string =>
  ({
    connecting: messages.agents.statusConnecting,
    idle: messages.agents.statusIdle,
    busy: messages.agents.statusBusy,
    waiting_permission: messages.agents.statusWaitingPermission,
    ended: messages.agents.statusEnded,
    failed: messages.agents.statusFailed,
  })[status];

interface AgentsListViewProps {
  orpc: BusabaseQueryUtils;
  onSelectAgent: (slug: string) => void;
  onAddAgent: () => void;
}

interface AgentActionConfirmDialogProps {
  body: string;
  cancelLabel: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  pending: boolean;
  pendingLabel: string;
  title: string;
}

function AgentActionConfirmDialog({
  body,
  cancelLabel,
  confirmLabel,
  onCancel,
  onConfirm,
  open,
  pending,
  pendingLabel,
  title,
}: AgentActionConfirmDialogProps) {
  return (
    <AlertDialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !pending) onCancel();
      }}
      open={open}
    >
      <AlertDialogContent className="w-[calc(100%-2rem)] max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-base">{title}</AlertDialogTitle>
          <AlertDialogDescription className="leading-6">{body}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:space-x-0">
          <AlertDialogCancel className="min-h-11 sm:min-h-9" disabled={pending}>
            {cancelLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            className="min-h-11 bg-rejected-strong text-background hover:bg-rejected-strong/90 sm:min-h-9"
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {pending ? pendingLabel : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * Connected agents and retained history. Browsing *what's connectable* lives
 * on the Add page (`AgentsAddView`); conversations are grouped by stable agent
 * slug so "3 conversations with Claude Code" reads as one card, not three.
 */
export function AgentsListView({ orpc, onSelectAgent, onAddAgent }: AgentsListViewProps) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<AgentConnectionScope>("mine");
  const [disconnecting, setDisconnecting] = useState<AgentConnectionVO | null>(null);
  const [deletingHistory, setDeletingHistory] = useState<AgentConnectionVO | null>(null);
  const connections = useQuery({
    ...orpc.agents.connections.list.queryOptions({ input: { scope } }),
    refetchInterval: 4000,
  });

  const disconnect = useMutation({
    ...orpc.agents.disconnect.mutationOptions(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.agents.connections.list.queryKey({ input: { scope: "mine" } }),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.agents.connections.list.queryKey({ input: { scope: "space" } }),
        }),
        queryClient.invalidateQueries({ queryKey: orpc.agents.sessions.list.queryKey() }),
        queryClient.invalidateQueries({ queryKey: orpc.agents.catalog.queryKey() }),
      ]);
      toast.success(messages.agents.connectionDeleted);
      setDisconnecting(null);
    },
    onError: (error) => {
      toast.error(
        presentCoreError(messages, locale, error, messages.agents.connectionDeleteFailed),
      );
    },
  });

  const deleteHistory = useMutation({
    ...orpc.agents.deleteHistory.mutationOptions(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.agents.connections.list.queryKey({ input: { scope: "mine" } }),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.agents.connections.list.queryKey({ input: { scope: "space" } }),
        }),
        queryClient.invalidateQueries({ queryKey: orpc.agents.sessions.list.queryKey() }),
      ]);
      toast.success(messages.agents.deleteHistoryDone);
      setDeletingHistory(null);
    },
    onError: (error) => {
      toast.error(presentCoreError(messages, locale, error, messages.agents.deleteHistoryFailed));
    },
  });

  const connectionItems = connections.data ?? [];
  const emptyTitle =
    scope === "mine" ? messages.agents.mineEmptyTitle : messages.agents.spaceEmptyTitle;
  const emptyBody =
    scope === "mine" ? messages.agents.mineEmptyBody : messages.agents.spaceEmptyBody;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="min-w-0">
          <h1 className="font-medium text-lg">{messages.agents.title}</h1>
          <p className="max-w-2xl text-muted-foreground text-sm">{messages.agents.description}</p>
        </div>
        <Button
          className="min-h-11 self-start sm:min-h-9 sm:self-auto"
          onClick={onAddAgent}
          size="sm"
        >
          <Plus className="size-4" />
          {messages.agents.addAgent}
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mx-auto w-full max-w-5xl">
          <Tabs
            value={scope}
            onValueChange={(value) => {
              if (value === "mine" || value === "space") setScope(value);
            }}
          >
            <TabsList className="mb-6">
              <TabsTrigger className="min-h-11 sm:min-h-9" value="mine">
                {messages.agents.mineTab}
              </TabsTrigger>
              <TabsTrigger className="min-h-11 sm:min-h-9" value="space">
                {messages.agents.spaceTab}
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {connections.isPending ? (
            <AgentLoadingState />
          ) : connections.isError ? (
            <AgentQueryErrorState
              error={connections.error}
              onRetry={() => void connections.refetch()}
              title={messages.agents.loadConnectionsFailedTitle}
            />
          ) : connectionItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <Bot className="size-8 text-muted-foreground" />
              <div>
                <h2 className="font-medium">{emptyTitle}</h2>
                <p className="mt-1 text-muted-foreground text-sm">{emptyBody}</p>
              </div>
              <Button className="min-h-11 sm:min-h-9" onClick={onAddAgent}>
                <Plus className="size-4" />
                {messages.agents.addAgent}
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {connectionItems.map((group) => (
                <div
                  className="relative flex flex-col rounded-lg border transition-colors hover:bg-accent"
                  data-agent-slug={group.slug}
                  data-testid="agent-connection-card"
                  key={group.slug}
                >
                  <button
                    className="flex min-h-24 w-full min-w-0 flex-col gap-2 rounded-lg p-4 pr-12 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    onClick={() => onSelectAgent(group.slug)}
                    type="button"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-2 font-medium text-sm">
                        <Bot className="size-4 shrink-0" />
                        <span className="min-w-0 break-words">{group.agentName}</span>
                      </span>
                      <TransportBadge transport={group.transport} />
                    </div>
                    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
                      <span className="text-muted-foreground">
                        {fmt(messages.agents.sessionCount, {
                          count: group.sessionCount,
                          unit:
                            group.sessionCount === 1
                              ? messages.agents.sessionOne
                              : messages.agents.sessionMany,
                        })}
                      </span>
                      <span aria-hidden="true" className="text-muted-foreground/60">
                        ·
                      </span>
                      <span className="font-medium text-foreground/80">
                        {group.latest
                          ? statusLabel(group.latest.status, messages)
                          : messages.agents.notStarted}
                      </span>
                    </p>
                  </button>
                  {(group.ownedByCurrentUser && group.connected) || group.sessionCount > 0 ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          aria-label={fmt(messages.agents.actionsFor, { name: group.agentName })}
                          className="absolute right-1 bottom-1 size-11 sm:right-2 sm:bottom-2 sm:size-8"
                          size="icon"
                          type="button"
                          variant="ghost"
                        >
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {group.connected && group.ownedByCurrentUser ? (
                          <DropdownMenuItem onSelect={() => setDisconnecting(group)}>
                            <Unplug className="mr-2 size-4" />
                            {messages.agents.disconnectAgent}
                          </DropdownMenuItem>
                        ) : null}
                        {group.sessionCount > 0 ? (
                          <DropdownMenuItem
                            onSelect={() => setDeletingHistory(group)}
                            variant="destructive"
                          >
                            <Trash2 className="mr-2 size-4" />
                            {messages.agents.deleteHistory}
                          </DropdownMenuItem>
                        ) : null}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <AgentActionConfirmDialog
        body={
          disconnecting
            ? fmt(messages.agents.deleteConnectionBody, {
                name: disconnecting.agentName,
                count: disconnecting.sessionCount,
                unit:
                  disconnecting.sessionCount === 1
                    ? messages.agents.sessionOne
                    : messages.agents.sessionMany,
              })
            : ""
        }
        cancelLabel={messages.common.cancel}
        confirmLabel={messages.agents.disconnectAgent}
        onCancel={() => setDisconnecting(null)}
        onConfirm={() => {
          if (disconnecting) disconnect.mutate({ slug: disconnecting.slug });
        }}
        open={disconnecting !== null}
        pending={disconnect.isPending}
        pendingLabel={messages.common.working}
        title={messages.agents.deleteConnectionTitle}
      />
      <AgentActionConfirmDialog
        body={
          deletingHistory
            ? fmt(messages.agents.deleteHistoryBody, {
                name: deletingHistory.agentName,
                count: deletingHistory.sessionCount,
                unit:
                  deletingHistory.sessionCount === 1
                    ? messages.agents.sessionOne
                    : messages.agents.sessionMany,
              }) +
              (deletingHistory.connected
                ? deletingHistory.transport === "local-subprocess"
                  ? messages.agents.deleteHistoryBodyEndsLocalSessions
                  : messages.agents.deleteHistoryBodyKeepsConnection
                : "")
            : ""
        }
        cancelLabel={messages.common.cancel}
        confirmLabel={messages.agents.deleteHistory}
        onCancel={() => setDeletingHistory(null)}
        onConfirm={() => {
          if (deletingHistory) deleteHistory.mutate({ slug: deletingHistory.slug });
        }}
        open={deletingHistory !== null}
        pending={deleteHistory.isPending}
        pendingLabel={messages.common.working}
        title={messages.agents.deleteHistoryTitle}
      />
    </div>
  );
}
