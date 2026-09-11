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
import { fmt, useCoreI18n } from "../../../i18n";
import { AskAgentAction } from "../../agents/components/ask-agent-action";
import { useAgentIntegrationTarget } from "../agent-integration-context";
import { renderPromptForDispatch } from "../helpers/agent-prompt-dispatch";
import type { NodePrompt } from "../helpers/node-agent-prompts";
import type { AgentIntegrationTarget } from "./agent-install-panel";
import { createSetupSkillUrl } from "./agent-skill-button";
import { useWorkspacePermissionLevel } from "./split-submit-button";

export interface PromptSection {
  name: string;
  items: NodePrompt[];
}

export type AgentPromptsLayout = "compact" | "page";

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
  layout = "compact",
  agentIntegration: agentIntegrationProp,
  askAgent,
  onHandedOff,
}: {
  scenarios: NodePrompt[];
  capabilities: NodePrompt[];
  /** Only while a first read of custom prompts is in flight. */
  loading?: boolean;
  /** Full-height workspace for a node tab; compact keeps the dialog/modal layout. */
  layout?: AgentPromptsLayout;
  /**
   * Which Busabase to point the agent at, for the connection check appended on
   * the way out (see `renderPromptForDispatch`).
   *
   * Two ways in, mirroring how `NodeAgentPromptsDialog` takes `orpc`: hosts that
   * render this inside `BusabaseDashboard` let the context supply it, while the
   * New-item modal and the shell's sidebar dialog — which hosts mount outside
   * that provider — pass it explicitly. An explicit prop wins.
   */
  agentIntegration?: AgentIntegrationTarget;
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
  const agentIntegrationFromContext = useAgentIntegrationTarget();
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

  const agentIntegration = agentIntegrationProp ?? agentIntegrationFromContext;
  const edition = agentIntegration?.edition;
  // A stray targetSpaceId from a host must never leak into Desktop guidance —
  // same guard `AgentInstallPanel` applies to the same field.
  const targetSpaceId = edition === "cloud" ? agentIntegration?.targetSpaceId : undefined;

  /**
   * The bytes that actually leave — body plus the connection check.
   *
   * The origin is read at dispatch time rather than at render time, and there is
   * no fallback to the host's `defaultOrigin`: that value is an SSR placeholder
   * (see `AgentInstallPanel`, which rebuilds for the same reason), and a
   * placeholder dev URL reaching a real agent is exactly the failure the
   * rebuild exists to prevent.
   */
  const dispatchText = (prompt: NodePrompt): string => {
    const origin = typeof window === "undefined" ? undefined : window.location.origin;
    return renderPromptForDispatch({
      body: prompt.body,
      connectionCheck: messages.agentPrompts.connectionCheck,
      fmt,
      leadIn: messages.agentPrompts.connectionCheckLeadIn,
      // `editionConfirmed` is true because a dashboard node is as authoritative
      // as an entry point gets: we know which edition the user is looking at,
      // so the guide should not stop to ask them again.
      setupUrl:
        edition && origin ? createSetupSkillUrl(origin, edition, true, targetSpaceId) : undefined,
      targetSpaceId,
    });
  };

  const copy = async () => {
    if (!active) return;
    await navigator.clipboard.writeText(dispatchText(active));
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
            // The dispatch rendering, NOT `active.body`: Ask Agent and Copy must
            // hand over the same bytes, and the only way to guarantee that is
            // for neither of them to assemble its own.
            promptText={active ? dispatchText(active) : undefined}
            sessionScopeId={askAgent.sessionScopeId}
          />
        ) : null
      }
      copied={copied}
      copiedLabel={messages.agentPrompts.copied}
      copyLabel={messages.agentPrompts.copy}
      // Gated on the edition alone, not on the resolved URL: the URL needs
      // `window`, so testing it here would make the note flip between the server
      // and client renders of the same screen.
      dispatchNote={edition ? messages.agentPrompts.connectionCheckNote : undefined}
      layout={layout}
      navigationLabel={messages.agentPrompts.title}
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
  dispatchNote,
  layout,
  navigationLabel,
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
  /**
   * One line under the preview saying the connection check rides along, or
   * `undefined` when nothing will be appended. The preview deliberately does not
   * show that paragraph, so without this the box would be quietly lying about
   * what the Copy button produces.
   */
  dispatchNote?: string;
  layout: AgentPromptsLayout;
  navigationLabel: string;
}) {
  const promptList = sections.map((section) => (
    <section key={section.name}>
      <h3
        className={
          layout === "page"
            ? "px-2 pt-3 pb-1 text-xs text-muted-foreground"
            : "px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground"
        }
      >
        {section.name}
      </h3>
      {section.items.map((prompt) => {
        const isActive = active?.key === prompt.key;
        return (
          <button
            aria-current={isActive ? "true" : undefined}
            className={
              layout === "page"
                ? `w-full rounded-lg px-2.5 py-2 text-left text-sm leading-5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    isActive
                      ? "bg-card text-foreground"
                      : "text-muted-foreground hover:bg-background/60 hover:text-foreground"
                  }`
                : `w-full truncate rounded px-2 py-1.5 text-left text-sm ${
                    isActive ? "bg-muted font-medium text-foreground" : "hover:bg-muted/60"
                  }`
            }
            key={prompt.key}
            onClick={() => onSelect(prompt.key)}
            title={prompt.label}
            type="button"
          >
            <span className={layout === "page" ? "line-clamp-2" : undefined}>{prompt.label}</span>
          </button>
        );
      })}
    </section>
  ));

  const copyButton = (
    <button
      className={
        layout === "page"
          ? "inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-muted px-3 text-sm transition-colors hover:bg-muted/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:translate-y-px"
          : "inline-flex h-9 shrink-0 items-center gap-2 rounded-md border bg-card px-3 text-sm font-medium hover:bg-muted"
      }
      onClick={onCopy}
      type="button"
    >
      {copied ? <Check size={16} /> : <Copy size={16} />}
      {copied ? copiedLabel : copyLabel}
    </button>
  );

  if (layout === "page") {
    return (
      <div
        className="grid h-full min-h-0 grid-rows-[14rem_minmax(0,1fr)] overflow-hidden bg-background md:grid-cols-[17rem_minmax(0,1fr)] md:grid-rows-1"
        data-layout="page"
      >
        <nav aria-label={navigationLabel} className="min-h-0 overflow-y-auto bg-muted/25 px-2 py-2">
          {promptList}
        </nav>

        <section className="flex min-h-0 flex-col overflow-hidden">
          <header className="flex shrink-0 flex-col items-stretch gap-3 px-5 pt-5 pb-4 md:flex-row md:items-start md:justify-between md:px-8 md:pt-7">
            <h2 className="min-w-0 text-base text-foreground leading-6 md:flex-1">
              {active?.label ?? ""}
            </h2>
            <div className="flex max-w-full items-start gap-2 md:shrink-0 md:justify-end">
              {askAgentSlot ? <div className="flex min-w-0">{askAgentSlot}</div> : null}
              {copyButton}
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-8 md:px-8">
            <pre className="w-full whitespace-pre-wrap break-words rounded-lg bg-card p-4 font-sans text-foreground text-sm leading-7 md:p-6">
              {active?.body ?? ""}
            </pre>
            {dispatchNote ? (
              <p className="mt-2 text-muted-foreground text-xs leading-5">{dispatchNote}</p>
            ) : null}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div
      className="grid min-h-0 gap-3 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]"
      data-layout="compact"
    >
      <div className="max-h-[28vh] overflow-y-auto rounded-md border p-1 sm:max-h-[46vh]">
        {promptList}
      </div>

      <div className="flex min-h-0 flex-col gap-2">
        <textarea
          className="min-h-[24vh] resize-none rounded-md border bg-muted/30 p-3 font-mono text-xs leading-relaxed text-foreground outline-none sm:min-h-[46vh]"
          readOnly
          value={active?.body ?? ""}
        />
        {dispatchNote ? (
          <p className="text-muted-foreground text-xs leading-5">{dispatchNote}</p>
        ) : null}
        <div className="flex flex-wrap items-start justify-end gap-2">
          {askAgentSlot}
          {copyButton}
        </div>
      </div>
    </div>
  );
}
