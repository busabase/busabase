"use client";

import type { TemplateCardVO } from "busabase-contract/domains/templates/types";
import { Badge } from "kui/badge";
import { Button } from "kui/button";
import { ArrowLeft, ExternalLink, MessageSquare, Sparkles } from "lucide-react";

interface TemplateDetailViewProps {
  template: TemplateCardVO;
  onBack: () => void;
  onInstall: () => void;
  /** False for a member — the button explains rather than vanishing. */
  canInstall: boolean;
}

/**
 * One template, before you commit to installing it.
 *
 * Ordered by what a person actually decides on: what it does for them, then
 * what an agent will be able to do with it, then — last — how many tables it
 * has. The prompts are not decoration; they are the shortest honest answer to
 * "what would I even ask it", which is the question that decides whether an
 * installed app gets used or sits there.
 */
export function TemplateDetailView({
  template,
  onBack,
  onInstall,
  canInstall,
}: TemplateDetailViewProps) {
  const { stats } = template;
  return (
    // Same scroll shell as the gallery, `h-full` included — see the note there
    // for why that class is the one doing the work. This page is the taller of
    // the two — four screenshots, the prompts, the stats table — so it was the
    // one where the clipping made content unreachable rather than merely tight.
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
          <Button variant="ghost" size="sm" className="w-fit" onClick={onBack}>
            <ArrowLeft className="size-4" />
            Templates
          </Button>

          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <h1 className="font-serif text-2xl">{template.name}</h1>
                <Badge variant="secondary" className="text-[10px]">
                  {template.category}
                </Badge>
                {template.version ? (
                  <span className="text-muted-foreground text-xs">v{template.version}</span>
                ) : null}
              </div>
              <p className="max-w-2xl text-muted-foreground text-sm">{template.description}</p>
            </div>
            <div className="flex flex-col items-end gap-1">
              <Button onClick={onInstall} disabled={!canInstall}>
                Install
              </Button>
              {!canInstall ? (
                <span className="max-w-56 text-right text-[11px] text-muted-foreground">
                  Space owners and admins only — a template can carry an app and a skill, which is
                  code this space's agents will run.
                </span>
              ) : null}
            </div>
          </div>

          {template.screenshots.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {template.screenshots.map((url) => (
                <img
                  key={url}
                  src={url}
                  alt=""
                  loading="lazy"
                  className="w-full rounded-lg border border-border object-cover"
                  onError={(event) => {
                    event.currentTarget.style.display = "none";
                  }}
                />
              ))}
            </div>
          ) : null}

          {template.agentPrompts.length > 0 ? (
            <section className="flex flex-col gap-2">
              <h2 className="flex items-center gap-2 font-medium text-sm">
                <MessageSquare className="size-4" />
                What you can ask an agent, once it is installed
              </h2>
              <ul className="flex flex-col gap-2">
                {template.agentPrompts.map((prompt) => (
                  <li
                    key={prompt}
                    className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
                  >
                    “{prompt}”
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground text-xs">
                The agent can answer these because the template installs its author's manual
                alongside its tables — it does not have to guess your schema.
              </p>
            </section>
          ) : null}

          <section className="flex flex-col gap-2">
            <h2 className="flex items-center gap-2 font-medium text-sm">
              <Sparkles className="size-4" />
              What installing this creates
            </h2>
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              {[
                ["Tables", stats.bases],
                ["Apps", stats.airapps],
                ["Documents", stats.docs],
                ["Sample rows", stats.records],
                ["Files", stats.files],
              ]
                .filter(([, count]) => (count as number) > 0)
                .map(([label, count]) => (
                  <div
                    key={label as string}
                    className="flex justify-between gap-4 border-border border-b py-1"
                  >
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd>{count}</dd>
                  </div>
                ))}
              <div className="flex justify-between gap-4 border-border border-b py-1">
                <dt className="text-muted-foreground">Agent manual</dt>
                <dd>{stats.skill ? "included" : "none"}</dd>
              </div>
            </dl>
            {/* Said plainly here, because it is the part that surprises people:
            tables appear at once, everything that RUNS waits for them. The
            sample rows sit with the tables rather than with the code — install
            merges them (`installSampleRecords`, on by default) so the app is
            not empty on first open. Getting this backwards would be worse than
            saying nothing: someone would go looking in their Inbox for rows
            that are already in the table. */}
            <p className="text-muted-foreground text-xs">
              Tables, their fields and the sample rows are created straight away, so the app is not
              empty when you open it. The app's code and its manual are proposed as change requests
              for you to read first.
            </p>
          </section>

          <div className="flex items-center gap-3 text-muted-foreground text-xs">
            <a
              href={template.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 hover:text-foreground"
            >
              Read the source
              <ExternalLink className="size-3" />
            </a>
            {template.license ? <span>· {template.license}</span> : null}
            {template.author ? <span>· {template.author}</span> : null}
          </div>
        </div>
      </div>
    </div>
  );
}
