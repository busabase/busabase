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

import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { Button } from "kui/button";
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
  orpc,
}: {
  nodeId: string;
  nodeName: string;
  nodeType: string;
  /** Narrows the prompts to one column or one record. Omit for the whole node. */
  scope?: NodePromptScope;
  spaceId?: string;
  spaceName?: string;
  /** Fetches this node's custom prompts once the dialog opens; `null` for a
   *  scoped dialog, which never shows them. See the dialog's `orpc` doc. */
  orpc: BusabaseQueryUtils | null;
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
      <Button
        aria-label={messages.agentPrompts.title}
        aria-expanded={open}
        className="size-8 text-ai-strong shadow-none hover:bg-ai/17 hover:text-ai-strong data-[state=open]:bg-ai/17 dark:text-ai-soft dark:hover:text-ai-soft"
        data-testid="node-agent-prompts-button"
        data-state={open ? "open" : "closed"}
        onClick={() => setOpen(true)}
        size="icon"
        title={messages.agentPrompts.title}
        type="button"
        variant="ghost"
      >
        <Sparkles className="size-3.5" />
      </Button>
      {open && (
        <NodeAgentPromptsDialog
          orpc={orpc}
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
