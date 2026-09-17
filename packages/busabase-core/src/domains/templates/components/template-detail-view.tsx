"use client";

import type { TemplateCardVO } from "busabase-contract/domains/templates/types";
import { Button } from "kui/button";
import { ArrowLeft } from "lucide-react";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { TemplateDetailContent } from "./template-detail-content";

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
 * installed app gets used or sits there. The final summary uses Busabase's
 * Base terminology rather than generic table vocabulary.
 */
export function TemplateDetailView({
  template,
  onBack,
  onInstall,
  canInstall,
}: TemplateDetailViewProps) {
  const locale = useCoreLocale();
  const messages = useCoreI18n();
  const labels = {
    ...messages.templates,
    screenshot: (index: number) =>
      index === 0
        ? messages.templates.screenshotGallery
        : fmt(messages.templates.screenshot, { number: index }),
  };
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
            {messages.templates.title}
          </Button>

          <TemplateDetailContent
            template={template}
            descriptionLocale={locale}
            preferEnglishFallback
            labels={labels}
            actions={
              <div className="flex flex-col items-end gap-1">
                <Button onClick={onInstall} disabled={!canInstall}>
                  {messages.templates.install}
                </Button>
                {!canInstall ? (
                  <span className="max-w-56 text-right text-[11px] text-muted-foreground">
                    {messages.templates.installRestricted}
                  </span>
                ) : null}
              </div>
            }
          />
        </div>
      </div>
    </div>
  );
}
