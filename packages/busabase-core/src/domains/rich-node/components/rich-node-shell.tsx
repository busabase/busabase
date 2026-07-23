"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { NodeVO } from "busabase-contract/types";
import { Button } from "kui/button";
import type { LucideIcon } from "lucide-react";
import { Save } from "lucide-react";
import type { ReactNode } from "react";
import { useCallback, useState } from "react";
import { fmt, useCoreI18n } from "../../../i18n";
import { NodeDeleteButton } from "../../dashboard/components/file-tree-browser";
import { NodePermissionsButton } from "../../dashboard/components/node-permissions-button";

export type SaveStatus = "saved" | "dirty" | "saving" | "error";

export const findNode = (nodes: NodeVO[], type: string, slug: string | null): NodeVO | null => {
  if (!slug) return null;
  for (const node of nodes) {
    if (node.type === type && (node.slug === slug || node.id === slug)) return node;
    const child = findNode(node.children, type, slug);
    if (child) return child;
  }
  return null;
};

export function useNodeMetadataSave(
  orpc: BusabaseQueryUtils,
  node: NodeVO | null,
  metadataKey: string,
) {
  const messages = useCoreI18n();
  const queryClient = useQueryClient();
  const mutation = useMutation(orpc.nodes.updateMetadata.mutationOptions());
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);

  const markDirty = useCallback(() => {
    setStatus((current) => (current === "saving" ? current : "dirty"));
    setError(null);
  }, []);

  const save = useCallback(
    async (document: unknown) => {
      if (!node || mutation.isPending) return false;
      setStatus("saving");
      setError(null);
      try {
        await mutation.mutateAsync({ nodeId: node.id, metadata: { [metadataKey]: document } });
        await queryClient.invalidateQueries({
          queryKey: orpc.nodes.list.queryOptions({}).queryKey,
        });
        setStatus("saved");
        return true;
      } catch (caught) {
        setStatus("error");
        setError(caught instanceof Error ? caught.message : messages.richNodes.saveFailed);
        return false;
      }
    },
    [messages.richNodes.saveFailed, metadataKey, mutation, node, orpc, queryClient],
  );

  return { error, markDirty, save, status };
}

interface RichNodeShellProps {
  node: NodeVO;
  nodeType: string;
  icon: LucideIcon;
  orpc: BusabaseQueryUtils;
  status: SaveStatus;
  error?: string | null;
  onSave: () => void;
  children: ReactNode;
  actions?: ReactNode;
}

export function RichNodeShell({
  node,
  nodeType,
  icon: Icon,
  orpc,
  status,
  error,
  onSave,
  children,
  actions,
}: RichNodeShellProps) {
  const messages = useCoreI18n();
  const statusLabel =
    status === "saving"
      ? messages.richNodes.saving
      : status === "saved"
        ? messages.richNodes.saved
        : messages.richNodes.unsaved;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-2 border-border/60 border-b px-3 md:px-4">
        <Icon className="size-4 shrink-0 text-muted-foreground" />
        <h1 className="min-w-0 flex-1 truncate font-medium text-foreground text-sm">{node.name}</h1>
        <span
          className={
            status === "error"
              ? "hidden max-w-48 truncate text-destructive text-xs sm:block"
              : "hidden text-muted-foreground text-xs sm:block"
          }
          title={error ?? statusLabel}
        >
          {error ?? statusLabel}
        </span>
        {actions}
        <span className="hidden sm:inline-flex">
          <NodePermissionsButton nodeId={node.id} nodeName={node.name} orpc={orpc} />
        </span>
        <span className="inline-flex sm:hidden">
          <NodePermissionsButton nodeId={node.id} nodeName={node.name} orpc={orpc} variant="icon" />
        </span>
        <NodeDeleteButton nodeId={node.id} nodeName={node.name} nodeType={nodeType} orpc={orpc} />
        <Button
          aria-label={messages.richNodes.save}
          disabled={status === "saving" || status === "saved"}
          onClick={onSave}
          size="icon-sm"
          title={messages.richNodes.save}
          type="button"
          variant="default"
        >
          <Save className="size-3.5" />
        </Button>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

export function RichNodeNotFound({ type }: { type: string }) {
  const messages = useCoreI18n();
  return (
    <div className="flex h-full items-center justify-center bg-background p-6 text-muted-foreground text-sm">
      {fmt(messages.richNodes.notFound, { type })}
    </div>
  );
}
