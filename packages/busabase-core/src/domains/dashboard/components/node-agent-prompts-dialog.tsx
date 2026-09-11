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

import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "kui/dialog";
import { useEffect, useState } from "react";
import { useCoreI18n } from "../../../i18n";
import type { NodePromptScope } from "../helpers/node-agent-prompts";
import { useNodeAgentPrompts } from "../hooks/use-node-agent-prompts";
import { useDashboardOrpc } from "../orpc-context";
import type { AgentIntegrationTarget } from "./agent-install-panel";
import { AgentPromptsView } from "./agent-prompts-view";

/**
 * The space id used to tell the agent which space to target. Falls back to the
 * `/dashboard/<spaceId>/…` pathname when the caller can't hand one in — every
 * dashboard route is mounted under it. Same approach as `node-share-button`.
 *
 * Exported because the New-item modal's create-prompts tab needs the identical
 * fallback: it also names a space in its target line, and also has callers that
 * do not thread a space id down.
 */
export const resolveSpaceId = (spaceId?: string): string | undefined => {
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
  agentIntegration,
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
   * Which edition/space the copied prompt should tell an agent to connect to.
   *
   * Same two ways in as `orpc` below, and for the same reason: node toolbars sit
   * inside `AgentIntegrationProvider` and let the context supply it, while the
   * shell's sidebar dialog — which the host mounts as chrome AROUND the
   * dashboard, outside that provider — passes it explicitly.
   */
  agentIntegration?: AgentIntegrationTarget;
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
  const [resolvedSpaceId, setResolvedSpaceId] = useState<string | undefined>(spaceId);

  // Pathname is only readable after mount; keep SSR output stable.
  useEffect(() => {
    setResolvedSpaceId(resolveSpaceId(spaceId));
  }, [spaceId]);

  // `enabled: open` is the whole point of the fetch living here: closed dialogs
  // cost nothing, and the request starts the moment one opens rather than riding
  // along on every sidebar load whether or not anyone ever opens it.
  const {
    scenarios,
    capabilities,
    loading: promptsLoading,
  } = useNodeAgentPrompts({
    enabled: open,
    nodeId,
    nodeName,
    nodeType,
    orpc,
    scope,
    spaceId: resolvedSpaceId,
    spaceName,
  });
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

        <AgentPromptsView
          agentIntegration={agentIntegration}
          askAgent={orpc ? { orpc, sessionScopeId: nodeId } : null}
          capabilities={capabilities}
          loading={promptsLoading}
          onHandedOff={() => onOpenChange(false)}
          scenarios={scenarios}
        />
      </DialogContent>
    </Dialog>
  );
}
