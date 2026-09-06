"use client";

/**
 * The Agent-prompts surface itself — sectioned list, prompt preview, Copy, and
 * Ask Agent — with none of the framing.
 *
 * Extracted from `node-agent-prompts-dialog` when a second caller appeared: the
 * New-item modal's "let an Agent create it" tab. The two differ only in which
 * builder produced the prompts (`buildNodeAgentPrompts` for an existing node,
 * `buildCreateNodePrompts` for one that does not exist yet) and in what frames
 * them (a Dialog of its own vs. a tab inside another one). Everything below
 * that line — selection state, the copied flash, the permission gate on Ask
 * Agent — is identical, so it lives here once.
 */

import { hasApiKeyLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { Check, Copy } from "lucide-react";
import { type ReactNode, useMemo, useState } from "react";
import { useCoreI18n } from "../../../i18n";
import { AskAgentAction } from "../../agents/components/ask-agent-action";
import type { NodePrompt } from "../helpers/node-agent-prompts";
import { useWorkspacePermissionLevel } from "./split-submit-button";

export interface PromptSection {
  name: string;
  items: NodePrompt[];
}

/** Build the single sidebar: curated scenarios first, then capability groups. */
export const buildPromptSections = (
  scenarios: NodePrompt[],
  capabilities: NodePrompt[],
  scenariosLabel: string,
): PromptSection[] => {
  const sections: PromptSection[] = [];
  if (scenarios.length > 0) {
    sections.push({ name: scenariosLabel, items: scenarios });
  }

  const capabilitySections = new Map<string, NodePrompt[]>();
  for (const prompt of capabilities) {
    const bucket = capabilitySections.get(prompt.group);
    if (bucket) bucket.push(prompt);
    else capabilitySections.set(prompt.group, [prompt]);
  }

  return [
    ...sections,
    ...[...capabilitySections.entries()].map(([name, items]) => ({ name, items })),
  ];
};

export const resolveActivePrompt = (
  sections: PromptSection[],
  selected: string | null,
): NodePrompt | undefined => {
  const prompts = sections.flatMap((section) => section.items);
  return prompts.find((prompt) => prompt.key === selected) ?? prompts[0];
};

export function AgentPromptsView({
  scenarios,
  capabilities,
  loading = false,
  askAgent,
  onHandedOff,
}: {
  scenarios: NodePrompt[];
  capabilities: NodePrompt[];
  /** Only while a first read of custom prompts is in flight. */
  loading?: boolean;
  /**
   * Enables Ask Agent. `null` for a host that never wired oRPC (the chromeless
   * mobile WebView, SSR) — the action is then simply not offered, exactly as
   * the shell's other orpc-gated actions behave. Copy stays available to
   * everyone: pasting a prompt into your own terminal needs no permission from
   * Busabase.
   */
  askAgent: { sessionScopeId: string; orpc: BusabaseQueryUtils } | null;
  /** Close whatever frames this once the prompt has been handed to an agent. */
  onHandedOff: () => void;
}) {
  const messages = useCoreI18n();
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Driving an agent is workspace `manage` (it can start arbitrary local code),
  // and the core router now enforces that. Hiding the button for anyone below
  // that bar keeps the offer honest — the server is still the authority, this
  // only avoids showing an action that would be refused.
  const canAskAgent = hasApiKeyLevel(useWorkspacePermissionLevel(), "manage");

  const sections = useMemo(
    () => buildPromptSections(scenarios, capabilities, messages.agentPrompts.scenariosTab),
    [scenarios, capabilities, messages.agentPrompts.scenariosTab],
  );
  const active = resolveActivePrompt(sections, selected);

  const copy = async () => {
    if (!active) return;
    await navigator.clipboard.writeText(active.body);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  if (loading) {
    // Only while the FIRST read is in flight. A node with no custom prompts
    // still renders its type's defaults, so showing those immediately and
    // swapping them for custom ones a moment later would read as the dialog
    // changing its mind — worse than a brief wait.
    return (
      <div
        className="flex min-h-40 items-center justify-center text-sm text-muted-foreground"
        data-testid="node-agent-prompts-loading"
      >
        {messages.common.loading}
      </div>
    );
  }

  return (
    <PromptPanel
      active={active}
      askAgentSlot={
        askAgent && canAskAgent ? (
          <AskAgentAction
            onClose={onHandedOff}
            orpc={askAgent.orpc}
            prompt={active}
            sessionScopeId={askAgent.sessionScopeId}
          />
        ) : null
      }
      copied={copied}
      copiedLabel={messages.agentPrompts.copied}
      copyLabel={messages.agentPrompts.copy}
      onCopy={copy}
      onSelect={setSelected}
      sections={sections}
    />
  );
}

/** Sectioned list (left) + preview & actions (right). */
function PromptPanel({
  sections,
  active,
  onSelect,
  onCopy,
  copied,
  copyLabel,
  copiedLabel,
  askAgentSlot,
}: {
  sections: PromptSection[];
  active?: NodePrompt;
  onSelect: (key: string) => void;
  onCopy: () => void;
  copied: boolean;
  copyLabel: string;
  copiedLabel: string;
  /** Ask Agent, or null when no host wired oRPC. Rendered beside Copy. */
  askAgentSlot?: ReactNode;
}) {
  return (
    <div className="grid min-h-0 gap-3 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]">
      <div className="max-h-[28vh] overflow-y-auto rounded-md border p-1 sm:max-h-[46vh]">
        {sections.map((section) => (
          <div key={section.name}>
            <div className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
              {section.name}
            </div>
            {section.items.map((prompt) => {
              const isActive = active?.key === prompt.key;
              return (
                <button
                  className={`w-full truncate rounded px-2 py-1.5 text-left text-sm ${
                    isActive ? "bg-muted font-medium text-foreground" : "hover:bg-muted/60"
                  }`}
                  key={prompt.key}
                  onClick={() => onSelect(prompt.key)}
                  title={prompt.label}
                  type="button"
                >
                  {prompt.label}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex min-h-0 flex-col gap-2">
        <textarea
          className="min-h-[24vh] resize-none rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed text-foreground outline-none sm:min-h-[46vh]"
          readOnly
          value={active?.body ?? ""}
        />
        <div className="flex flex-wrap items-start justify-end gap-2">
          {askAgentSlot}
          <button
            className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border bg-card px-3 text-sm font-medium hover:bg-muted"
            onClick={onCopy}
            type="button"
          >
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? copiedLabel : copyLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
