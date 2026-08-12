"use client";

// The "Agent prompts" trigger as a FIRST-CLASS toolbar button, next to Pin and
// the "•••" menu on every node-detail header — not an item buried inside that
// menu.
//
// Why it was promoted out of `NodeActionsMenu`: Busabase's premise is that you
// drive your knowledge base through your own agent, and for some node types
// (Form above all — its page is agent-authored HTML with no GUI builder) the
// prompt list is not a convenience, it is the primary way to change the thing.
// An entry point that costs a click into an unlabelled "•••" is one most people
// never find. It lives in exactly ONE place per toolbar: the dropdown item is
// gone, so this button and that menu can't drift apart.
//
// The sidebar row keeps its own menu item — a sidebar row has no toolbar to put
// a button in, and it opens the same dialog (see `dashboard-shell.tsx`'s
// `onOpenAgentPrompts`).

import { Sparkles } from "lucide-react";
import { useState } from "react";
import { useCoreI18n } from "../../../i18n";
import type { NodePromptScope } from "../helpers/node-agent-prompts";
import { useIsAnonymousVisitor } from "../visitor-context";
import { NodeAgentPromptsDialog } from "./node-agent-prompts-dialog";

export function NodeAgentPromptsButton({
  nodeId,
  nodeName,
  nodeType,
  scope,
  spaceId,
  spaceName,
}: {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  /** Narrows the prompts to one column or one record. Omit for the whole node. */
  scope?: NodePromptScope;
  spaceId?: string;
  spaceName?: string;
}) {
  const messages = useCoreI18n();
  const [open, setOpen] = useState(false);
  // A public-link visitor has no agent to drive this workspace with, and every
  // prompt is phrased as an instruction to change it — same self-gate the other
  // action buttons in this domain use.
  const isAnon = useIsAnonymousVisitor();
  if (isAnon) {
    return null;
  }

  return (
    <>
      <button
        aria-label={messages.agentPrompts.title}
        className="inline-flex shrink-0 items-center justify-center rounded-md border border-border/60 bg-card p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        data-testid="node-agent-prompts-button"
        onClick={() => setOpen(true)}
        title={messages.agentPrompts.title}
        type="button"
      >
        <Sparkles className="size-3.5" />
      </button>
      {open && (
        <NodeAgentPromptsDialog
          nodeId={nodeId}
          nodeName={nodeName}
          nodeType={nodeType}
          onOpenChange={setOpen}
          open={open}
          scope={scope}
          spaceId={spaceId}
          spaceName={spaceName}
        />
      )}
    </>
  );
}
