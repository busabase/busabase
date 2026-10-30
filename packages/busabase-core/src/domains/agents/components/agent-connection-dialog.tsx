"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { AgentConnectionNameSchema } from "busabase-contract/domains/agents/types";
import { Button } from "kui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "kui/dialog";
import { Input } from "kui/input";
import { Label } from "kui/label";
import { Loader2, Pencil } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { useCoreI18n, useCoreLocale } from "../../../i18n";
import { agentConnectionCopy } from "../../../i18n/agent-connection-copy";
import { presentCoreError } from "../../../i18n/localize-error";
import { formatUserRefLabel } from "../../dashboard/helpers/format";

export function AgentConnectionDialog({
  orpc,
  slug,
  renameInitially,
  onClose,
  onRestoreFocus,
}: {
  orpc: BusabaseQueryUtils;
  slug: string;
  renameInitially: boolean;
  onClose: () => void;
  onRestoreFocus: () => void;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const copy = agentConnectionCopy(locale);
  const queryClient = useQueryClient();
  const nameId = useId();
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState(renameInitially);
  const [edited, setEdited] = useState(false);
  const details = useQuery(orpc.agents.connections.detail.queryOptions({ input: { slug } }));
  const detail = details.data;
  const savedName = detail?.agentName;

  useEffect(() => {
    if (savedName !== undefined) setName(savedName);
  }, [savedName]);

  const rename = useMutation({
    ...orpc.agents.connections.rename.mutationOptions(),
    onSuccess: async (next) => {
      queryClient.setQueryData(orpc.agents.connections.detail.queryKey({ input: { slug } }), next);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.agents.connections.list.queryKey({ input: { scope: "mine" } }),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.agents.connections.list.queryKey({ input: { scope: "space" } }),
        }),
        queryClient.invalidateQueries({ queryKey: orpc.agents.catalog.queryKey() }),
      ]);
      setRenaming(false);
      setEdited(false);
      toast.success(copy.savedName);
    },
  });
  const validName = AgentConnectionNameSchema.safeParse(name);
  const nameError = edited && !validName.success;
  const close = () => {
    if (!rename.isPending) onClose();
  };

  const fields = detail
    ? [
        [copy.provider, detail.provider === "buda" ? "Buda" : "ACPRouter"],
        [copy.transport, copy.remote],
        [copy.status, copy[detail.status]],
        [copy.providerName, detail.providerAgentName],
        [copy.agentId, detail.agentId],
        [copy.connectedBy, formatUserRefLabel(detail.connectedBy, null, messages)],
        ...(detail.routerWorkspaceName ? [[copy.workspace, detail.routerWorkspaceName]] : []),
        ...(detail.routerWorkspaceId ? [[copy.workspaceId, detail.routerWorkspaceId]] : []),
        ...(detail.deviceId ? [[copy.deviceId, detail.deviceId]] : []),
      ]
    : [];

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onRestoreFocus();
        }}
        onEscapeKeyDown={(event) => {
          if (rename.isPending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (rename.isPending) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        {details.isPending ? (
          <div className="flex items-center gap-2 py-8 text-muted-foreground text-sm" role="status">
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            {messages.common.working}
          </div>
        ) : details.isError ? (
          <div className="space-y-3 py-4">
            <p className="text-sm" role="alert">
              {presentCoreError(messages, locale, details.error, copy.loadError)}
            </p>
            <Button
              className="min-h-11 sm:min-h-9"
              onClick={() => void details.refetch()}
              type="button"
              variant="outline"
            >
              {messages.agents.queryRetry}
            </Button>
          </div>
        ) : detail ? (
          <div className="space-y-6 py-2">
            <div className="space-y-2">
              {renaming && detail.ownedByCurrentUser ? (
                <form
                  id={`${nameId}-form`}
                  className="space-y-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    setEdited(true);
                    if (validName.success && !rename.isPending)
                      rename.mutate({ slug: detail.slug, name: validName.data });
                  }}
                >
                  <Label htmlFor={nameId}>{copy.name}</Label>
                  <Input
                    id={nameId}
                    autoFocus
                    maxLength={100}
                    value={name}
                    disabled={rename.isPending}
                    aria-invalid={nameError}
                    aria-describedby={`${nameId}-hint${nameError ? ` ${nameId}-error` : ""}`}
                    className="min-h-11 sm:min-h-9"
                    onChange={(event) => {
                      setName(event.target.value);
                      setEdited(true);
                      rename.reset();
                    }}
                  />
                  <p id={`${nameId}-hint`} className="text-muted-foreground text-xs">
                    {copy.nameHint}
                  </p>
                  {nameError ? (
                    <p
                      id={`${nameId}-error`}
                      className="text-rejected-strong text-sm dark:text-rejected-soft"
                      role="alert"
                    >
                      {copy.nameError}
                    </p>
                  ) : null}
                  {rename.isError ? (
                    <p
                      className="text-rejected-strong text-sm dark:text-rejected-soft"
                      role="alert"
                    >
                      {presentCoreError(messages, locale, rename.error, copy.saveError)}
                    </p>
                  ) : null}
                </form>
              ) : (
                <div className="flex min-w-0 items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-muted-foreground text-xs">{copy.name}</p>
                    <p className="mt-1 break-words font-medium">{detail.agentName}</p>
                  </div>
                  {detail.ownedByCurrentUser ? (
                    <Button
                      className="min-h-11 shrink-0 sm:min-h-9"
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setRenaming(true)}
                    >
                      <Pencil aria-hidden="true" className="size-4" />
                      {copy.rename}
                    </Button>
                  ) : null}
                </div>
              )}
              {!detail.ownedByCurrentUser ? (
                <p className="text-muted-foreground text-xs">{copy.sharedHint}</p>
              ) : null}
            </div>
            <div className="space-y-3">
              <dl className="divide-y border-y text-sm">
                {fields.map(([label, value]) => (
                  <div
                    key={label}
                    className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 py-3"
                  >
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="min-w-0 break-words">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-muted-foreground text-xs">{copy.statusHint}</p>
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button
            className="min-h-11 sm:min-h-9"
            type="button"
            variant="outline"
            disabled={rename.isPending}
            onClick={close}
          >
            {renaming ? messages.common.cancel : messages.common.close}
          </Button>
          {renaming && detail?.ownedByCurrentUser ? (
            <Button
              className="min-h-11 sm:min-h-9"
              type="submit"
              form={`${nameId}-form`}
              disabled={!validName.success || name.trim() === detail.agentName || rename.isPending}
            >
              {rename.isPending ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : null}
              {rename.isPending ? messages.common.working : copy.save}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
