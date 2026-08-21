"use client";

import { hasActiveToolCall, summarizeToolRun } from "@acp-ui/core/group";
import type { AcpToolCallBlock } from "@acp-ui/core/reduce";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "kui/collapsible";
import { CheckIcon, ChevronDownIcon, Loader2Icon } from "lucide-react";
import { AcpToolCallView } from "./tool-call-view";

/**
 * The strings a tool-run summary is built from — English defaults, matching
 * buda's exact wording, so both chats read the same way. Overridable because
 * this package has no i18n system of its own to plug localized strings into;
 * a host that does (buda's chat gets this from `typesafe-i18n`) passes its own.
 */
export interface AcpToolRunLabels {
  explored: (count: number) => string;
  searched: (count: number) => string;
  edited: (count: number) => string;
  ran: (count: number) => string;
  usedTools: (count: number) => string;
}

const plural = (count: number, singular: string, plural: string) =>
  count === 1 ? singular : plural;

const defaultLabels: AcpToolRunLabels = {
  explored: (n) => `Explored ${n} ${plural(n, "file", "files")}`,
  searched: (n) => `Ran ${n} ${plural(n, "search", "searches")}`,
  edited: (n) => `Edited ${n} ${plural(n, "file", "files")}`,
  ran: (n) => `Ran ${n} ${plural(n, "command", "commands")}`,
  usedTools: (n) => `Used ${n} ${plural(n, "tool", "tools")}`,
};

/**
 * Turns a run's category counts into "Explored 3 files, ran 2 commands" —
 * `@acp-ui/core`'s `summarizeToolRun` returns counts, not a string, on
 * purpose: wording and pluralization are a binding-layer concern.
 */
function formatToolRunTitle(blocks: readonly AcpToolCallBlock[], labels: AcpToolRunLabels): string {
  const { explore, search, edit, run, other, total } = summarizeToolRun(blocks);
  const parts: string[] = [];
  if (explore > 0) parts.push(labels.explored(explore));
  if (search > 0) parts.push(labels.searched(search));
  if (edit > 0) parts.push(labels.edited(edit));
  if (run > 0) parts.push(labels.ran(run));
  if (other > 0) parts.push(labels.usedTools(other));
  return parts.length > 0 ? parts.join(", ") : labels.usedTools(total);
}

export interface AcpToolRunViewProps {
  blocks: AcpToolCallBlock[];
  labels?: AcpToolRunLabels;
}

/**
 * Two or more consecutive tool calls, collapsed into one row — buda's "Worked
 * for Ns" pattern. A single tool call never reaches this component; the
 * transcript renders it as itself (see `groupConsecutiveToolCalls`).
 */
export function AcpToolRunView({ blocks, labels = defaultLabels }: AcpToolRunViewProps) {
  const isRunning = hasActiveToolCall(blocks);
  const title = formatToolRunTitle(blocks, labels);

  return (
    <Collapsible className="group inline-flex max-w-full flex-col" defaultOpen={isRunning}>
      <CollapsibleTrigger
        className="inline-flex max-w-full cursor-pointer items-center gap-1.5 self-start rounded-md px-1.5 py-1 text-muted-foreground text-sm transition-colors hover:bg-muted hover:text-foreground data-[state=open]:bg-transparent"
        data-testid="acp-tool-run"
      >
        <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-muted">
          {isRunning ? (
            <Loader2Icon className="size-3 animate-spin text-primary" />
          ) : (
            <CheckIcon className="size-3 text-muted-foreground" />
          )}
        </span>
        <span className="min-w-0 truncate font-medium">{title}</span>
        <ChevronDownIcon className="size-3 shrink-0 text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 space-y-1 py-1 pl-1">
        {blocks.map((block) => (
          <AcpToolCallView block={block} key={block.id} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
