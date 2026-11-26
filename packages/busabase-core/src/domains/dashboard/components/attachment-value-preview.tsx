"use client";

import { Popover, PopoverContent, PopoverTrigger } from "kui/popover";
import { Expand, RotateCcw } from "lucide-react";
import { Fragment, type MouseEvent, type ReactNode, useEffect, useRef, useState } from "react";
import { useCoreI18n } from "../../../i18n";
import { useAssetContentUrlResolver } from "../../assets/hooks/asset-content-url-context";
import {
  attachmentGridLayout,
  attachmentGridThumbnailSize,
} from "../helpers/attachment-grid-layout";
import { getAttachmentRefs, getSafeAttachmentUrl } from "../helpers/field";
import { attachmentFileType } from "../utils/attachment-file-type";
import { attachmentTextKind } from "../utils/text-attachment";
import { AttachmentFileIcon } from "./attachment-file-icon";
import { AttachmentFileList } from "./attachment-file-list";
import { AttachmentPreviewDialog } from "./attachment-preview-dialog";

type Attachment = ReturnType<typeof getAttachmentRefs>[number];

/** Keep a failed image identifiable and recoverable, without changing a signed URL. */
function AttachmentImage({
  item,
  url,
  grid = false,
  thumbnailSize = 32,
  onOpen,
}: {
  item: Attachment;
  url: string;
  grid?: boolean;
  thumbnailSize?: number;
  onOpen?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  const messages = useCoreI18n();
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const image = failed ? (
    <span
      className={`flex max-w-full items-center text-xs ${grid ? "justify-center" : "gap-1.5 px-2"}`}
    >
      <AttachmentFileIcon
        fileName={item.fileName}
        mimeType={item.mimeType}
        size={grid ? Math.max(16, thumbnailSize - 6) : 20}
      />
      {grid ? null : <span className="truncate">{item.fileName}</span>}
    </span>
  ) : (
    <img
      alt={item.fileName}
      className={`h-full w-full object-contain ${loaded ? "" : "opacity-0"}`}
      decoding="async"
      draggable={false}
      key={attempt}
      loading="lazy"
      onError={() => setFailed(true)}
      onLoad={() => setLoaded(true)}
      src={url}
    />
  );
  const gridSize = grid ? { height: thumbnailSize, width: thumbnailSize } : undefined;
  const frameClass = `relative flex items-center justify-center overflow-hidden rounded border bg-muted/40 ${grid ? "shrink-0" : failed ? "h-12 w-40 max-w-full" : "h-12 w-16"}`;
  return (
    <div
      className={`relative flex min-w-0 ${grid ? "shrink-0" : "max-w-48"} items-center gap-1`}
      style={gridSize}
    >
      {onOpen ? (
        <a
          aria-label={item.fileName}
          className={`${frameClass} hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
          draggable={false}
          href={url}
          onClick={onOpen}
          rel="noreferrer"
          target="_blank"
          title={item.fileName}
          style={gridSize}
        >
          {image}
          {!failed && !loaded ? (
            <span aria-hidden className="absolute inset-0 animate-pulse bg-muted" />
          ) : null}
        </a>
      ) : (
        <div className={frameClass} style={gridSize}>
          {image}
          {!failed && !loaded ? (
            <span aria-hidden className="absolute inset-0 animate-pulse bg-muted" />
          ) : null}
        </div>
      )}
      {failed ? (
        <button
          aria-label={`${messages.nodeDetail.filePreviewRetry}: ${item.fileName}`}
          className={`${grid ? "absolute right-0 bottom-0 bg-background p-0.5" : "p-1"} inline-flex shrink-0 items-center gap-1 rounded text-muted-foreground text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
          onClick={(event) => {
            event.stopPropagation();
            setFailed(false);
            setLoaded(false);
            setAttempt((current) => current + 1);
          }}
          title={messages.nodeDetail.filePreviewUnavailable}
          type="button"
        >
          <RotateCcw aria-hidden className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/** Attachment fields share ordering, safe addresses and a keyboard-accessible preview. */
export function AttachmentValuePreview({
  value,
  compact = false,
  className = "",
  renderTrigger,
  resolveUrl: resolveUrlOverride,
  thumbnailOnly = false,
  presentation = "flow",
  rowHeight = 48,
  maxVisible,
}: {
  value: unknown;
  compact?: boolean;
  /** Grid previews fit the selected row; flow remains compatible with detail/cards. */
  presentation?: "flow" | "grid";
  rowHeight?: number;
  /** Limit collapsed grid thumbnails while retaining every file in expansion. */
  maxVisible?: number;
  /** Hide file text in compact grid cells while retaining accessible names. */
  thumbnailOnly?: boolean;
  className?: string;
  /** Reuse this preview with a host-owned chip instead of the default thumbnail/link. */
  renderTrigger?: (
    item: Attachment,
    onOpen: (event: MouseEvent<HTMLAnchorElement | HTMLButtonElement>) => void,
  ) => ReactNode;
  /** Override only for trusted local files; stored fields keep the safe URL resolver. */
  resolveUrl?: (item: Attachment) => string | null;
  minimalChrome?: boolean;
}) {
  const messages = useCoreI18n();
  const resolveAssetUrl = useAssetContentUrlResolver();
  const resolveUrl =
    resolveUrlOverride ??
    ((item: Attachment) =>
      item.assetId && resolveAssetUrl ? resolveAssetUrl(item.assetId) : getSafeAttachmentUrl(item));
  const attachments = getAttachmentRefs(value);
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const grid = presentation === "grid";
  const hasAttachments = attachments.length > 0;
  const container = useRef<HTMLDivElement>(null);
  const expandTrigger = useRef<HTMLButtonElement>(null);
  const openingFromExpanded = useRef(false);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!grid || !hasAttachments || !container.current) return;
    const element = container.current;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [grid, hasAttachments]);
  // Resource IDs identify assets, not their repeated occurrences in a lookup result.
  const occurrences = new Map<string, number>();
  const entries = attachments.map((item) => {
    const ordinal = occurrences.get(item.id) ?? 0;
    occurrences.set(item.id, ordinal + 1);
    return { item, key: JSON.stringify([item.id, ordinal]) };
  });
  const opener = useRef<HTMLElement | null>(null);
  const selectedEntry = entries.find((entry) => entry.key === selectedKey) ?? entries[0];
  const thumbnailSize = attachmentGridThumbnailSize(rowHeight, width, attachments.length);
  const controlHeight = Math.min(32, Math.max(16, rowHeight - 8));
  const layout = attachmentGridLayout(
    width,
    attachments.map(() => thumbnailSize),
    maxVisible,
  );
  const visible = grid ? entries.slice(0, layout.visible) : compact ? entries.slice(0, 3) : entries;
  if (attachments.length === 0) return <span className="text-muted-foreground">-</span>;

  const openAttachment = (
    event: MouseEvent<HTMLAnchorElement | HTMLButtonElement>,
    key: string,
  ) => {
    // Keep normal browser link affordances for modified clicks.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0)
      return;
    event.preventDefault();
    event.stopPropagation();
    openingFromExpanded.current = expanded;
    opener.current = expanded ? expandTrigger.current : event.currentTarget;
    setExpanded(false);
    setSelectedKey(key);
    setOpen(true);
  };

  return (
    <>
      <Popover onOpenChange={setExpanded} open={grid && expanded}>
        <div
          className={`flex min-w-0 items-center ${grid ? "w-full flex-nowrap gap-[6px]" : "flex-wrap gap-1.5"} ${className}`}
          data-attachment-preview
          data-attachment-presentation={presentation}
          data-attachment-count={attachments.length}
          data-attachment-visible-count={visible.length}
          data-attachment-thumbnail-size={grid ? thumbnailSize : undefined}
          style={
            grid
              ? { height: Math.max(thumbnailSize, controlHeight), maxHeight: rowHeight - 8 }
              : undefined
          }
          ref={container}
          role="group"
          tabIndex={grid ? 0 : -1}
          onKeyDown={(event) => {
            if (grid && event.shiftKey && (event.key === " " || event.key === "Spacebar")) {
              event.preventDefault();
              event.stopPropagation();
              setExpanded(true);
            }
          }}
        >
          {visible.map(({ item, key }) => {
            if (renderTrigger) {
              return (
                <Fragment key={key}>
                  {renderTrigger(item, (event) => openAttachment(event, key))}
                </Fragment>
              );
            }
            const url = resolveUrl(item);
            if (url && !attachmentTextKind(item) && item.mimeType.startsWith("image/")) {
              return (
                <AttachmentImage
                  item={item}
                  grid={grid}
                  key={`${key}:${url}`}
                  onOpen={(event) => openAttachment(event, key)}
                  thumbnailSize={thumbnailSize}
                  url={url}
                />
              );
            }
            const content = (
              <>
                <AttachmentFileIcon
                  fileName={item.fileName}
                  mimeType={item.mimeType}
                  size={
                    grid
                      ? thumbnailSize >= 64
                        ? thumbnailSize - 30
                        : thumbnailSize >= 28
                          ? thumbnailSize - 10
                          : thumbnailSize
                      : 20
                  }
                />
                {grid && !thumbnailOnly && thumbnailSize >= 28 ? (
                  <span
                    aria-hidden
                    className={`max-w-full truncate font-medium text-muted-foreground ${thumbnailSize >= 64 ? "text-[10px] leading-3" : "text-[8px] leading-none"}`}
                    data-attachment-extension
                  >
                    {attachmentFileType(item.fileName, item.mimeType).label}
                  </span>
                ) : null}
                {grid && !thumbnailOnly && thumbnailSize >= 64 ? (
                  <span
                    aria-hidden
                    className="max-w-full truncate text-center text-[10px] leading-3"
                  >
                    {item.fileName.slice(0, 128)}
                  </span>
                ) : !grid ? (
                  <span className="truncate">{item.fileName}</span>
                ) : null}
              </>
            );
            const chipClass = `${grid ? "shrink-0 flex-col justify-center gap-0.5" : "max-w-48 gap-1.5 border bg-card px-2 py-1"} inline-flex min-w-0 items-center rounded text-xs`;
            const chipStyle = grid ? { height: thumbnailSize, width: thumbnailSize } : undefined;
            return url ? (
              <a
                aria-label={item.fileName}
                className={`${chipClass} text-primary hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                draggable={false}
                href={url}
                key={key}
                onClick={(event) => openAttachment(event, key)}
                rel="noreferrer"
                target="_blank"
                title={item.fileName}
                style={chipStyle}
              >
                {content}
              </a>
            ) : (
              <span
                aria-label={item.fileName}
                className={chipClass}
                key={key}
                role="group"
                title={item.fileName}
                style={chipStyle}
              >
                {content}
              </span>
            );
          })}
          {grid && layout.combinedControls ? (
            <PopoverTrigger asChild>
              <button
                aria-label={`${messages.shell.expand}: ${messages.nodeDetail.filePreviewTitle}`}
                className="max-w-full shrink-0 rounded border px-1 text-muted-foreground text-xs tabular-nums hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-attachment-expand
                data-attachment-overflow
                onClick={(event) => event.stopPropagation()}
                onMouseDown={(event) => {
                  if (event.button === 0) event.preventDefault();
                }}
                ref={expandTrigger}
                style={{
                  height: controlHeight,
                  width: Math.min(layout.overflowWidth, width || layout.overflowWidth),
                }}
                title={`${attachments.length} ${messages.common.items} (Shift+Space)`}
                type="button"
              >
                +{attachments.length}
              </button>
            </PopoverTrigger>
          ) : (compact || grid) && attachments.length > visible.length ? (
            <button
              aria-label={`${messages.common.open}: ${attachments.length} ${messages.common.items}`}
              className={`${grid ? "shrink-0 px-1 text-xs tabular-nums" : "px-2 text-xs"} rounded border py-1 text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
              data-attachment-overflow
              style={grid ? { height: controlHeight, width: layout.overflowWidth } : undefined}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                if (grid) {
                  setExpanded(true);
                  return;
                }
                opener.current = event.currentTarget;
                setSelectedKey(entries[visible.length]?.key ?? null);
                setOpen(true);
              }}
              onMouseDown={(event) => {
                if (event.button === 0) event.preventDefault();
              }}
              type="button"
            >
              {`+${attachments.length - visible.length}`}
            </button>
          ) : null}
          {grid && !layout.combinedControls ? (
            <PopoverTrigger asChild>
              <button
                aria-label={`${messages.shell.expand}: ${messages.nodeDetail.filePreviewTitle}`}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                data-attachment-expand
                onClick={(event) => event.stopPropagation()}
                onMouseDown={(event) => {
                  if (event.button === 0) event.preventDefault();
                }}
                ref={expandTrigger}
                title={`${messages.shell.expand}: ${messages.nodeDetail.filePreviewTitle} (Shift+Space)`}
                type="button"
              >
                <Expand aria-hidden className="size-3.5" />
              </button>
            </PopoverTrigger>
          ) : null}
        </div>
        {grid ? (
          <PopoverContent
            align="start"
            aria-label={messages.nodeDetail.filePreviewTitle}
            className="w-96 max-w-[calc(100vw-2rem)] p-3"
            collisionPadding={16}
            data-testid="attachment-cell-expanded"
            sticky="always"
            onCloseAutoFocus={(event) => {
              if (openingFromExpanded.current) event.preventDefault();
            }}
          >
            <div className="mb-2 flex items-center justify-between gap-2 text-sm">
              <span className="font-medium">{messages.nodeDetail.filePreviewTitle}</span>
              <span className="text-muted-foreground text-xs">
                {attachments.length} {messages.common.items}
              </span>
            </div>
            <AttachmentFileList
              active={expanded}
              className="max-h-[min(24rem,60vh)]"
              entries={entries.map((entry) => ({ ...entry, url: resolveUrl(entry.item) }))}
              onSelect={(entry, event) => openAttachment(event, entry.key)}
            />
          </PopoverContent>
        ) : null}
      </Popover>
      <AttachmentPreviewDialog
        entries={entries.map((entry) => ({ ...entry, url: resolveUrl(entry.item) }))}
        selectedKey={selectedEntry?.key ?? null}
        onSelect={setSelectedKey}
        onOpenChange={setOpen}
        open={open}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          (opener.current?.isConnected
            ? opener.current
            : (expandTrigger.current ?? container.current)
          )?.focus({
            preventScroll: true,
          });
          openingFromExpanded.current = false;
        }}
      />
    </>
  );
}
