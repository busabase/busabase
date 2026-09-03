"use client";

// "Agent prompts" — per-node, copy-pasteable prompts. The sidebar presents the
// two tiers from `helpers/node-agent-prompts` as one continuous list:
//   Scenarios    — a top section of curated, task-shaped prompts per node type
//   Capabilities — exhaustive, auto-derived operations grouped by domain
//
// TWO entry points, and they are genuinely separate code surfaces — an item
// added to one does NOT show up in the other:
//   - `NodeActionsMenu`       → the "•••" dropdown on every node-detail topbar
//                               (Base / Doc / Folder / FileNode / FileTree /
//                               AirApp / rich-node). Base briefly needed its own
//                               standalone button because its header laid out
//                               individual action buttons instead of a "•••";
//                               that header now uses `NodeActionsMenu` like the
//                               rest, so the standalone button is gone.
//   - the sidebar row's "•••" → a separate `NavItemAction[]` list assembled in
//                               `dashboard-shell.tsx`; it renders through
//                               `openlib/ui/dashboard`'s `NavMain`, not through
//                               this file, so it is wired there via the
//                               `onOpenAgentPrompts` callback and opens this
//                               same dialog.
//
// Layout mirrors `agent-skill-button.tsx` (kui Dialog + readonly textarea +
// transient "Copied" state) so the two agent-facing dialogs feel like one feature.

import { useQuery } from "@tanstack/react-query";
import { hasApiKeyLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "kui/dialog";
import { Check, Copy, Loader2, Sparkles } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useCoreI18n, useCoreLocale } from "../../../i18n";
import { AgentTargetPicker } from "../../agents/components/agent-target-picker";
import { useAskAgent } from "../../agents/hooks/use-ask-agent";
import {
  buildNodeAgentPrompts,
  type NodePrompt,
  type NodePromptContext,
  type NodePromptScope,
} from "../helpers/node-agent-prompts";
import { useDashboardOrpc } from "../orpc-context";
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

/**
 * The space id used to tell the agent which space to target. Falls back to the
 * `/dashboard/<spaceId>/…` pathname when the caller can't hand one in — every
 * dashboard route is mounted under it. Same approach as `node-share-button`.
 */
const resolveSpaceId = (spaceId?: string): string | undefined => {
  if (spaceId) return spaceId;
  if (typeof window === "undefined") return undefined;
  return window.location.pathname.split("/").filter(Boolean)[1];
};

/** What the dialog header names: the node, or the column/record/cell inside it. */
const scopeSubject = (nodeName: string, scope?: NodePromptScope): string => {
  if (scope?.kind === "field") return `${nodeName} · ${scope.fieldName}`;
  if (scope?.kind === "record") return `${nodeName} · ${scope.recordTitle ?? scope.recordId}`;
  if (scope?.kind === "cell") {
    return `${nodeName} · ${scope.recordTitle ?? scope.recordId} · ${scope.fieldName}`;
  }
  return nodeName;
};

export function NodeAgentPromptsDialog({
  open,
  onOpenChange,
  nodeId,
  nodeName,
  nodeType,
  spaceId,
  spaceName,
  scope,
  orpc: orpcProp,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  nodeId: string;
  nodeName: string;
  nodeType: string;
  spaceId?: string;
  spaceName?: string;
  /** Narrows the prompts to one column or one record. Omit for the whole node. */
  scope?: NodePromptScope;
  /**
   * Fetches this node's custom prompts when the dialog opens.
   *
   * They used to arrive as the node's `metadata`, already loaded by the sidebar
   * list — free to read, but it meant every node in every listing carried a
   * field capped at 50 prompts x 8 KiB per locale. The list stopped carrying it,
   * so the dialog asks for it, and only while it is open.
   *
   * `null` means "do not fetch": a field/record/cell-scoped dialog never shows
   * custom prompts (they replace the WHOLE-NODE scenario tier only — see
   * `buildNodeAgentPrompts`'s `scope.kind` check), so a request there would be
   * pure waste. Required rather than optional precisely so that is a decision
   * each call site states, not something a caller can forget into a silent
   * fallback to the type defaults.
   */
  orpc: BusabaseQueryUtils | null;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  // Two ways in, because the two callers differ: the node-detail toolbars mount
  // inside `DashboardOrpcProvider` and let the context supply this, while the
  // shell's sidebar dialog passes it explicitly. An explicit prop wins; the
  // context is the fallback. Undefined for a host that never wired oRPC at all
  // (the chromeless mobile WebView, SSR) — Ask Agent is then simply not
  // offered, exactly as the shell's other orpc-gated actions behave.
  const orpcFromContext = useDashboardOrpc();
  const orpc = orpcProp ?? orpcFromContext;
  // Driving an agent is workspace `manage` (it can start arbitrary local code),
  // and the core router now enforces that. Hiding the button for anyone below
  // that bar keeps the offer honest — the server is still the authority, this
  // only avoids showing an action that would be refused. Copy stays available
  // to everyone: pasting a prompt into your own terminal needs no permission
  // from Busabase.
  const canAskAgent = hasApiKeyLevel(useWorkspacePermissionLevel(), "manage");
  const [resolvedSpaceId, setResolvedSpaceId] = useState<string | undefined>(spaceId);
  const [selected, setSelected] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Pathname is only readable after mount; keep SSR output stable.
  useEffect(() => {
    setResolvedSpaceId(resolveSpaceId(spaceId));
  }, [spaceId]);

  // `enabled: open` is the whole point of the move: closed dialogs cost nothing,
  // and the request starts the moment one opens rather than riding along on
  // every sidebar load whether or not anyone ever opens it.
  const promptsOptions = orpc?.nodes.getAgentPrompts.queryOptions({ input: { nodeId } });
  const promptsQuery = useQuery({
    queryKey: promptsOptions?.queryKey ?? ["node-agent-prompts", "not-fetched", nodeId],
    // Never runs — `enabled` is false whenever there are no real options — but
    // it has to satisfy the same result type so the query stays typed.
    queryFn: promptsOptions?.queryFn ?? (async () => ({ nodeId, agentPrompts: null })),
    enabled: open && promptsOptions !== undefined,
  });
  // A disabled query stays `pending` forever, so the spinner has to be gated on
  // there being a fetch at all — otherwise a scoped dialog, which deliberately
  // never fetches, would show a spinner that never resolves.
  const promptsLoading = promptsOptions !== undefined && promptsQuery.isPending;

  const context: NodePromptContext = useMemo(
    () => ({
      nodeType,
      nodeName,
      nodeId,
      spaceId: resolvedSpaceId,
      spaceName,
      scope,
      customPrompts: promptsQuery.data?.agentPrompts ?? undefined,
    }),
    [nodeType, nodeName, nodeId, resolvedSpaceId, spaceName, scope, promptsQuery.data],
  );

  const { scenarios, capabilities } = useMemo(
    () => buildNodeAgentPrompts(context, locale, messages),
    [context, locale, messages],
  );
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] gap-4 overflow-hidden sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {messages.agentPrompts.title}
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              {scopeSubject(nodeName, scope)}
            </span>
          </DialogTitle>
        </DialogHeader>
        <DialogDescription>{messages.agentPrompts.intro}</DialogDescription>

        {promptsLoading ? (
          // Only while the FIRST read is in flight. A node with no custom
          // prompts still renders its type's defaults, so showing those
          // immediately and swapping them for custom ones a moment later would
          // read as the dialog changing its mind — worse than a brief wait.
          <div
            className="flex min-h-40 items-center justify-center text-sm text-muted-foreground"
            data-testid="node-agent-prompts-loading"
          >
            {messages.common.loading}
          </div>
        ) : (
          <PromptPanel
            sections={sections}
            active={active}
            onSelect={setSelected}
            onCopy={copy}
            copied={copied}
            copyLabel={messages.agentPrompts.copy}
            copiedLabel={messages.agentPrompts.copied}
            askAgentSlot={
              orpc && canAskAgent ? (
                <AskAgentAction
                  nodeId={nodeId}
                  onClose={() => onOpenChange(false)}
                  orpc={orpc}
                  prompt={active}
                />
              ) : null
            }
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * "Ask Agent" — the same prompt the Copy button hands to the clipboard, handed
 * to an agent instead.
 *
 * Sits next to Copy rather than replacing it: copying is still the right move
 * when the agent lives in a terminal outside Busabase, and this feature is for
 * the agents Busabase can already talk to.
 */
function AskAgentAction({
  nodeId,
  onClose,
  orpc,
  prompt,
}: {
  nodeId: string;
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

  const ask = useAskAgent({ nodeId, onHandedOff: onClose, onNoAgents, orpc });

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
