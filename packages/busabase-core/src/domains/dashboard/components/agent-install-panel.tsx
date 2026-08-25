"use client";

import type { InstallPlanVO } from "busabase-contract/domains/install/types";
import { Alert, AlertDescription, AlertTitle } from "kui/alert";
import { Button } from "kui/button";
import { Check, Copy, Sparkles, TriangleAlert } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { buildAgentInstallPrompt, skillNameForSource } from "../helpers/agent-install-prompt";
import type { McpGuideEdition } from "./agent-mcp-guides";
import { AgentIntegrationDialog } from "./agent-skill-button";

/**
 * "Agent install" — the tab that installs nothing here.
 *
 * The other tab creates the app's resources in this space and leaves the user's
 * own agent none the wiser. This one is the mirror image: it hands the agent the
 * package's manual (`SKILL.md`, via `npx skills add`) and touches no data. Which
 * one a user wants depends on where they work, so the dialog asks instead of
 * guessing — and says plainly, on both tabs, what the other one does NOT do.
 *
 * Skill-less packages are the honest edge (spec §4.7): `skills add` would have
 * nothing to install, so rather than print a command that appears to work, the
 * panel says so and points at the other tab.
 */

/** What `AgentIntegrationDialog` needs to give the right connection guidance. */
export interface AgentIntegrationTarget {
  /** Cloud OAuth guidance vs Desktop's local no-auth guidance. */
  edition?: McpGuideEdition;
  /** SSR fallback origin, before the dialog reads `window.location.origin`. */
  defaultOrigin?: string;
  /** Cloud only: pins the copied setup prompt to the space being installed into. */
  targetSpaceId?: string;
}

export function AgentInstallPanel({
  plan,
  agentIntegration,
}: {
  plan: InstallPlanVO;
  agentIntegration?: AgentIntegrationTarget;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const [copied, setCopied] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  // A package with no skill node carries no manual — `counts.skills` is the
  // plan's own answer, so this stays true for packages the catalog never saw.
  const hasSkill = plan.counts.skills > 0;
  const appName = skillNameForSource(plan.source) ?? plan.package.name;
  const prompt = useMemo(
    () =>
      buildAgentInstallPrompt({
        source: plan.source,
        packageName: plan.package.name,
        template: messages.install.agentPromptBody,
        fmt,
      }),
    [messages.install.agentPromptBody, plan.package.name, plan.source],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // No clipboard permission, or a non-secure origin (a Desktop build reached
      // over plain http from another machine). Select the text so the user can
      // copy it by hand — the whole tab is that one paste, so a silent no-op
      // here would be the feature failing.
      promptRef.current?.select();
    }
  };

  if (!hasSkill) {
    return (
      <Alert>
        <TriangleAlert className="size-4" />
        <AlertTitle>{messages.install.agentNoSkillTitle}</AlertTitle>
        <AlertDescription>{messages.install.agentNoSkillBody}</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-muted-foreground text-sm">
        {fmt(messages.install.agentIntro, { name: appName })}
      </p>

      <div className="flex flex-col gap-2">
        <span className="font-medium text-foreground text-sm">
          {messages.install.agentPromptLabel}
        </span>
        <textarea
          ref={promptRef}
          className="min-h-40 resize-none rounded-md border border-border bg-muted/30 p-3 font-mono text-foreground text-xs leading-relaxed outline-none"
          readOnly
          value={prompt}
        />
        <div className="flex items-center justify-between gap-3">
          {plan.source.ref ? (
            <span className="text-muted-foreground text-xs">
              {fmt(messages.install.agentRefHint, { ref: plan.source.ref })}
            </span>
          ) : (
            <span />
          )}
          <Button className="shrink-0" onClick={() => void copy()} variant="outline">
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? messages.agentPrompts.copied : messages.agentPrompts.copy}
          </Button>
        </div>
      </div>

      {/* The skill explains the app; it does not grant access to it. Someone who
          pastes the prompt and stops here gets an agent that knows the manual and
          cannot reach a single record — so the connection step is offered right
          where that gap appears, not left to be discovered. */}
      <div className="flex flex-col gap-2 rounded-md border border-border p-3">
        <span className="font-medium text-foreground text-sm">
          {messages.install.agentConnectTitle}
        </span>
        <span className="text-muted-foreground text-xs">{messages.install.agentConnectBody}</span>
        <Button
          className="w-fit"
          onClick={() => setConnectOpen(true)}
          type="button"
          variant="outline"
        >
          <Sparkles className="size-4" />
          {messages.install.agentConnectAction}
        </Button>
      </div>

      <AgentIntegrationDialog
        defaultOrigin={agentIntegration?.defaultOrigin}
        edition={agentIntegration?.edition}
        editionConfirmed
        lang={locale}
        onOpenChange={setConnectOpen}
        open={connectOpen}
        targetSpaceId={agentIntegration?.targetSpaceId}
      />
    </div>
  );
}
