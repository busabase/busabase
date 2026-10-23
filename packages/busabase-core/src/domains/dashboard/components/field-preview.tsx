import type { BaseFieldVO, LookupComputedVO, RecordVO, UserRefVO } from "busabase-contract/types";
import { CodeBlock } from "kui/ai-elements/code-block";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "kui/dialog";
import { ExternalLink, FileText, Film, List, Maximize2, Music, PlaySquare } from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import { type ComponentProps, type ReactNode, useState } from "react";
import { Streamdown, type Components as StreamdownComponents } from "streamdown";
import { useSearch } from "wouter";
import { fmt, useCoreI18n, useCoreLocale, useIString } from "../../../i18n";
import { fieldDisplayKind, fieldLinkPrefix } from "../../base/field-types";
import { getDateFieldOptions, parseDateFieldValue } from "../../base/utils/date-value";
import { embedAspectRatio, embedHeight, resolveEmbedPreview } from "../../base/utils/embed";
import { parseWhiteboardFieldValue } from "../../base/utils/whiteboard-value";
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
import {
  HTML_DOCUMENT_SANDBOX,
  isFullHtmlDocument,
  isSafeUrl,
  safeFetchableUrl,
  sanitizeHtml,
  sanitizeSvg,
  stripHtmlTags,
} from "../helpers/html";
import { mergeSearchIntoHref } from "../helpers/link-search";
import { lookupDisplayField, lookupItemValue } from "../helpers/lookup";
import { markdownPreviewSource } from "../helpers/markdown-preview";
import type { FieldChip } from "../helpers/view-types";
import { DateFieldValue } from "./date-field";
import { FormulaValue } from "./formula-value";
import { DialogContent } from "./localized-dialog-content";
import { MemberChips } from "./member-field";
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
  // Rich preview types (rendered HTML/Markdown/code) get a taller collapse threshold than plain
  // longtext — a short truncation reads as broken content for a rendered preview.
  const isRichContent = ["markdown", "html", "code", "json", "yaml"].includes(field.type);
  const lengthThreshold = isRichContent ? 600 : 180;
  const lineThreshold = isRichContent ? 12 : 4;
  return text.length > lengthThreshold || text.split(/\r?\n/).length > lineThreshold;
};

export function FieldBadge({ chip }: { chip: FieldChip }) {
  return (
    <span
      className={`inline-flex max-w-full items-center truncate rounded-md border px-2 py-0.5 font-medium text-xs ${getChoiceBadgeClass(chip.color)}`}
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
  fill = false,
  preview,
  source,
}: {
  className?: string;
  /** Stretch to the parent's height (fullscreen dialog) instead of sizing to content. */
  fill?: boolean;
  preview: ReactNode;
  source: string;
}) {
  const messages = useCoreI18n();
  const [mode, setMode] = useState<"preview" | "source">("preview");
  return (
    <div className={`min-w-0 ${fill ? "flex h-full flex-col" : ""} ${className}`}>
      <div className="mb-2 flex shrink-0">
        <div className="flex rounded-md border bg-muted/40 p-0.5 text-xs">
          {(["preview", "source"] as const).map((m) => (
            <button
              className={`rounded px-2 py-0.5 transition-colors ${
                mode === m
                  ? "bg-card text-foreground"
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
        <div
          className={`min-w-0 whitespace-pre-wrap break-words font-mono text-sm leading-6 text-muted-foreground ${
            fill ? "min-h-0 flex-1 overflow-auto" : ""
          }`}
        >
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
          <Streamdown components={mdComponents}>{markdownPreviewSource(value)}</Streamdown>
        </div>
      }
      source={value}
    />
  );
}

/**
 * A whole HTML page stored in an HTML field, rendered as the page it is: its own
 * stylesheet and CSS-only interactions (tabs built from radio inputs) intact.
 * The frame is sandboxed without scripts or same-origin access — see
 * `HTML_DOCUMENT_SANDBOX`.
 */
export function HtmlDocumentFrame({ className = "", html }: { className?: string; html: string }) {
  const messages = useCoreI18n();
  return (
    <iframe
      className={`block w-full min-w-0 rounded-md border ${className}`}
      data-testid="html-document-frame"
      referrerPolicy="no-referrer"
      sandbox={HTML_DOCUMENT_SANDBOX}
      srcDoc={html}
      title={messages.recordView.preview}
    />
  );
}

export function HtmlFieldPreview({
  className = "",
  fill = false,
  value,
}: {
  className?: string;
  /** Fill the parent's height — used by the fullscreen dialog. */
  fill?: boolean;
  value: string;
}) {
  if (isFullHtmlDocument(value)) {
    return (
      <SourceTogglePreview
        className={className}
        fill={fill}
        preview={
          <HtmlDocumentFrame
            className={fill ? "min-h-0 flex-1" : "h-[min(70vh,640px)]"}
            html={value}
          />
        }
        source={value}
      />
    );
  }
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

const EMBED_RATIO_CLASS: Record<string, string> = {
  "16:9": "aspect-video",
  "4:3": "aspect-[4/3]",
  "1:1": "aspect-square",
};

export function EmbedFieldPreview({
  className = "",
  field,
  value,
}: {
  className?: string;
  field: BaseFieldVO;
  value: unknown;
}) {
  const messages = useCoreI18n();
  const preview = resolveEmbedPreview(value, field);
  if (!preview) {
    return <span className="text-muted-foreground">-</span>;
  }

  const ratioClass = EMBED_RATIO_CLASS[embedAspectRatio(field)] ?? EMBED_RATIO_CLASS["16:9"];
  const height = embedHeight(field);
  const heightStyle = height ? { height } : undefined;
  return (
    <div className={`min-w-0 ${className}`}>
      <div
        className={`overflow-hidden rounded-md border bg-muted/30 ${height ? "" : ratioClass}`}
        style={heightStyle}
      >
        <iframe
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          allowFullScreen
          className="h-full w-full border-0"
          loading="lazy"
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox="allow-forms allow-presentation allow-same-origin allow-scripts"
          src={preview.embedUrl}
          title={fmt(messages.recordView.embedTitle, { label: preview.label })}
        />
      </div>
      <div className="mt-2 flex min-w-0 items-center justify-between gap-2 text-xs">
        <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground">
          <PlaySquare className="shrink-0" size={13} />
          <span className="truncate">{preview.label}</span>
        </span>
        <a
          className="inline-flex shrink-0 items-center gap-1 text-primary underline-offset-2 hover:underline"
          href={preview.sourceUrl}
          rel="noreferrer"
          target="_blank"
        >
          {messages.common.open}
          <ExternalLink size={12} />
        </a>
      </div>
    </div>
  );
}

/**
 * Static SVG rendering of a whiteboard field's last-exported scene snapshot —
 * used everywhere a whiteboard value is shown read-only (table grid cell,
 * Record Detail view mode, the operation diff). Deliberately NOT a live
 * Excalidraw canvas: mounting a full interactive canvas per visible row would
 * be far too expensive, so read-only surfaces only ever show this pre-exported
 * SVG (see `WhiteboardFieldEditor` in record-views.tsx for where it's produced).
 *
 * `previewSvg` is untrusted at this point even though the in-app editor only
 * ever writes Excalidraw's own export output: the value round-trips through
 * the same field-value API surface as any other field (busabase-cli / REST /
 * MCP), so a non-UI client can submit any string here. Sanitize the same way
 * `HtmlFieldPreview` sanitizes `value` below, just with an SVG-aware allowlist.
 */
export function WhiteboardThumbnail({
  className = "",
  previewSvg,
}: {
  className?: string;
  previewSvg: string;
}) {
  if (!previewSvg) {
    return <span className="text-muted-foreground">-</span>;
  }
  return (
    <div
      className={`overflow-hidden rounded-md border bg-card ${className}`}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: sanitizeSvg strips script/foreignObject/event-handler/href vectors via an explicit tag+attribute allowlist before this renders.
      dangerouslySetInnerHTML={{ __html: sanitizeSvg(previewSvg) }}
    />
  );
}

export function WhiteboardFieldPreview({
  className = "",
  value,
}: {
  className?: string;
  value: unknown;
}) {
  const { previewSvg } = parseWhiteboardFieldValue(value);
  return (
    <WhiteboardThumbnail
      className={`h-72 w-full [&_svg]:h-full [&_svg]:w-full [&_svg]:object-contain ${className}`}
      previewSvg={previewSvg}
    />
  );
}

export function FieldValuePreview({
  className = "",
  field,
  fieldUsers,
  computed,
  records = [],
  record,
  value,
}: {
  className?: string;
  field?: BaseFieldVO;
  /**
   * People named by this record's people-typed cells (`RecordVO.fieldUsers`),
   * for `member` / `created_by` / `updated_by`. Absent → those cells fall back
   * to an id-based label, which is what a public surface shows by design.
   */
  fieldUsers?: Record<string, UserRefVO>;
  computed?: LookupComputedVO;
  records?: RecordVO[];
  record?: RecordVO;
  value: unknown;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const resolveIString = useIString();
  const currentSearch = useSearch();
  const fieldName = field ? resolveIString(field.name) : undefined;
  const kind = field ? fieldDisplayKind(field.type) : "plain";

  if (field?.type === "lookup") {
    return (
      <LookupFieldValue
        computed={computed}
        field={field}
        fieldUsers={fieldUsers}
        records={records}
        value={value}
      />
    );
  }
  if (field?.type === "formula")
    return <FormulaValue field={field} value={value} record={record} />;

  if (field?.type === "date" && parseDateFieldValue(value)) {
    return (
      <div className={`min-w-0 leading-6 ${className}`}>
        <DateFieldValue options={getDateFieldOptions(field.options)} value={value} />
      </div>
    );
  }

  if (kind === "checkbox") {
    return <CheckboxBadge checked={value === true || value === "true"} />;
  }

  if (kind === "member") {
    return <MemberChips className={className} users={fieldUsers} value={value} />;
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
                "inline-flex max-w-64 items-center gap-1.5 truncate rounded-md border bg-card px-2 py-0.5 text-xs";
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
          const label = linkedRecord
            ? getRecordTitle(linkedRecord, messages)
            : shortIdentifier(recordId);
          const chipClassName = "max-w-64 truncate rounded-md border bg-card px-2 py-0.5 text-xs";
          // A relation whose target has been archived used to render exactly
          // like a live one — same border, same colour, same link — so a row
          // could point at something sitting in the trash with nothing on
          // screen saying so. The record is still reachable (`records.get`
          // returns archived rows), so keep the link and mark it instead:
          // struck through, dimmed, and named as archived on hover.
          const isArchived = linkedRecord?.status === "archived";
          return linkedRecord ? (
            <Link
              className={`${chipClassName} transition-colors ${
                isArchived
                  ? "text-muted-foreground line-through decoration-muted-foreground/60 hover:border-muted-foreground/40 hover:bg-muted/40"
                  : "text-primary hover:border-primary/40 hover:bg-primary/5 hover:underline"
              }`}
              href={mergeSearchIntoHref(
                `/base/${linkedRecord.base.slug}/${linkedRecord.id}`,
                currentSearch,
              )}
              key={recordId}
              title={isArchived ? `${label} (${messages.common.archived})` : label}
            >
              {label}
            </Link>
          ) : (
            // Not archived — genuinely unreachable: hard-deleted, or in a Base
            // this viewer cannot see. Distinct from the archived case above,
            // and previously indistinguishable from it.
            <span
              className={`${chipClassName} border-dashed text-muted-foreground`}
              key={recordId}
              title={`${recordId} — ${messages.recordView.relationUnavailable}`}
            >
              {label}
            </span>
          );
        })}
      </div>
    );
  }

  if (kind === "whiteboard") {
    return (
      <MultilineFieldPreview collapsible={false} title={fieldName}>
        <WhiteboardFieldPreview className={className} value={value} />
      </MultilineFieldPreview>
    );
  }

  const text = getFieldPreviewText(field, value, messages, locale);
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
    // A whole page scrolls inside its own frame, so it never collapses; in the
    // fullscreen dialog the frame stretches to the dialog's height.
    const isDocument = isFullHtmlDocument(html);
    return (
      <MultilineFieldPreview
        collapsible={shouldCollapse && !isDocument}
        fullscreenChildren={isDocument ? <HtmlFieldPreview fill value={html} /> : undefined}
        title={fieldName}
      >
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

  if (kind === "embed" && field) {
    return (
      <MultilineFieldPreview collapsible={false} title={fieldName}>
        <EmbedFieldPreview className={className} field={field} value={value} />
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

export function LookupFieldValue({
  field,
  computed,
  value,
  fieldUsers,
  records = [],
  draft = false,
}: {
  field: BaseFieldVO;
  computed?: LookupComputedVO;
  value: unknown;
  fieldUsers?: Record<string, UserRefVO>;
  records?: RecordVO[];
  draft?: boolean;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const resolveIString = useIString();
  const search = useSearch();
  const [open, setOpen] = useState(false);
  const result = computed ? computed.value : value;
  const status = computed?.status;
  const unavailable = status === "invalid" || status === "inaccessible";
  const empty = status === "empty" || status === "unlinked";
  const target = computed?.targetField;
  const rollup = field.options.lookup?.rollup ?? "values";
  const displayField = target ? lookupDisplayField(target, rollup) : undefined;
  const values = Array.isArray(result) ? result : [result];
  const renderValue = (item: unknown, index: number) =>
    displayField ? (
      <FieldValuePreview
        field={displayField}
        fieldUsers={fieldUsers}
        key={index}
        records={records}
        value={rollup === "values" ? lookupItemValue(displayField, item) : item}
      />
    ) : (
      <span className="max-w-full truncate" key={index}>
        {getFieldPreviewText(field, item, messages, locale) || "-"}
      </span>
    );
  const canExpand = !unavailable && (Boolean(computed?.sources.length) || values.length > 3);
  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-1.5"
      data-testid={`lookup-field-${field.slug}`}
    >
      {draft ? (
        <span className="w-full text-muted-foreground text-[11px]">{messages.lookup.draft}</span>
      ) : null}
      {unavailable || empty ? (
        <>
          <span className="text-sm">
            {!unavailable && typeof result === "number" ? renderValue(result, 0) : null}
          </span>
          <span
            className={
              unavailable ? "text-muted-foreground text-xs" : "text-muted-foreground text-xs"
            }
            role="status"
          >
            {status === "invalid" && computed?.reason
              ? messages.lookup.reasons[computed.reason]
              : messages.lookup[status as "invalid" | "inaccessible" | "empty" | "unlinked"]}
          </span>
        </>
      ) : values.length === 0 || result === null || result === undefined || result === "" ? (
        <span className="text-muted-foreground">-</span>
      ) : (
        values.slice(0, 3).map(renderValue)
      )}
      {canExpand ? (
        <button
          aria-label={messages.lookup.details}
          className="inline-flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-muted-foreground text-xs transition-colors hover:bg-accent hover:text-foreground"
          data-testid={`lookup-sources-${field.slug}`}
          onClick={() => setOpen(true)}
          title={messages.lookup.details}
          type="button"
        >
          {values.length > 3 ? `+${values.length - 3}` : <List size={13} />}
        </button>
      ) : null}
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto"
          data-testid="lookup-source-dialog"
        >
          <DialogHeader>
            <DialogTitle>
              {resolveIString(field.name)} · {messages.lookup.source}
            </DialogTitle>
            <DialogDescription>{messages.lookup.readOnly}</DialogDescription>
          </DialogHeader>
          {computed?.sources.length ? (
            <div className="divide-y divide-border/50">
              {computed.sources.map((source) => (
                <div
                  className="grid min-w-0 grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-start gap-3 py-3"
                  key={source.recordId}
                >
                  {computed.sourceBaseSlug ? (
                    <Link
                      className="flex min-w-0 items-start gap-1 text-primary text-sm hover:underline"
                      href={mergeSearchIntoHref(
                        `/base/${computed.sourceBaseSlug}/${source.recordId}`,
                        search,
                      )}
                      onClick={() => setOpen(false)}
                    >
                      <span className="break-words">{source.title}</span>
                      <ExternalLink className="mt-1 shrink-0" size={12} />
                    </Link>
                  ) : (
                    <span className="break-words text-sm">{source.title}</span>
                  )}
                  <div className="min-w-0 break-words">
                    {target ? (
                      <FieldValuePreview
                        field={target}
                        fieldUsers={fieldUsers}
                        records={records}
                        value={source.value}
                      />
                    ) : (
                      <span>{getFieldPreviewText(undefined, source.value, messages, locale)}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex min-w-0 flex-wrap gap-2">{values.map(renderValue)}</div>
          )}
        </DialogContent>
      </Dialog>
    </div>
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
  fullscreenChildren,
  title,
}: {
  children: ReactNode;
  collapsible: boolean;
  /** What the fullscreen dialog shows, when it differs from the inline preview. */
  fullscreenChildren?: ReactNode;
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
            ? "max-h-72 min-w-0 overflow-hidden [mask-image:linear-gradient(180deg,#000_72%,transparent)]"
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
          <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
            {fullscreenChildren ?? children}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
