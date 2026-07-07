"use client";

import { Bot, Database, GitPullRequest, Sparkles } from "lucide-react";
import { useState } from "react";
import { AgentIntegrationDialog } from "./agent-skill-button";

const guideItems = [
  {
    icon: Database,
    text: "Create structured data and seed useful examples",
  },
  {
    icon: GitPullRequest,
    text: "Open Change Requests for review instead of writing directly",
  },
  {
    icon: Bot,
    text: "Add records, update fields, and evolve a Database with an AI agent",
  },
];

interface EmptyAgentGuideProps {
  /** Current UI language — localizes the pasted prompt in the Agent Integration dialog. */
  lang?: string;
}

export function EmptyAgentGuide({ lang }: EmptyAgentGuideProps = {}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="mx-auto max-w-xl rounded-lg border bg-background p-4 text-left shadow-sm">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
            <Sparkles size={18} />
          </div>
          <div className="min-w-0">
            <h3 className="font-medium text-sm">Let an agent help fill this workspace</h3>
            <p className="mt-1 text-muted-foreground text-sm leading-6">
              Busabase can stay manual, but it is designed so agents create drafts and humans
              approve what becomes canonical.
            </p>
          </div>
        </div>
        <div className="mt-3 grid gap-2">
          {guideItems.map((item) => {
            const Icon = item.icon;
            return (
              <div
                className="flex items-center gap-2 text-muted-foreground text-sm"
                key={item.text}
              >
                <Icon className="size-4 shrink-0" aria-hidden="true" />
                <span>{item.text}</span>
              </div>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-primary-foreground text-sm font-medium transition hover:bg-primary/90"
            onClick={() => setOpen(true)}
            type="button"
          >
            <Sparkles size={15} />
            Open Agent Skills
          </button>
          <span className="text-muted-foreground text-xs">
            Or use the UI buttons to create manually.
          </span>
        </div>
      </div>

      <AgentIntegrationDialog
        open={open}
        onOpenChange={setOpen}
        defaultOrigin="https://busabase.com"
        lang={lang}
      />
    </>
  );
}
