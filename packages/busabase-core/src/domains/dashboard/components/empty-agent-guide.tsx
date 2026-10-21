"use client";

import { AppWindow, BookOpen, Database, Plus, Shapes, Sparkles } from "lucide-react";
import { SPALink } from "openlib/ui/dashboard";
import { Fragment, useState } from "react";
import { useCoreI18n } from "../../../i18n";
import type { McpGuideEdition } from "./agent-mcp-guides";
import { AgentIntegrationDialog } from "./agent-skill-button";

interface EmptyAgentGuideProps {
  /** Selects Cloud OAuth guidance or Desktop's local no-auth guidance. */
  edition?: McpGuideEdition;
  /** Current UI language — localizes the pasted prompt in the Agent Integration dialog. */
  lang?: string;
  /**
   * Opens the host's "New item" modal. Optional: a host without one (or an
   * embed with no create surface) simply doesn't get the secondary action —
   * the template and agent paths still stand on their own.
   */
  onCreateNode?: () => void;
}

/**
 * The first screen of an empty workspace, ordered by "how soon does this user
 * see something happen".
 *
 * It used to offer exactly one action — connect an agent over MCP — which asks
 * a brand-new user to LEAVE Busabase (paste a prompt into Claude Code/Cursor,
 * walk an OAuth flow) before anything at all exists here, and to come back to
 * the same empty screen. That filtered the whole funnel down to people who had
 * already installed an agent, and the fallback ("or use the UI buttons") named
 * a button — the sidebar's lone "+" — that a first-time visitor cannot find.
 *
 * So the primary action is now a template: it is the fastest path from empty to
 * a workspace with Bases, sample rows and — crucially — the author's agent
 * manual, which is what makes the agent's FIRST conversation succeed instead of
 * having it guess at a schema that doesn't exist yet. Connecting an agent stays
 * on this screen, demoted to the text link it should always have been: it is
 * step two, and it reads as step two.
 */
export function EmptyAgentGuide({
  edition = "desktop",
  lang,
  onCreateNode,
}: EmptyAgentGuideProps = {}) {
  const messages = useCoreI18n();
  const [open, setOpen] = useState(false);
  // What an agent fills this workspace with: the four bases the homepage hero
  // rotates through and the onboarding wizard's last step shows, with the same
  // names and icons, so the product picks up where the site left off. Review is
  // not the pitch here (see busabase-cloud content/spec/category-definition.md).
  const { emptyGuide } = messages;
  const bases = [
    { icon: Database, name: emptyGuide.baseDataName, desc: emptyGuide.baseDataDesc },
    { icon: BookOpen, name: emptyGuide.baseKnowledgeName, desc: emptyGuide.baseKnowledgeDesc },
    { icon: AppWindow, name: emptyGuide.baseAppsName, desc: emptyGuide.baseAppsDesc },
    { icon: Sparkles, name: emptyGuide.baseSkillsName, desc: emptyGuide.baseSkillsDesc },
  ];

  return (
    <>
      <div className="mx-auto max-w-xl rounded-lg border bg-card p-4 text-left">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <Sparkles size={18} />
          </div>
          <div className="min-w-0">
            <h3 className="font-medium text-sm">{messages.emptyGuide.title}</h3>
            <p className="mt-1 text-muted-foreground text-sm leading-6">
              {messages.emptyGuide.body}
            </p>
          </div>
        </div>
        {/* Icon · base name · what it holds. Names line up in their own column so
            the four bases read at a glance. */}
        <div className="mt-3 grid grid-cols-[auto_auto_1fr] items-start gap-x-2 gap-y-2 text-sm">
          {bases.map(({ icon: Icon, name, desc }) => (
            <Fragment key={name}>
              <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="whitespace-nowrap font-medium text-foreground">{name}</span>
              <span className="text-muted-foreground">{desc}</span>
            </Fragment>
          ))}
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            {/* SPALink, not a raw href: this is inside the dashboard's wouter
                tree, and it carries the current query string (cloud's
                `?space=tnl_…`, desktop's `?demo=1`) that a bare anchor drops. */}
            <SPALink
              className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 font-medium text-primary-foreground text-sm transition hover:bg-primary/90"
              href="/templates"
            >
              <Shapes size={15} />
              {messages.emptyGuide.startFromTemplate}
            </SPALink>
            {onCreateNode ? (
              <button
                className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background px-3 font-medium text-foreground text-sm transition hover:bg-muted"
                onClick={onCreateNode}
                type="button"
              >
                <Plus size={15} />
                {messages.emptyGuide.createManually}
              </button>
            ) : null}
          </div>
          <span className="text-muted-foreground text-xs">
            {messages.emptyGuide.startFromTemplateHint}
          </span>
          <button
            className="self-start text-muted-foreground text-xs underline underline-offset-4 transition hover:text-foreground"
            onClick={() => setOpen(true)}
            type="button"
          >
            {messages.emptyGuide.connectAgent}
          </button>
        </div>
      </div>

      <AgentIntegrationDialog
        open={open}
        onOpenChange={setOpen}
        defaultOrigin="https://busabase.com"
        edition={edition}
        editionConfirmed
        lang={lang}
        // Close this dialog first: the host's New item modal is a sibling, and
        // stacking it under an open Agent Integration dialog leaves the user
        // creating a Base through a scrim they cannot dismiss.
        onCreateNode={
          onCreateNode
            ? () => {
                setOpen(false);
                onCreateNode();
              }
            : undefined
        }
      />
    </>
  );
}
