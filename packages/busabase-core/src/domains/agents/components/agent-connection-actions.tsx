"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AgentConnectionVO } from "busabase-contract/domains/agents/types";
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
import { Link2, MoreHorizontal, Pencil, Trash2, Unplug } from "lucide-react";
import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { agentConnectionCopy } from "../../../i18n/agent-connection-copy";
import { presentCoreError } from "../../../i18n/localize-error";
import { routerEnrollmentText } from "../../../i18n/router-enrollment-copy";
import { useAgentModelScope } from "../agent-model-scope-context";
import { agentModelCatalogScope, useAgentModelListStore } from "../store/agent-model-list-store";
import { AgentConnectionDialog } from "./agent-connection-dialog";

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
 * The one "More" menu + its dialogs/mutations, shared by every host that
 * lists `AgentConnectionVO` cards — today the main Agents inventory
 * (`AgentsListView`, both the "mine" and "space" tabs) and the right-side
 * `SidePanelAgentPicker`. A host owns fetching, scope, layout, and what a
 * card-body click does (`AgentConnectionList`'s `onSelect`); this hook owns
 * everything the "..." trigger can do instead — selected slug, trigger refs
 * for focus restoration, the connection-details dialog, both confirmation
 * dialogs, their mutations, and cache invalidation. Two hosts calling this
 * hook get two independent instances (separate state, separate dialogs
 * mounted once per host) — nothing here is a singleton — so a picker-hosted
 * dialog can never retain a prior host's selection.
 *
 * Deliberately does NOT add a space-manager override or any delete path
 * beyond what already existed on the owner path: a shared, non-owned card
 * still gets Connection details (always safe to read), but no Disconnect/
 * Delete-history item — those stay exactly as owner-gated as before. This
 * mirrors `agents.disconnect`/`agents.deleteHistory` server authorization,
 * which resolves or requires the caller's own row; rendering a destructive
 * item the server would reject is a worse UX than omitting it.
 */
export function useAgentConnectionActions(orpc: BusabaseQueryUtils) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const queryClient = useQueryClient();
  const modelScope = useAgentModelScope();
  const [disconnecting, setDisconnecting] = useState<AgentConnectionVO | null>(null);
  const [deletingHistory, setDeletingHistory] = useState<AgentConnectionVO | null>(null);
  const [connectionDetail, setConnectionDetail] = useState<{
    slug: string;
    rename: boolean;
  } | null>(null);
  const connectionTriggers = useRef(new Map<string, HTMLButtonElement>());
  const connectionCopy = agentConnectionCopy(locale);
  const isDisconnectingRouter = disconnecting?.slug.startsWith("acprouter:") ?? false;

  const invalidateConnectionLists = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.agents.connections.list.queryKey({ input: { scope: "mine" } }),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.agents.connections.list.queryKey({ input: { scope: "space" } }),
      }),
    ]);

  const disconnect = useMutation({
    ...orpc.agents.disconnect.mutationOptions(),
    onSuccess: async (_result, input) => {
      useAgentModelListStore
        .getState()
        .setCatalog(
          agentModelCatalogScope(
            modelScope.host,
            modelScope.workspaceKey,
            modelScope.actorId,
            input.slug,
          ),
          { configId: null, updatedAt: new Date().toISOString() },
        );
      await Promise.all([
        invalidateConnectionLists(),
        queryClient.invalidateQueries({ queryKey: orpc.agents.sessions.list.queryKey() }),
        queryClient.invalidateQueries({ queryKey: orpc.agents.catalog.queryKey() }),
      ]);
      toast.success(messages.agents.connectionDeleted);
      setDisconnecting(null);
    },
    onError: (error) => {
      void invalidateConnectionLists();
      toast.error(
        presentCoreError(messages, locale, error, messages.agents.connectionDeleteFailed),
      );
    },
  });

  const deleteHistory = useMutation({
    ...orpc.agents.deleteHistory.mutationOptions(),
    onSuccess: async () => {
      await Promise.all([
        invalidateConnectionLists(),
        queryClient.invalidateQueries({ queryKey: orpc.agents.sessions.list.queryKey() }),
      ]);
      toast.success(messages.agents.deleteHistoryDone);
      setDeletingHistory(null);
    },
    onError: (error) => {
      toast.error(presentCoreError(messages, locale, error, messages.agents.deleteHistoryFailed));
    },
  });

  const renderActions = (group: AgentConnectionVO): ReactNode => {
    const hasConnectionDetails =
      (group.slug.startsWith("buda:") || group.slug.startsWith("acprouter:")) &&
      (group.connected || group.connectionState);
    const hasMenu =
      hasConnectionDetails ||
      (group.ownedByCurrentUser && (group.connected || group.connectionState)) ||
      group.sessionCount > 0;
    if (!hasMenu) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            ref={(element) => {
              if (element) connectionTriggers.current.set(group.slug, element);
              else connectionTriggers.current.delete(group.slug);
            }}
            aria-label={fmt(messages.agents.actionsFor, { name: group.agentName })}
            className="size-11 shrink-0 sm:size-8"
            size="icon"
            type="button"
            variant="ghost"
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {hasConnectionDetails ? (
            <>
              <DropdownMenuItem
                className="min-h-11 sm:min-h-8"
                onSelect={() => setConnectionDetail({ slug: group.slug, rename: false })}
              >
                <Link2 aria-hidden="true" className="mr-2 size-4" />
                {connectionCopy.connection}
              </DropdownMenuItem>
              {group.ownedByCurrentUser ? (
                <DropdownMenuItem
                  className="min-h-11 sm:min-h-8"
                  onSelect={() => setConnectionDetail({ slug: group.slug, rename: true })}
                >
                  <Pencil aria-hidden="true" className="mr-2 size-4" />
                  {connectionCopy.rename}
                </DropdownMenuItem>
              ) : null}
            </>
          ) : null}
          {(group.connected || group.connectionState) && group.ownedByCurrentUser ? (
            <DropdownMenuItem onSelect={() => setDisconnecting(group)}>
              <Unplug className="mr-2 size-4" />
              {messages.agents.disconnectAgent}
            </DropdownMenuItem>
          ) : null}
          {group.sessionCount > 0 ? (
            <DropdownMenuItem onSelect={() => setDeletingHistory(group)} variant="destructive">
              <Trash2 className="mr-2 size-4" />
              {messages.agents.deleteHistory}
            </DropdownMenuItem>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  };

  const dialogs = (
    <>
      {connectionDetail ? (
        <AgentConnectionDialog
          key={connectionDetail.slug}
          orpc={orpc}
          slug={connectionDetail.slug}
          renameInitially={connectionDetail.rename}
          onClose={() => setConnectionDetail(null)}
          onRestoreFocus={() => connectionTriggers.current.get(connectionDetail.slug)?.focus()}
        />
      ) : null}
      <AgentActionConfirmDialog
        body={
          disconnecting
            ? isDisconnectingRouter
              ? routerEnrollmentText(
                  locale,
                  "End this device’s active sessions and remove its connection. Conversation history is kept, and other devices stay connected.",
                )
              : fmt(messages.agents.deleteConnectionBody, {
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
        title={
          isDisconnectingRouter
            ? routerEnrollmentText(locale, "Disconnect this device?")
            : messages.agents.deleteConnectionTitle
        }
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
    </>
  );

  return { renderActions, dialogs };
}
