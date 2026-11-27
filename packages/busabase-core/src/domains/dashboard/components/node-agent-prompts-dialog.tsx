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
import type { NodePromptScope } from "../helpers/node-agent-prompts";
import { useNodeLocator } from "../hooks/use-copy-locator";
import { useNodeAgentPrompts } from "../hooks/use-node-agent-prompts";
import { useDashboardOrpc } from "../orpc-context";
import type { AgentIntegrationTarget } from "./agent-install-panel";
import { AgentPromptsDialog } from "./agent-prompts-dialog";

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
  agentIntegration: explicitAgentIntegration,
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
   * A non-null prop wins; otherwise the dashboard context supplies the client.
   * Field/record/cell scopes skip the custom-prompt read regardless of where
   * the client came from, while keeping that client available for Ask Agent.
   */
  orpc: BusabaseQueryUtils | null;
}) {
  // Node-detail toolbars use the dashboard context; the shell's sidebar dialog
  // passes the client explicitly. Hosts with neither keep both Agent actions
  // and custom-prompt loading unavailable without breaking the prompt viewer.
  const orpcFromContext = useDashboardOrpc();
  const orpc = orpcProp ?? orpcFromContext;
  // Driving an agent is workspace `manage` (it can start arbitrary local code),
  // and the core router now enforces that. Hiding the button for anyone below
  // that bar keeps the offer honest — the server is still the authority, this
  // only avoids showing an action that would be refused. Copy stays available
  // to everyone: pasting a prompt into your own terminal needs no permission
  // from Busabase.
  // Closed dialogs cost nothing. Custom prompts extend the whole-node scenario
  // tier only, so scope is the authority for whether this read may run; the
  // resolved client can still power Ask Agent in a scoped dialog.
  const {
    scenarios,
    capabilities,
    customPrompts,
    canSaveCustomPrompts,
    saving,
    saveCustomPrompts,
    loading: promptsLoading,
  } = useNodeAgentPrompts({
    enabled: open && (scope === undefined || scope.kind === "node"),
    nodeId,
    nodeName,
    nodeType,
    orpc,
    scope,
    // Sidebar dialogs are outside the integration provider; toolbars use the
    // hook's canonical target from context when no explicit target is passed.
    spaceId: spaceId ?? explicitAgentIntegration?.targetSpaceId,
    spaceName,
  });
  const locator = useNodeLocator({
    agentIntegration: explicitAgentIntegration,
    nodeId,
    nodeName,
    nodeType,
    scope,
    spaceId: spaceId ?? explicitAgentIntegration?.targetSpaceId,
    spaceName,
  });
  return (
    <AgentPromptsDialog
      open={open}
      onOpenChange={onOpenChange}
      subject={scopeSubject(nodeName, scope)}
      agentIntegration={explicitAgentIntegration}
      askAgent={orpc ? { orpc, sessionScopeId: nodeId } : null}
      capabilities={capabilities}
      loading={promptsLoading}
      locator={locator}
      recents={{ kind: "node", nodeType, scopeKind: scope?.kind ?? "node" }}
      management={
        orpc && (!scope || scope.kind === "node")
          ? {
              customPrompts,
              canSave: canSaveCustomPrompts,
              saving,
              save: saveCustomPrompts,
            }
          : null
      }
      scenarios={scenarios}
    />
  );
}
