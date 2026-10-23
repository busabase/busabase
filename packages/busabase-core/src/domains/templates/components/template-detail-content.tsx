import { pickTemplateMedia } from "busabase-contract/domains/templates/media";
import { visibleTemplateTags } from "busabase-contract/domains/templates/tags";
import type { TemplateCardVO } from "busabase-contract/domains/templates/types";
import { ExternalLink, MessageSquare } from "lucide-react";
import { iStringParse, type LocaleType } from "openlib/i18n/i-string";
import type { ReactNode } from "react";
import { TemplateScreenshotShowcase } from "./template-screenshot-showcase";
import { TemplateVideoPreview } from "./template-video-preview";

export interface TemplateDetailLabels {
  promptsTitle: string;
  promptsDescription: string;
  contentsTitle: string;
  /**
   * Who may install, as small print in the side column. Deliberately short and
   * deliberately last: it is a rule worth stating, not the pitch.
   */
  permissionNote: string;
  bases: string;
  apps: string;
  documents: string;
  sampleRows: string;
  files: string;
  folders: string;
  agentManual: string;
  included: string;
  none: string;
  readSource: string;
  tags: string;
  previousScreenshot: string;
  nextScreenshot: string;
  closePreview: string;
  zoomOut: string;
  zoomIn: string;
  resetView: string;
  rotateClockwise: string;
  downloadImage: string;
  /** Accessible name of the demo clip's play button. */
  playVideo: string;
  screenshot: (index: number) => string;
}

const defaultLabels: TemplateDetailLabels = {
  promptsTitle: "What you can ask an agent, once it is installed",
  promptsDescription:
    "The agent can answer these because the template installs its author's manual alongside its Bases. It does not have to guess your schema.",
  contentsTitle: "What installing this creates",
  permissionNote:
    "Installing needs an owner or admin of the workspace. Everything is ready to use once installed; you can also choose to review the content first.",
  bases: "Bases",
  apps: "Apps",
  documents: "Documents",
  sampleRows: "Sample rows",
  files: "Files",
  folders: "Folders",
  agentManual: "Agent manual",
  included: "included",
  none: "none",
  readSource: "Read the source",
  tags: "Tags",
  previousScreenshot: "Previous screenshot",
  nextScreenshot: "Next screenshot",
  closePreview: "Close preview",
  zoomOut: "Zoom out",
  zoomIn: "Zoom in",
  resetView: "Reset view",
  rotateClockwise: "Rotate clockwise",
  downloadImage: "Download image",
  playVideo: "Play the demo",
  screenshot: (index) => (index === 0 ? "Template screenshots" : `Template screenshot ${index}`),
};

interface TemplateDetailContentProps {
  template: TemplateCardVO;
  labels?: TemplateDetailLabels;
  actions?: ReactNode;
  /** See the identical note on `TemplateCardSummaryProps` — a prop, not a
   * hook, because this renders in a Server Component tree too. Also picks the
   * gallery and clip for this locale, falling back to the English defaults. */
  descriptionLocale?: LocaleType;
}

/**
 * Server-safe template detail body shared by the public site and Dashboard.
 * Interactive install and navigation controls stay in each caller's shell.
 *
 * Read top to bottom the way a visitor decides: what it is (a large title and
 * one readable sentence), the one thing to do about it (`actions`, directly
 * under the sentence), what it looks like (the screenshot and clip shelf),
 * and only then the detail. The detail is split by who it is for — example
 * questions to an agent in the main column, and in a quiet side column
 * everything that is reference rather than pitch: what installing creates, the
 * tags, version, licence, source, and who may install. Category and version
 * used to sit beside the title and the internal `prefix:value` tags under it;
 * see `visibleTemplateTags` for why those last ones are never rendered.
 */
export function TemplateDetailContent({
  template,
  labels = defaultLabels,
  actions,
  descriptionLocale = "en",
}: TemplateDetailContentProps) {
  const { stats } = template;
  const title = template.displayName
    ? iStringParse(template.displayName, descriptionLocale)
    : template.name;
  const contents = [
    [labels.bases, stats.bases],
    [labels.apps, stats.airapps],
    [labels.documents, stats.docs],
    [labels.sampleRows, stats.records],
    [labels.files, stats.files],
    [labels.folders, stats.folders],
  ] as const;
  const tags = visibleTemplateTags(template);
  const facts = [
    template.version ? `v${template.version}` : null,
    template.license ?? null,
    template.author ?? null,
  ].filter((fact): fact is string => Boolean(fact));
  const hasPrompts = template.agentPrompts.length > 0;
  const media = pickTemplateMedia(template, descriptionLocale);
  const screenshots = media.screenshots.map((src, index) => ({
    src,
    alt: `${title} ${labels.screenshot(index + 1)}`,
  }));

  return (
    <div className="flex flex-col gap-12">
      {/* A size container, so the title scales with the column it is given —
          the public page and the Dashboard pane are different widths at the
          same viewport, and a viewport breakpoint would size them alike. */}
      <header className="@container">
        <div className="flex max-w-3xl flex-col gap-4 @2xl:gap-5">
          <h1 className="font-serif text-4xl font-semibold leading-tight tracking-tight @2xl:text-5xl @4xl:text-6xl">
            {title}
          </h1>
          <p className="text-base leading-7 text-muted-foreground @2xl:text-lg @2xl:leading-8">
            {iStringParse(template.description, descriptionLocale)}
          </p>
          {actions ? <div className="pt-1">{actions}</div> : null}
        </div>
      </header>

      {/* The clips live in the shelf, so the shelf has to render for a template
          that has any even with no screenshots — otherwise a declared clip
          silently disappears. */}
      {screenshots.length > 0 || media.videos.length > 0 ? (
        <TemplateScreenshotShowcase
          // Keyed by locale too: switching language can swap in a gallery of a
          // different length, and the shelf's current/preview index must not
          // outlive the list it indexed.
          key={`${template.id}:${descriptionLocale}`}
          screenshots={screenshots}
          videoTiles={media.videos.map((clip) => (
            <TemplateVideoPreview
              key={clip.src}
              src={clip.src}
              // The first NON-cover shot, not the cover. The clip tile sits
              // directly beside the cover tile, and postering it with the
              // same image makes the shelf look like it is showing one
              // picture twice. An app screen also represents what the clip
              // actually contains better than the branded cover does.
              poster={(screenshots[1] ?? screenshots[0])?.src}
              title={title}
              playLabel={clip.title ? `${labels.playVideo}: ${clip.title}` : labels.playVideo}
              // Titles tell clips apart, so they show only when there is more
              // than one to tell apart; a lone clip's tile stays as it was.
              caption={media.videos.length > 1 ? clip.title : undefined}
            />
          ))}
          label={labels.screenshot(0)}
          previousLabel={labels.previousScreenshot}
          nextLabel={labels.nextScreenshot}
          closeLabel={labels.closePreview}
          zoomOutLabel={labels.zoomOut}
          zoomInLabel={labels.zoomIn}
          resetLabel={labels.resetView}
          rotateLabel={labels.rotateClockwise}
          downloadLabel={labels.downloadImage}
        />
      ) : null}

      <div className="@container">
        <div
          className={
            hasPrompts ? "grid gap-10 @3xl:grid-cols-3 @3xl:gap-12" : "flex flex-col gap-10"
          }
        >
          {hasPrompts ? (
            <section className="flex flex-col gap-3 @3xl:col-span-2">
              <h2 className="flex items-center gap-2 text-base font-medium">
                <MessageSquare
                  className="size-[1em] shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
                {labels.promptsTitle}
              </h2>
              <ul className="flex flex-col gap-2">
                {template.agentPrompts.map((prompt) => (
                  <li
                    key={prompt}
                    className="rounded-md bg-muted/40 px-3 py-2 text-sm leading-6 text-foreground/80"
                  >
                    &ldquo;{prompt}&rdquo;
                  </li>
                ))}
              </ul>
              <p className="text-xs leading-5 text-muted-foreground">{labels.promptsDescription}</p>
            </section>
          ) : null}

          <aside
            className={
              hasPrompts
                ? "flex flex-col gap-6 border-t border-border pt-8 text-sm @3xl:border-t-0 @3xl:pt-0"
                : "flex max-w-xs flex-col gap-6 text-sm"
            }
          >
            <section className="flex flex-col gap-2">
              <h2 className="font-sans text-sm font-medium">{labels.contentsTitle}</h2>
              <dl className="flex flex-col gap-1.5">
                {contents
                  .filter(([, count]) => count > 0)
                  .map(([label, count]) => (
                    <div key={label} className="flex items-baseline justify-between gap-4">
                      <dt className="text-muted-foreground">{label}</dt>
                      <dd>{count}</dd>
                    </div>
                  ))}
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="text-muted-foreground">{labels.agentManual}</dt>
                  <dd>{stats.skill ? labels.included : labels.none}</dd>
                </div>
              </dl>
            </section>

            {tags.length > 0 ? (
              <section className="flex flex-col gap-2">
                <h2 className="font-sans text-sm font-medium">{labels.tags}</h2>
                <ul className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
                  {tags.map((tag) => (
                    <li key={tag}>{tag}</li>
                  ))}
                </ul>
              </section>
            ) : null}

            <div className="flex flex-col gap-1.5 text-muted-foreground">
              <a
                href={template.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex w-fit items-center gap-1 hover:text-foreground"
              >
                {labels.readSource}
                <ExternalLink className="size-3" aria-hidden="true" />
              </a>
              {facts.length > 0 ? <p>{facts.join(" · ")}</p> : null}
            </div>

            <p className="text-xs leading-5 text-muted-foreground">{labels.permissionNote}</p>
          </aside>
        </div>
      </div>
    </div>
  );
}
