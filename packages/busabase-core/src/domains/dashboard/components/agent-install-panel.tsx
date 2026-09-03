"use client";

import type { InstallPlanVO } from "busabase-contract/domains/install/types";
import { Alert, AlertDescription, AlertTitle } from "kui/alert";
import { Button } from "kui/button";
import { Check, Copy, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fmt, useCoreI18n } from "../../../i18n";
import { buildAgentInstallPrompt, skillNameForSource } from "../helpers/agent-install-prompt";
import type { McpGuideEdition } from "./agent-mcp-guides";
import { createSetupSkillUrl } from "./agent-skill-button";

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

/** What the copied prompt needs to give the right connection guidance. */
export interface AgentIntegrationTarget {
  /** Cloud OAuth guidance vs Desktop's local no-auth guidance. */
  edition?: McpGuideEdition;
  /** SSR fallback origin, before the panel reads `window.location.origin`. */
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
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState(agentIntegration?.defaultOrigin ?? "http://localhost:15419");
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  // A package with no skill node carries no manual — `counts.skills` is the
  // plan's own answer, so this stays true for packages the catalog never saw.
  const hasSkill = plan.counts.skills > 0;
  const appName = skillNameForSource(plan.source) ?? plan.package.name;
  const edition = agentIntegration?.edition ?? "desktop";
  // A stray targetSpaceId from a host must never leak into Desktop guidance.
  const targetSpaceId = edition === "cloud" ? agentIntegration?.targetSpaceId : undefined;
  const buildPromptForOrigin = (promptOrigin: string) =>
    buildAgentInstallPrompt({
      source: plan.source,
      packageName: plan.package.name,
      setupUrl: createSetupSkillUrl(promptOrigin, edition, true, targetSpaceId),
      targetSpaceId,
      template: messages.install.agentPromptBody,
      fmt,
    });
  const prompt = buildPromptForOrigin(origin);

  const copy = async () => {
    try {
      // The textarea has an SSR-safe fallback URL. At the moment of copying,
      // always rebuild from the browser origin so a host's placeholder dev URL
      // can never reach the user's agent.
      await navigator.clipboard.writeText(buildPromptForOrigin(window.location.origin));
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
        <div className="flex justify-end">
          <Button className="shrink-0" onClick={() => void copy()}>
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? messages.agentPrompts.copied : messages.agentPrompts.copy}
          </Button>
        </div>
      </div>
    </div>
  );
}
