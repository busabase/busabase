"use client";

/**
 * "Ask Agent" — the same prompt the Copy button hands to the clipboard, handed
 * to an agent instead.
 *
 * It is the primary footer action. Copy remains a compact preview utility for
 * agents running in a terminal outside Busabase.
 *
 * Lives in the agents domain rather than in the prompts dialog it was written
 * for, because none of it is about prompts — it is catalog → target → session →
 * side panel, and it now has two callers: the per-node prompts dialog and the
 * "let an Agent create it" tab of the New-item modal.
 */

import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useCoreI18n } from "../../../i18n";
import { useAskAgent } from "../hooks/use-ask-agent";
import { AgentTargetPicker } from "./agent-target-picker";

export function AskAgentAction({
  sessionScopeId,
  onClose,
  orpc,
  promptText,
}: {
  /**
   * Which conversation this belongs to — one session per scope, per agent (see
   * `utils/node-agent-sessions`). For the per-node dialog that is the node's
   * id, which is what the rule was written for. The create flow has no node
   * yet, so it passes the parent folder's id, or the space id at the root:
   * asking an agent to create three things in a row is one conversation, and
   * the alternative — a fresh session per click — would drop the context of
   * what it just built.
   */
  sessionScopeId: string;
  onClose: () => void;
  orpc: BusabaseQueryUtils;
  /**
   * The finished text to send — already through `renderPromptForDispatch`, so
   * it carries the connection check the preview does not show.
   *
   * A plain string rather than the `NodePrompt`, deliberately: this used to take
   * the prompt and read `.body` off it, which meant Ask Agent and Copy each
   * decided for themselves what "the prompt" was. There is now one renderer and
   * one caller of it, and this signature makes taking a second route a type
   * error rather than a silent divergence.
   */
  promptText?: string;
}) {
  const messages = useCoreI18n();
  const [, setLocation] = useLocation();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasHandoffActiveRef = useRef(false);
  const [startingTargetName, setStartingTargetName] = useState<string | null>(null);

  const onNoAgents = useCallback(() => {
    // Only reached on a *successful* empty catalog (see `use-ask-agent`) —
    // there is genuinely nothing connected, so the honest next step is the
    // flow that connects one.
    onClose();
    setLocation("/agents/new");
  }, [onClose, setLocation]);

  const ask = useAskAgent({ nodeId: sessionScopeId, onHandedOff: onClose, onNoAgents, orpc });
  const handoffActive = ask.isActive || ask.isLoading || ask.loadError || ask.targets !== null;
  const promptTextRef = useRef(promptText);

  useEffect(() => {
    if (handoffActive) {
      wasHandoffActiveRef.current = true;
      return;
    }
    if (wasHandoffActiveRef.current) {
      wasHandoffActiveRef.current = false;
      triggerRef.current?.focus();
    }
  }, [handoffActive]);

  const resetHandoff = () => {
    setStartingTargetName(null);
    ask.reset();
  };

  // Invalidate before useAskAgent's passive resolver can hand off a stale prompt.
  // Keep the old marker while starting so a failed start resets once targets
  // become interactive again; a successful in-flight handoff is left alone.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `resetHandoff` is a fresh closure per render; adding it re-runs this on every render.
  useLayoutEffect(() => {
    if (ask.isStarting) return;
    const changed = promptTextRef.current !== promptText;
    promptTextRef.current = promptText;
    if (changed && handoffActive) resetHandoff();
  }, [promptText, handoffActive, ask.isStarting]);

  // Catalog/session lookup is in flight for a click the user already made —
  // show that something is happening rather than leaving the button's own
  // spinner as the only sign of life once the picker's container has mounted.
  if (ask.isLoading) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-between gap-2 text-xs">
        <div
          aria-live="polite"
          className="flex min-w-0 items-center gap-2 text-muted-foreground"
          role="status"
        >
          <Loader2 aria-hidden className="size-4 shrink-0 animate-spin" />
          {messages.agentPrompts.askAgentLoading}
        </div>
        <BackButton onClick={resetHandoff} />
      </div>
    );
  }

  if (ask.targets) {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs" id="ask-agent-pick-label">
            {messages.agentPrompts.pickAgent}
          </p>
          <button
            className="shrink-0 text-muted-foreground text-xs underline underline-offset-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-60"
            disabled={ask.isStarting}
            onClick={resetHandoff}
            type="button"
          >
            {messages.agentPrompts.askAgentCancel}
          </button>
        </div>
        <AgentTargetPicker
          autoFocus
          disabled={ask.isStarting}
          emptyLabel={messages.agentPrompts.noAgents}
          label={messages.agentPrompts.pickAgent}
          onSelect={(target) => {
            setStartingTargetName(target.name);
            ask.pickTarget(target);
          }}
          targets={ask.targets}
        />
        {ask.isStarting ? (
          <p aria-live="polite" className="text-muted-foreground text-xs" role="status">
            {startingTargetName ? `${startingTargetName} — ` : null}
            {messages.agentPrompts.askAgentStarting}
          </p>
        ) : null}
        {ask.startError ? <AskAgentError message={ask.startError} onRetry={resetHandoff} /> : null}
      </div>
    );
  }

  if (ask.loadError) {
    return (
      <AskAgentError
        message={messages.agentPrompts.askAgentLoadFailed}
        onBack={resetHandoff}
        onRetry={ask.retry}
      />
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col items-end gap-2">
      <button
        className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-60"
        disabled={!promptText || ask.isStarting}
        onClick={() => promptText && ask.ask(promptText)}
        ref={triggerRef}
        type="button"
      >
        {ask.isStarting ? (
          <Loader2 aria-hidden className="size-4 animate-spin" />
        ) : (
          <Sparkles aria-hidden className="size-4" />
        )}
        {ask.isStarting ? messages.agentPrompts.askAgentStarting : messages.agentPrompts.askAgent}
      </button>
      {ask.startError ? <AskAgentError message={ask.startError} onRetry={resetHandoff} /> : null}
    </div>
  );
}

/**
 * A failure that keeps the dialog — and the selected prompt — exactly where
 * they were. The whole point: a network blip must not cost the user the prompt
 * they had chosen, nor be mistaken for "you have no agents".
 */
function AskAgentError({
  message,
  onRetry,
  onBack,
}: {
  message: string;
  onRetry: () => void;
  onBack?: () => void;
}) {
  const messages = useCoreI18n();
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2 text-destructive text-xs">
      <span className="min-w-0 flex-1 truncate" title={message}>
        {message}
      </span>
      <button
        className="shrink-0 rounded border px-2 py-1 font-medium text-foreground hover:bg-muted"
        onClick={onRetry}
        type="button"
      >
        {messages.agentPrompts.askAgentRetry}
      </button>
      {onBack ? <BackButton onClick={onBack} /> : null}
    </div>
  );
}

function BackButton({ onClick }: { onClick: () => void }) {
  const messages = useCoreI18n();
  return (
    <button
      className="shrink-0 rounded border px-2 py-1 font-medium text-foreground hover:bg-muted"
      onClick={onClick}
      type="button"
    >
      {messages.agentPrompts.askAgentBack}
    </button>
  );
}
