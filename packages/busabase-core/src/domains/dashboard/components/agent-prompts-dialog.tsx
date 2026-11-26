"use client";

import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "kui/dialog";
import type { ComponentProps, ReactNode } from "react";
import { useCoreI18n } from "../../../i18n";
import { AgentPromptsView } from "./agent-prompts-view";
import { DialogContent } from "./localized-dialog-content";

type Props = Omit<ComponentProps<typeof AgentPromptsView>, "onHandedOff"> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  subject?: ReactNode;
  description?: ReactNode;
  onCloseAutoFocus?: ComponentProps<typeof DialogContent>["onCloseAutoFocus"];
};

/** Shared prompt presentation; each host supplies its own resource context. */
export function AgentPromptsDialog({
  open,
  onOpenChange,
  subject,
  description,
  onCloseAutoFocus,
  ...viewProps
}: Props) {
  const messages = useCoreI18n();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="grid h-[80vh] max-h-[calc(100dvh-2rem)] w-[min(96vw,1020px)] min-w-0 grid-rows-[auto_auto_minmax(0,1fr)] gap-2 overflow-hidden p-4 sm:h-[min(640px,calc(100dvh-2rem))] sm:max-w-[1020px] sm:p-5"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader className="space-y-1 pr-6">
          <DialogTitle className="break-words">
            {messages.agentPrompts.title}
            {subject ? (
              <span className="ml-2 text-sm font-normal text-muted-foreground">{subject}</span>
            ) : null}
          </DialogTitle>
        </DialogHeader>
        <DialogDescription>{description ?? messages.agentPrompts.intro}</DialogDescription>
        <div className="min-h-0 overflow-y-auto sm:overflow-hidden">
          <AgentPromptsView {...viewProps} onHandedOff={() => onOpenChange(false)} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
