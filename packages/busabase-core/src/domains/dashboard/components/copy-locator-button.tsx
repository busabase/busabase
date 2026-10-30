"use client";

/**
 * Click-to-copy on the places a node's identity is shown — the marker next to
 * its name in the topbar, a record's ID in its technical details. Both copy the
 * LOCATOR prompt (target + connection check), not the bare id: an id pasted
 * into an agent on its own is something it cannot act on.
 */

import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "kui/tooltip";
import { cn } from "kui/utils";
import { MapPin } from "lucide-react";
import type { ReactNode } from "react";
import { fmt, useCoreI18n } from "../../../i18n";
import {
  type AgentLocator,
  useCopyLocator,
  useLocatorShortcutLabel,
} from "../hooks/use-copy-locator";
import type { AgentIntegrationTarget } from "./agent-install-panel";

function useTooltipText(withShortcut: boolean): string {
  const messages = useCoreI18n();
  const shortcut = useLocatorShortcutLabel();
  return withShortcut
    ? `${messages.agentPrompts.identifierCopyHint} · ${fmt(messages.agentPrompts.copyLocatorWithShortcut, { shortcut })}`
    : messages.agentPrompts.identifierCopyHint;
}

/** The identifier text itself becomes the button; same size, same color. */
export function CopyLocatorText({
  locator,
  children,
  agentIntegration,
  className,
}: {
  locator: AgentLocator;
  children: ReactNode;
  agentIntegration?: AgentIntegrationTarget;
  className?: string;
}) {
  const messages = useCoreI18n();
  const { copyLocator } = useCopyLocator(agentIntegration);
  const tooltip = useTooltipText(false);
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            aria-label={`${messages.agentPrompts.copyLocator}: ${typeof children === "string" ? children : ""}`.trim()}
            className={cn(
              "max-w-full cursor-copy truncate rounded text-left underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              className,
            )}
            data-testid="copy-locator-text"
            onClick={() => void copyLocator(locator)}
            type="button"
          >
            {children}
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** A marker-sized (20px) icon button, for next to a node's name. */
export function CopyLocatorIconButton({
  locator,
  className,
  withShortcut = false,
}: {
  locator: AgentLocator;
  className?: string;
  /** Mention the page shortcut — only where it copies this same locator. */
  withShortcut?: boolean;
}) {
  const messages = useCoreI18n();
  const { copyLocator } = useCopyLocator();
  const tooltip = useTooltipText(withShortcut);
  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            aria-label={messages.agentPrompts.copyLocator}
            className={cn(
              "inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              className,
            )}
            data-testid="copy-locator-icon"
            onClick={() => void copyLocator(locator)}
            type="button"
          >
            <MapPin aria-hidden="true" className="size-3.5" />
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">{tooltip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
