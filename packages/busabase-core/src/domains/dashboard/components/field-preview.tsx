import type { BaseFieldVO, RecordVO } from "busabase-contract/types";
import { CodeBlock } from "kui/ai-elements/code-block";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "kui/dialog";
import { FileText, Film, Maximize2, Music } from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import { type ComponentProps, type ReactNode, useState } from "react";
import { Streamdown, type Components as StreamdownComponents } from "streamdown";
import { useCoreI18n, useIString } from "../../../i18n";
import { fieldDisplayKind, fieldLinkPrefix } from "../../base/field-types";
import { getRecordTitle } from "../helpers/change-request";
import {
  getAttachmentRefs,
  getChoiceBadgeClass,
  getCodeFieldPreviewLanguage,
  getFieldChipEntries,
  getFieldPreviewText,
  getRelationRecordIds,
  getSafeAttachmentUrl,
} from "../helpers/field";
import { fieldValueToString, shortIdentifier } from "../helpers/format";
import { isSafeUrl, safeFetchableUrl, sanitizeHtml, stripHtmlTags } from "../helpers/html";
import type { FieldChip } from "../helpers/view-types";
import { CheckboxBadge } from "./primitives";

export type SkillCodeLanguage = ComponentProps<typeof CodeBlock>["language"];

export const shouldCollapsePreview = (field: BaseFieldVO | undefined, value: unknown) => {
  if (
    !field ||
    !["longtext", "markdown", "html", "code", "json", "yaml", "ai_summary"].includes(field.type)
  ) {
    return false;
  }
  const text =
    field.type === "html" ? stripHtmlTags(fieldValueToString(value)) : fieldValueToString(value);
  return text.length > 180 || text.split(/\r?\n/).length > 4;
};

export function FieldBadge({ chip }: { chip: FieldChip }) {
  return (
    <span
      className={`inline-flex max-w-full items-center truncate rounded-full border px-2 py-0.5 font-medium text-xs ${getChoiceBadgeClass(chip.color)}`}
      title={chip.label}
    >
      {chip.label}
    </span>
  );
}

export function FieldBadgeList({
  chips,
  className = "",
}: {
  chips: FieldChip[];
  className?: string;
}) {
  return (
    <div className={`flex min-w-0 flex-wrap items-center gap-1.5 ${className}`}>
      {chips.map((chip, index) => (
        <FieldBadge chip={chip} key={`${chip.label}:${chip.color ?? ""}:${index}`} />
      ))}
    </div>
  );
}

export const mdComponents: StreamdownComponents = {
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-7">{children as ReactNode}</p>,
  ul: ({ children }) => (
    <ul className="mb-2 ml-5 list-disc space-y-0.5 [&>li]:pl-1">{children as ReactNode}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 ml-5 list-decimal space-y-0.5 [&>li]:pl-1">{children as ReactNode}</ol>
  ),
  li: ({ children }) => <li className="leading-6">{children as ReactNode}</li>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-4 border-primary/30 bg-primary/5 py-2 pl-3 pr-3 italic text-foreground/80">
      {children as ReactNode}
    </blockquote>
  ),
  h1: ({ children }) => (
    <h1 className="mb-1.5 mt-4 text-xl font-semibold first:mt-0">{children as ReactNode}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-1.5 mt-3 text-lg font-semibold first:mt-0">{children as ReactNode}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1 mt-3 text-base font-semibold first:mt-0">{children as ReactNode}</h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-1 mt-2 font-semibold first:mt-0">{children as ReactNode}</h4>
  ),
  h5: ({ children }) => (
    <h5 className="mb-1 mt-2 text-sm font-semibold first:mt-0">{children as ReactNode}</h5>
  ),
  h6: ({ children }) => (
    <h6 className="mb-1 mt-2 text-xs font-semibold uppercase text-muted-foreground first:mt-0">
      {children as ReactNode}
    </h6>
  ),
  strong: ({ children }) => <strong className="font-semibold">{children as ReactNode}</strong>,
  em: ({ children }) => <em className="italic text-foreground/90">{children as ReactNode}</em>,
  hr: () => <hr className="my-3 border-border" />,
  a: ({ href, children }) =>
    typeof href === "string" && isSafeUrl(href) ? (
      <a
        className="text-primary underline-offset-2 hover:underline"
        href={href}
        rel="noreferrer"
        target="_blank"
      >
        {children as ReactNode}
      </a>
    ) : (
      <span>{children as ReactNode}</span>
    ),
  img: ({ alt, src, title }) => {
    const safeSrc = safeFetchableUrl(src);
    if (!safeSrc) {
      return alt ? <span className="text-muted-foreground text-xs">{alt}</span> : null;
    }
    return (
      <img
        alt={typeof alt === "string" ? alt : ""}
        className="my-2 max-h-72 max-w-full rounded-md border object-contain"
        loading="lazy"
        src={safeSrc}
        title={typeof title === "string" ? title : undefined}
      />
    );
  },
  code: ({ className: cls, children }) => (
    <code className={cls || "rounded bg-muted px-1.5 py-0.5 font-mono text-[0.875em]"}>
      {children as ReactNode}
    </code>
  ),
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-lg border bg-muted/50 p-3 font-mono text-sm [&>code]:bg-transparent [&>code]:p-0">
      {children as ReactNode}
    </pre>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto rounded-lg border">
      <table className="min-w-full text-sm">{children as ReactNode}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-muted/50">{children as ReactNode}</thead>,
  th: ({ children }) => (
    <th className="border-b px-3 py-1.5 text-left font-semibold">{children as ReactNode}</th>
  ),
  td: ({ children }) => <td className="border-b px-3 py-1.5">{children as ReactNode}</td>,
};

/**
 * Shared Preview/Source toggle for rich-text field values (markdown, html).
 * Both modes render the same raw `source` string; only the preview node differs.
 */
function SourceTogglePreview({
  className = "",
  preview,
  source,
}: {
  className?: string;
  preview: ReactNode;
  source: string;
}) {
  const messages = useCoreI18n();
  const [mode, setMode] = useState<"preview" | "source">("preview");
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="mb-2 flex">
        <div className="flex rounded-md border bg-muted/40 p-0.5 text-xs">
          {(["preview", "source"] as const).map((m) => (
            <button
              className={`rounded px-2 py-0.5 transition-colors ${
                mode === m
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              key={m}
              onClick={() => setMode(m)}
              type="button"
            >
              {m === "preview" ? messages.recordView.preview : messages.recordView.sourceTab}
            </button>
          ))}
        </div>
      </div>
      {mode === "preview" ? (
        preview
      ) : (
        <div className="min-w-0 whitespace-pre-wrap break-words font-mono text-sm leading-6 text-muted-foreground">
          {source}
        </div>
      )}
    </div>
  );
}

export function MarkdownFieldPreview({
  className = "",
  value,
}: {
  className?: string;
  value: string;
}) {
  return (
    <SourceTogglePreview
      className={className}
      preview={
        <div className="min-w-0 break-words text-sm leading-7 [word-break:break-word] [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
          <Streamdown components={mdComponents}>{value}</Streamdown>
        </div>
      }
      source={value}
    />
  );
}

export function HtmlFieldPreview({ className = "", value }: { className?: string; value: string }) {
  return (
    <SourceTogglePreview
      className={className}
      preview={
        <div
          className="busabase-html-field min-w-0 break-words leading-6"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: HTML fields are sanitized through a tag and href allowlist before rendering.
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(value) }}
        />
      }
      source={value}
    />
  );
}

export function CodeLikeFieldPreview({
  className = "",
  field,
  showLineNumbers,
  value,
  variant = "detail",
}: {
  className?: string;
  field: BaseFieldVO;
  showLineNumbers?: boolean;
  value: unknown;
  variant?: "detail" | "table";
}) {
  const code = fieldValueToString(value);
  const language = getCodeFieldPreviewLanguage(field, value) as SkillCodeLanguage;
  const variantClassName =
    variant === "table"
      ? "max-h-20 min-w-0 rounded border-border/60 bg-muted/30 text-xs [&_code]:!text-xs [&_pre]:!p-2 [&_pre]:!text-xs"
      : "min-w-0";

  return (
    <CodeBlock
      className={`${variantClassName} ${className}`}
      code={code}
      language={language}
      showLineNumbers={
        showLineNumbers ?? (variant === "detail" ? code.split("\n").length > 5 : false)
      }
    />
  );
}

export function FieldValuePreview({
  className = "",
  field,
  records = [],
  value,
}: {
  className?: string;
  field?: BaseFieldVO;
  records?: RecordVO[];
  value: unknown;
}) {
  const resolveIString = useIString();
  const fieldName = field ? resolveIString(field.name) : undefined;
  const kind = field ? fieldDisplayKind(field.type) : "plain";

  if (kind === "checkbox") {
    return <CheckboxBadge checked={value === true || value === "true"} />;
  }

  const chips = field ? getFieldChipEntries(field, value) : [];
  if (chips.length > 0) {
    return <FieldBadgeList chips={chips} className={className} />;
  }

  if (kind === "attachment") {
    const attachments = getAttachmentRefs(value);
    if (attachments.length === 0) {
      return <span className="text-muted-foreground">-</span>;
    }
    const images = attachments.filter(
      (a) => a.mimeType?.startsWith("image/") && getSafeAttachmentUrl(a),
    );
    const others = attachments.filter(
      (a) => !a.mimeType?.startsWith("image/") || !getSafeAttachmentUrl(a),
    );
    const fileIcon = (mimeType?: string) => {
      if (mimeType?.startsWith("video/")) return <Film className="shrink-0" size={11} />;
      if (mimeType?.startsWith("audio/")) return <Music className="shrink-0" size={11} />;
      return <FileText className="shrink-0" size={11} />;
    };
    return (
      <div className={`flex min-w-0 flex-col gap-2 ${className}`}>
        {images.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {images.map((item) => {
              const safeUrl = getSafeAttachmentUrl(item);
              return safeUrl ? (
                <a
                  className="relative block overflow-hidden rounded border bg-muted transition-opacity hover:opacity-80"
                  href={safeUrl}
                  key={item.id}
                  rel="noreferrer"
                  target="_blank"
                  title={item.fileName}
                >
                  <img
                    alt={item.fileName}
                    className="h-12 w-auto max-w-[10rem] object-cover"
                    src={safeUrl}
                  />
                </a>
              ) : null;
            })}
          </div>
        )}
        {others.length > 0 && (
          <div className="flex min-w-0 flex-wrap gap-1.5">
            {others.map((item) => {
              const safeUrl = getSafeAttachmentUrl(item);
              const className =
                "inline-flex max-w-64 items-center gap-1.5 truncate rounded-full border bg-background px-2 py-0.5 text-xs";
              const children = (
                <>
                  {fileIcon(item.mimeType)}
                  <span className="truncate">{item.fileName}</span>
                </>
              );
              return safeUrl ? (
                <a
                  className={`${className} text-primary transition-colors hover:border-primary/40 hover:bg-primary/5 hover:underline`}
                  href={safeUrl}
                  key={item.id}
                  rel="noreferrer"
                  target="_blank"
                  title={item.fileName}
                >
                  {children}
                </a>
              ) : (
                <span
                  className={`${className} text-foreground`}
                  key={item.id}
                  title={item.fileName}
                >
                  {children}
                </span>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  if (kind === "relation") {
    const relationIds = getRelationRecordIds(value);
    if (relationIds.length === 0) {
      return <span className="text-muted-foreground">-</span>;
    }
    return (
      <div className={`flex min-w-0 flex-wrap gap-1.5 ${className}`}>
        {relationIds.map((recordId) => {
          const linkedRecord = records.find((record) => record.id === recordId);
          const label = linkedRecord ? getRecordTitle(linkedRecord) : shortIdentifier(recordId);
          const chipClassName =
            "max-w-64 truncate rounded-full border bg-background px-2 py-0.5 text-xs";
          return linkedRecord ? (
            <Link
              className={`${chipClassName} text-primary transition-colors hover:border-primary/40 hover:bg-primary/5 hover:underline`}
              href={`/base/${linkedRecord.base.slug}/${linkedRecord.id}`}
              key={recordId}
              title={label}
            >
              {label}
            </Link>
          ) : (
            <span className={chipClassName} key={recordId} title={recordId}>
              {label}
            </span>
          );
        })}
      </div>
    );
  }

  const text = getFieldPreviewText(field, value);
  if (!text) {
    return <span className="text-muted-foreground">-</span>;
  }

  const shouldCollapse = shouldCollapsePreview(field, value);

  if (kind === "markdown") {
    const md = fieldValueToString(value);
    return (
      <MultilineFieldPreview collapsible={shouldCollapse} title={fieldName}>
        <MarkdownFieldPreview className={className} value={md} />
      </MultilineFieldPreview>
    );
  }

  if (kind === "html") {
    const html = fieldValueToString(value);
    return (
      <MultilineFieldPreview collapsible={shouldCollapse} title={fieldName}>
        <HtmlFieldPreview className={className} value={html} />
      </MultilineFieldPreview>
    );
  }

  if (kind === "code" && field) {
    return (
      <MultilineFieldPreview collapsible={shouldCollapse} title={fieldName}>
        <CodeLikeFieldPreview className={className} field={field} value={value} />
      </MultilineFieldPreview>
    );
  }

  if (kind === "link" && field && typeof value === "string" && value) {
    const prefix = fieldLinkPrefix(field.type);
    // url opens in a new tab; mailto:/tel: navigate in place.
    const external = prefix === "";
    return (
      <a
        className="text-primary underline-offset-2 hover:underline"
        href={`${prefix}${value}`}
        rel={external ? "noreferrer" : undefined}
        target={external ? "_blank" : undefined}
      >
        {value}
      </a>
    );
  }

  const rendered = (
    <div className={`min-w-0 whitespace-pre-wrap break-words leading-6 ${className}`}>{text}</div>
  );
  // Multi-line text (longtext / ai_summary) gets the same collapse + fullscreen chrome.
  const isMultiline = Boolean(field && ["longtext", "ai_summary"].includes(field.type));
  return isMultiline ? (
    <MultilineFieldPreview collapsible={shouldCollapse} title={fieldName}>
      {rendered}
    </MultilineFieldPreview>
  ) : (
    rendered
  );
}

/**
 * Chrome for multi-line field values (html / markdown / code / longtext): keeps the inline
 * "Show full" collapse and adds a hover "Expand to fullscreen" button that opens the value in a
 * large modal — easier to read long HTML/Markdown content in record detail.
 */
export function MultilineFieldPreview({
  children,
  collapsible,
  title,
}: {
  children: ReactNode;
  collapsible: boolean;
  title?: string;
}) {
  const messages = useCoreI18n();
  const [expanded, setExpanded] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  return (
    <div className="group/field relative min-w-0">
      <button
        aria-label={messages.recordView.expandFullscreen}
        className="absolute right-0 top-0 z-10 inline-flex items-center justify-center rounded-md border bg-background/90 p-1 text-muted-foreground opacity-70 shadow-sm backdrop-blur transition hover:text-foreground hover:opacity-100 focus-visible:opacity-100 group-hover/field:opacity-100"
        onClick={() => setFullscreen(true)}
        title={messages.recordView.expandFullscreen}
        type="button"
      >
        <Maximize2 className="size-3.5" />
      </button>
      <div
        className={
          collapsible && !expanded
            ? "max-h-28 min-w-0 overflow-hidden [mask-image:linear-gradient(180deg,#000_72%,transparent)]"
            : "min-w-0"
        }
      >
        {children}
      </div>
      {collapsible ? (
        <button
          className="mt-2 text-primary text-xs underline-offset-2 hover:underline"
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          {expanded ? messages.recordView.showLess : messages.recordView.showFull}
        </button>
      ) : null}
      <Dialog onOpenChange={setFullscreen} open={fullscreen}>
        <DialogContent className="flex h-[90vh] max-h-[90vh] w-[95vw] max-w-[1040px] flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 border-b px-5 py-3 text-left">
            <DialogTitle className="text-sm font-medium">
              {title ?? messages.recordView.preview}
            </DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-auto px-5 py-4">{children}</div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
