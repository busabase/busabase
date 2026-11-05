"use client";

import { reduceAcpEvents } from "@acp-ui/core/reduce";
import { AcpConversation } from "@acp-ui/web/transcript";
import type {
  AgentSessionCommandReceiptVO,
  AgentSessionRecoverySnapshotVO,
  AgentSessionReliabilityVO,
} from "busabase-contract/domains/agents/types";
import { Message, MessageContent } from "kui/ai-elements/message";
import { Button } from "kui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "kui/dialog";
import { useMemo, useState } from "react";
import { useCoreLocale } from "../../../i18n";
import { agentSessionReliabilityCopy } from "../../../i18n/agent-session-reliability-copy";
import { translateAgentSessionEvent } from "../hooks/use-agent-session";

export function AgentSessionReliabilityStatus({
  reliability,
  updatesRecovering,
  onCheck,
  recoverySnapshot,
}: {
  reliability: AgentSessionReliabilityVO;
  updatesRecovering: boolean;
  onCheck: () => void;
  recoverySnapshot?: AgentSessionRecoverySnapshotVO;
}) {
  const copy = agentSessionReliabilityCopy(useCoreLocale());
  const hint =
    reliability.execution === "unknown"
      ? copy.unknownHint
      : reliability.synchronization === "gap"
        ? copy.gapHint
        : updatesRecovering
          ? copy.updatesHint
          : reliability.synchronization !== "synced"
            ? copy.recoveryHint
            : null;
  return (
    <section
      aria-label={copy.label}
      aria-live="polite"
      className="min-w-0 shrink-0 border-b px-4 py-2 text-xs"
      data-testid="agent-session-reliability"
    >
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground">
        <div className="flex gap-1">
          <dt>{copy.connection}:</dt>
          <dd>
            {
              copy[
                updatesRecovering && reliability.connection === "connected"
                  ? "connecting"
                  : reliability.connection
              ]
            }
          </dd>
        </div>
        <div className="flex gap-1">
          <dt>{copy.execution}:</dt>
          <dd>{copy[reliability.execution]}</dd>
        </div>
        <div className="flex gap-1">
          <dt>{copy.synchronization}:</dt>
          <dd>{copy[reliability.synchronization]}</dd>
        </div>
      </dl>
      {hint ? (
        <p className="mt-1 text-foreground" role="status">
          {hint}
        </p>
      ) : null}
      <div className="mt-1 flex flex-wrap items-center gap-2">
        {reliability.diagnosticRef ? (
          <span className="min-w-0 break-all">
            {copy.reference}: {reliability.diagnosticRef}
          </span>
        ) : null}
        <Button onClick={onCheck} size="sm" type="button" variant="ghost">
          {copy.check}
        </Button>
        {recoverySnapshot ? <RecoveredAgentHistory snapshot={recoverySnapshot} /> : null}
      </div>
    </section>
  );
}

/** A separate read-only view; opening it cannot append to or send into the live session. */
function RecoveredAgentHistory({ snapshot }: { snapshot: AgentSessionRecoverySnapshotVO }) {
  const copy = agentSessionReliabilityCopy(useCoreLocale());
  const [open, setOpen] = useState(false);
  const blocks = useMemo(
    () =>
      open
        ? reduceAcpEvents(
            [],
            snapshot.updates.flatMap((update, seq) =>
              translateAgentSessionEvent({
                sessionId: "recovered-history",
                seq,
                at: snapshot.capturedAt,
                kind: "acpUpdate",
                acpUpdate: update,
              }),
            ),
          )
        : [],
    [open, snapshot],
  );
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" type="button" variant="ghost">
          {copy.inspectHistory}
        </Button>
      </DialogTrigger>
      <DialogContent className="flex max-h-[85dvh] max-w-3xl flex-col">
        <DialogHeader>
          <DialogTitle>{copy.recoveredHistory}</DialogTitle>
          <DialogDescription>{copy.recoveredHistoryHint}</DialogDescription>
        </DialogHeader>
        {!snapshot.complete || snapshot.truncated ? (
          <p className="text-muted-foreground text-sm" role="status">
            {copy.partialHistory}
          </p>
        ) : null}
        <fieldset disabled className="min-h-0 flex-1 overflow-y-auto border-0 p-0">
          <AcpConversation
            blocks={blocks}
            className="max-h-[60dvh]"
            onAnswerPermission={() => {}}
            emptyTitle={copy.recoveredHistory}
            emptyDescription={copy.noRecoveredMessages}
          />
        </fieldset>
      </DialogContent>
    </Dialog>
  );
}

export function PendingAgentPromptPresentations({
  commands,
}: {
  commands: readonly AgentSessionCommandReceiptVO[];
}) {
  const copy = agentSessionReliabilityCopy(useCoreLocale());
  return commands.map((command) => {
    const text =
      typeof command.presentation?.text === "string"
        ? command.presentation.text
        : typeof command.payload.text === "string"
          ? command.payload.text
          : "";
    const attachments = Array.isArray(command.payload.attachments)
      ? command.payload.attachments
      : [];
    const contexts = Array.isArray(command.payload.resourceContext)
      ? command.payload.resourceContext
      : [];
    const filenames = attachments.flatMap((attachment) =>
      attachment &&
      typeof attachment === "object" &&
      "filename" in attachment &&
      typeof attachment.filename === "string"
        ? [attachment.filename]
        : [],
    );
    const contextNames = contexts.flatMap((context) =>
      context &&
      typeof context === "object" &&
      "name" in context &&
      typeof context.name === "string"
        ? [context.name]
        : [],
    );
    return (
      <Message
        data-command-id={command.commandId}
        data-testid="agent-pending-command"
        from="user"
        key={command.commandId}
      >
        <MessageContent>
          <p className="text-muted-foreground text-xs">
            {command.state === "rejected"
              ? command.errorCode === "CANCELLED_BEFORE_DISPATCH"
                ? copy.cancelledBeforeSending
                : copy.notSent
              : command.state === "unknown" ||
                  command.state === "dispatching" ||
                  command.state === "observed"
                ? copy.confirming
                : copy.pending}
          </p>
          {command.state === "rejected" ? (
            <p className="text-muted-foreground text-xs">{copy.savedUnsentHint}</p>
          ) : null}
          {text ? (
            <p className="max-h-36 overflow-y-auto whitespace-pre-wrap break-words text-sm">
              {text}
            </p>
          ) : null}
          {filenames.length ? <p className="break-all text-xs">{filenames.join(" · ")}</p> : null}
          {contextNames.length ? (
            <p className="break-all text-xs">
              {copy.context}: {contextNames.join(" · ")}
            </p>
          ) : null}
        </MessageContent>
      </Message>
    );
  });
}
