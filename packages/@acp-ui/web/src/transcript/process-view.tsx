"use client";

import type {
  AcpBlock,
  AcpPlanBlock,
  AcpStepBlock,
  AcpTurnBlock,
  AcpTurnUsage,
} from "@acp-ui/core/reduce";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "kui/collapsible";
import {
  CheckIcon,
  ChevronDownIcon,
  CircleIcon,
  Loader2Icon,
  PauseIcon,
  XCircleIcon,
} from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

export interface AcpProcessLabels {
  workingFor: (duration: string) => string;
  workedFor: (duration: string) => string;
  waitingInput: string;
  waitingPermission: string;
  confirmingInput?: string;
  confirmingPermission?: string;
  cancelled: string;
  failed: string;
  interrupted: string;
  limited: string;
  refused: string;
  step: (index: number) => string;
  planTitle: string;
  planProgress: (completed: number, total: number) => string;
  usage?: (usage: AcpTurnUsage) => string;
}
export const defaultProcessLabels: AcpProcessLabels = {
  workingFor: (duration) => `Working for ${duration}`,
  workedFor: (duration) => `Worked for ${duration}`,
  waitingInput: "Waiting for your answer",
  waitingPermission: "Waiting for your permission",
  cancelled: "Stopped",
  failed: "Failed",
  interrupted: "Interrupted",
  limited: "Limit reached",
  refused: "Request declined",
  step: (index) => `Step ${index}`,
  planTitle: "Plan",
  planProgress: (completed, total) => `${completed} of ${total} completed`,
};

function formatDuration(start: string, end: string | undefined, now: number): string {
  const milliseconds = (end ? Date.parse(end) : now) - Date.parse(start);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  const seconds = Math.floor(milliseconds / 1000);
  if (seconds < 1) return "<1s";
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

export function AcpProcessView({
  turn,
  blocks,
  children,
  summary,
  labels: supplied,
}: {
  turn: AcpTurnBlock;
  blocks: readonly AcpBlock[];
  children: ReactNode;
  summary?: string;
  labels?: Partial<AcpProcessLabels>;
}) {
  const labels = { ...defaultProcessLabels, ...supplied };
  const awaitingInput = blocks.some(
    (block) =>
      block.kind === "input_request" &&
      block.resolution === "pending" &&
      !block.confirmationUnknown,
  );
  const awaitingPermission = blocks.some(
    (block) =>
      block.kind === "permission" && block.resolution === "pending" && !block.confirmationUnknown,
  );
  const confirmingInput = blocks.some(
    (block) =>
      block.kind === "input_request" &&
      (block.resolution === "answering" || block.confirmationUnknown),
  );
  const confirmingPermission = blocks.some(
    (block) =>
      block.kind === "permission" &&
      (block.resolution === "answering" || block.confirmationUnknown),
  );
  const confirming = confirmingInput || confirmingPermission;
  const active = turn.status === "running" || awaitingInput || awaitingPermission || confirming;
  const [open, setOpen] = useState(active);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setOpen(active);
  }, [active]);
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  const duration = formatDuration(turn.startedAt, turn.endedAt, now);
  const usage = turn.usage
    ? (labels.usage?.(turn.usage) ??
      [
        turn.usage.inputTokens !== undefined ? `${turn.usage.inputTokens} input tokens` : undefined,
        turn.usage.outputTokens !== undefined
          ? `${turn.usage.outputTokens} output tokens`
          : undefined,
        turn.usage.cachedReadTokens !== undefined
          ? `${turn.usage.cachedReadTokens} cache read`
          : undefined,
        turn.usage.cachedWriteTokens !== undefined
          ? `${turn.usage.cachedWriteTokens} cache write`
          : undefined,
        turn.usage.thoughtTokens !== undefined
          ? `${turn.usage.thoughtTokens} reasoning tokens`
          : undefined,
        turn.usage.totalTokens !== undefined ? `${turn.usage.totalTokens} total tokens` : undefined,
      ]
        .filter(Boolean)
        .join(" · "))
    : undefined;
  const workTitle = awaitingInput
    ? labels.waitingInput
    : awaitingPermission
      ? labels.waitingPermission
      : turn.status === "running"
        ? labels.workingFor(duration)
        : turn.status === "completed"
          ? labels.workedFor(duration)
          : labels[turn.status];
  const confirmationTitle = confirmingInput
    ? (labels.confirmingInput ?? "Confirming your answer")
    : (labels.confirmingPermission ?? "Confirming your decision");
  const title =
    confirming && !awaitingInput && !awaitingPermission
      ? turn.status === "running"
        ? confirmationTitle
        : `${workTitle} · ${confirmationTitle}`
      : workTitle;
  const Icon =
    awaitingInput || awaitingPermission || turn.status === "cancelled"
      ? PauseIcon
      : turn.status === "running" || confirming
        ? Loader2Icon
        : turn.status === "completed"
          ? CheckIcon
          : XCircleIcon;
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="group my-2 min-w-0"
      data-testid="acp-process"
      data-turn-id={turn.id}
      data-status={turn.status}
    >
      <CollapsibleTrigger
        className="flex max-w-full items-center gap-2 rounded px-1 py-2 text-muted-foreground text-sm hover:bg-muted"
        data-testid="acp-process-summary"
      >
        <Icon
          aria-hidden="true"
          className={`size-4 shrink-0 ${(turn.status === "running" || confirming) && !awaitingInput && !awaitingPermission ? "animate-spin" : ""}`}
        />
        <span className="min-w-0 break-words text-left font-medium">
          {title}
          {summary ? ` · ${summary}` : ""}
        </span>
        <ChevronDownIcon
          aria-hidden="true"
          className="size-3 shrink-0 transition-transform group-data-[state=open]:rotate-180"
        />
      </CollapsibleTrigger>
      {usage ? (
        <p
          className="mb-1 ml-7 break-words text-muted-foreground text-xs"
          data-testid="acp-turn-usage"
        >
          {usage}
        </p>
      ) : null}
      <CollapsibleContent
        className="ml-2 min-w-0 space-y-1 border-l border-border pl-3"
        data-testid="acp-process-content"
      >
        {children}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function AcpPlanView({
  block,
  labels: supplied,
}: {
  block: AcpPlanBlock;
  labels?: Partial<AcpProcessLabels>;
}) {
  const labels = { ...defaultProcessLabels, ...supplied };
  if (block.entries.length === 0) return null;
  const completed = block.entries.filter((entry) => entry.status === "completed").length;
  return (
    <section className="my-2 rounded-md border bg-muted/20 p-3" data-testid="acp-plan">
      <p className="mb-2 flex flex-wrap justify-between gap-2 font-medium text-sm">
        <span>{labels.planTitle}</span>
        <span className="text-muted-foreground text-xs">
          {labels.planProgress(completed, block.entries.length)}
        </span>
      </p>
      <ol className="space-y-2">
        {block.entries.map((entry, index) => (
          <li
            key={`${index}:${entry.content}`}
            className="flex items-start gap-2 text-sm"
            data-status={entry.status}
          >
            {entry.status === "completed" ? (
              <CheckIcon aria-label="Completed" className="mt-0.5 size-4 shrink-0 text-primary" />
            ) : entry.status === "in_progress" ? (
              <Loader2Icon
                aria-label="In progress"
                className="mt-0.5 size-4 shrink-0 animate-spin"
              />
            ) : (
              <CircleIcon
                aria-label="Pending"
                className="mt-0.5 size-4 shrink-0 text-muted-foreground"
              />
            )}
            <span
              className={
                entry.status === "completed" ? "break-words text-muted-foreground" : "break-words"
              }
            >
              {entry.content}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function AcpStepView({
  block,
  index,
  labels: supplied,
}: {
  block: AcpStepBlock;
  index: number;
  labels?: Partial<AcpProcessLabels>;
}) {
  const labels = { ...defaultProcessLabels, ...supplied };
  return (
    <p
      className="flex items-center gap-2 py-1 font-medium text-muted-foreground text-xs"
      data-testid="acp-step"
      data-step-id={block.id}
    >
      {block.endedAt ? (
        <CheckIcon className="size-3" />
      ) : (
        <Loader2Icon className="size-3 animate-spin" />
      )}
      {block.label ?? labels.step(index)}
    </p>
  );
}
