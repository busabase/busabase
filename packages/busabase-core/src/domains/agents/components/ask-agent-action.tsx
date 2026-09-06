"use client";

/**
 * "Ask Agent" — the same prompt the Copy button hands to the clipboard, handed
 * to an agent instead.
 *
 * Sits next to Copy rather than replacing it: copying is still the right move
 * when the agent lives in a terminal outside Busabase, and this feature is for
 * the agents Busabase can already talk to.
 *
 * Lives in the agents domain rather than in the prompts dialog it was written
 * for, because none of it is about prompts — it is catalog → target → session →
 * side panel, and it now has two callers: the per-node prompts dialog and the
 * "let an Agent create it" tab of the New-item modal.
 */

import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { useCallback } from "react";
import { useLocation } from "wouter";
import { useCoreI18n } from "../../../i18n";
import type { NodePrompt } from "../../dashboard/helpers/node-agent-prompts";
import { useAskAgent } from "../hooks/use-ask-agent";
import { AgentTargetPicker } from "./agent-target-picker";

export function AskAgentAction({
  sessionScopeId,
  onClose,
  orpc,
  prompt,
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
  prompt?: NodePrompt;
}) {
  const messages = useCoreI18n();
  const [, setLocation] = useLocation();

  const onNoAgents = useCallback(() => {
    // Only reached on a *successful* empty catalog (see `use-ask-agent`) —
    // there is genuinely nothing connected, so the honest next step is the
    // flow that connects one.
    onClose();
    setLocation("/agents/new");
  }, [onClose, setLocation]);

  const ask = useAskAgent({ nodeId: sessionScopeId, onHandedOff: onClose, onNoAgents, orpc });

  if (ask.targets) {
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p className="text-muted-foreground text-xs">{messages.agentPrompts.pickAgent}</p>
        <AgentTargetPicker
          disabled={ask.isStarting}
          emptyLabel={messages.agentPrompts.noAgents}
          onSelect={ask.pickTarget}
          targets={ask.targets}
        />
        {ask.startError ? <AskAgentError message={ask.startError} onRetry={ask.reset} /> : null}
      </div>
    );
  }

  if (ask.loadError) {
    return <AskAgentError message={messages.agentPrompts.askAgentLoadFailed} onRetry={ask.retry} />;
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col items-start gap-2">
      <button
        className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-60"
        disabled={!prompt || ask.isLoading || ask.isStarting}
        onClick={() => prompt && ask.ask(prompt.body)}
        type="button"
      >
        {ask.isLoading || ask.isStarting ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Sparkles className="size-4" />
        )}
        {ask.isStarting
          ? messages.agentPrompts.askAgentStarting
          : ask.isLoading
            ? messages.agentPrompts.askAgentLoading
            : messages.agentPrompts.askAgent}
      </button>
      {ask.startError ? <AskAgentError message={ask.startError} onRetry={ask.reset} /> : null}
    </div>
  );
}

/**
 * A failure that keeps the dialog — and the selected prompt — exactly where
 * they were. The whole point: a network blip must not cost the user the prompt
 * they had chosen, nor be mistaken for "you have no agents".
 */
function AskAgentError({ message, onRetry }: { message: string; onRetry: () => void }) {
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
    </div>
  );
}
