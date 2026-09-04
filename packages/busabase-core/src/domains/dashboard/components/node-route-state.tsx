"use client";

import type { NodeRouteStateVO } from "busabase-contract/contract/node-route-state-schemas";
import { Button } from "kui/button";
import { ArchiveRestore, House, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { useCoreI18n } from "../../../i18n";

interface NodeRouteStateViewProps {
  state: Extract<NodeRouteStateVO, { status: "archived" | "unavailable" }>;
  onNavigate: (path: string) => void;
  onRestore?: () => Promise<void>;
}

export function NodeRouteStateView({ state, onNavigate, onRestore }: NodeRouteStateViewProps) {
  const messages = useCoreI18n();
  const [restoring, setRestoring] = useState(false);
  const archived = state.status === "archived";

  const restore = async () => {
    if (!onRestore || !archived) return;
    setRestoring(true);
    try {
      await onRestore();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : messages.shell.operationFailed);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <section className="flex h-full min-h-[320px] items-center justify-center px-6 py-12">
      <div className="flex max-w-md flex-col items-center text-center">
        <div className="mb-5 flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          {archived ? <ArchiveRestore size={22} /> : <House size={22} />}
        </div>
        <h1 className="font-semibold text-foreground text-xl">
          {archived ? messages.nodeDetail.archivedTitle : messages.nodeDetail.unavailableTitle}
        </h1>
        {archived ? <p className="mt-2 font-medium text-foreground text-sm">{state.name}</p> : null}
        <p className="mt-2 text-muted-foreground text-sm leading-6">
          {archived ? messages.nodeDetail.archivedBody : messages.nodeDetail.unavailableBody}
        </p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          {archived && state.canRestore && onRestore ? (
            <Button disabled={restoring} onClick={() => void restore()} type="button">
              <RotateCcw className="mr-2 size-4" />
              {restoring ? messages.common.restoring : messages.common.restore}
            </Button>
          ) : null}
          <Button onClick={() => onNavigate("/home")} type="button" variant="outline">
            <House className="mr-2 size-4" />
            {messages.nodeDetail.backToWorkspace}
          </Button>
          {archived ? (
            <Button onClick={() => onNavigate("/archived")} type="button" variant="outline">
              <Trash2 className="mr-2 size-4" />
              {messages.nodeDetail.goToTrash}
            </Button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
