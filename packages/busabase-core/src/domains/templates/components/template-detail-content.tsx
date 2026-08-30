import type { TemplateCardVO } from "busabase-contract/domains/templates/types";
import { Badge } from "kui/badge";
import { ExternalLink, MessageSquare, PackageOpen } from "lucide-react";
import type { ReactNode } from "react";
import { TemplateScreenshotShowcase } from "./template-screenshot-showcase";

export interface TemplateDetailLabels {
  promptsTitle: string;
  promptsDescription: string;
  contentsTitle: string;
  contentsDescription: string;
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
  screenshot: (index: number) => string;
}

const defaultLabels: TemplateDetailLabels = {
  promptsTitle: "What you can ask an agent, once it is installed",
  promptsDescription:
    "The agent can answer these because the template installs its author's manual alongside its Bases. It does not have to guess your schema.",
  contentsTitle: "What installing this creates",
  contentsDescription:
    "Bases, fields, and sample rows are created straight away. App code and the agent manual are proposed as change requests for you to review first.",
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
  screenshot: (index) => (index === 0 ? "Template screenshots" : `Template screenshot ${index}`),
};

interface TemplateDetailContentProps {
  template: TemplateCardVO;
  labels?: TemplateDetailLabels;
  actions?: ReactNode;
}

/**
 * Server-safe template detail body shared by the public site and Dashboard.
 * Interactive install and navigation controls stay in each caller's shell.
 */
export function TemplateDetailContent({
  template,
  labels = defaultLabels,
  actions,
}: TemplateDetailContentProps) {
  const { stats } = template;
  const contents = [
    [labels.bases, stats.bases],
    [labels.apps, stats.airapps],
    [labels.documents, stats.docs],
    [labels.sampleRows, stats.records],
    [labels.files, stats.files],
    [labels.folders, stats.folders],
  ] as const;
  const screenshots = template.screenshots.map((src, index) => ({
    src,
    alt: `${template.name} ${labels.screenshot(index + 1)}`,
  }));

  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex max-w-2xl flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-serif text-2xl font-semibold">{template.name}</h1>
            <Badge variant="secondary" className="text-[10px]">
              {template.category}
            </Badge>
            {template.version ? (
              <span className="text-xs text-muted-foreground">v{template.version}</span>
            ) : null}
          </div>
          <p className="text-sm leading-6 text-muted-foreground">{template.description}</p>
          {template.tags.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5" aria-label={labels.tags}>
              {template.tags.map((tag) => (
                <li
                  key={tag}
                  className="rounded-sm bg-muted px-2 py-1 text-xs text-muted-foreground"
                >
                  {tag}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {actions}
      </header>

      {screenshots.length > 0 ? (
        <TemplateScreenshotShowcase
          key={template.id}
          screenshots={screenshots}
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

      {template.agentPrompts.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="flex items-center gap-2 text-lg font-medium">
            <MessageSquare className="size-[1em]" aria-hidden="true" />
            {labels.promptsTitle}
          </h2>
          <ul className="flex flex-col gap-2">
            {template.agentPrompts.map((prompt) => (
              <li
                key={prompt}
                className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm"
              >
                &ldquo;{prompt}&rdquo;
              </li>
            ))}
          </ul>
          <p className="text-xs leading-5 text-muted-foreground">{labels.promptsDescription}</p>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="flex items-center gap-2 text-lg font-medium">
          <PackageOpen className="size-[1em]" aria-hidden="true" />
          {labels.contentsTitle}
        </h2>
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
          {contents
            .filter(([, count]) => count > 0)
            .map(([label, count]) => (
              <div key={label} className="flex justify-between gap-4 border-b border-border py-1">
                <dt className="text-muted-foreground">{label}</dt>
                <dd>{count}</dd>
              </div>
            ))}
          <div className="flex justify-between gap-4 border-b border-border py-1">
            <dt className="text-muted-foreground">{labels.agentManual}</dt>
            <dd>{stats.skill ? labels.included : labels.none}</dd>
          </div>
        </dl>
        <p className="text-xs leading-5 text-muted-foreground">{labels.contentsDescription}</p>
      </section>

      <footer className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <a
          href={template.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          {labels.readSource}
          <ExternalLink className="size-3" aria-hidden="true" />
        </a>
        {template.license ? <span>{template.license}</span> : null}
        {template.author ? <span>{template.author}</span> : null}
      </footer>
    </div>
  );
}
