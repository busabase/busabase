"use client";

import { Button } from "kui/button";
import { Download, ExternalLink } from "lucide-react";
import { type MouseEvent, useEffect, useRef, useState } from "react";
import { useCoreI18n } from "../../../i18n";
import { useAssetDownloadUrlBuilder } from "../../assets/hooks/asset-content-url-context";
import { attachmentTextKind } from "../utils/text-attachment";
import { AttachmentFileIcon } from "./attachment-file-icon";
import type { AttachmentPreviewEntry } from "./attachment-preview-dialog";

interface AttachmentFileListProps {
  entries: readonly AttachmentPreviewEntry[];
  selectedKey?: string | null;
  onSelect: (entry: AttachmentPreviewEntry, event: MouseEvent<HTMLButtonElement>) => void;
  className?: string;
  active?: boolean;
  showActions?: boolean;
}

export const AttachmentFileList = ({
  entries,
  selectedKey,
  onSelect,
  className = "",
  active = true,
  showActions = false,
}: AttachmentFileListProps) => {
  const messages = useCoreI18n();
  const buildDownloadUrl = useAssetDownloadUrlBuilder();
  const container = useRef<HTMLUListElement>(null);
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const [failedThumbnails, setFailedThumbnails] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!active || selectedKey == null || !container.current) return;
    const row = rows.current.get(selectedKey);
    if (!row) return;
    const viewport = container.current.getBoundingClientRect();
    const bounds = row.getBoundingClientRect();
    if (viewport.height > 0 && (bounds.top < viewport.top || bounds.bottom > viewport.bottom)) {
      row.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [active, selectedKey]);

  return (
    <ul
      className={`m-0 grid min-h-0 auto-rows-max list-none content-start gap-1 overflow-y-auto p-0 ${className}`}
      ref={container}
    >
      {entries.map((entry, index) => {
        const { item, key, url } = entry;
        const separator = item.fileName.lastIndexOf(".");
        const hasExtension = separator > 0 && separator < item.fileName.length - 1;
        const stem = hasExtension ? item.fileName.slice(0, separator) : item.fileName;
        const extension = hasExtension ? item.fileName.slice(separator) : "";
        return (
          <li
            className="group/file flex min-w-0 items-center gap-1 rounded hover:bg-accent focus-within:bg-accent data-[selected=true]:bg-accent"
            data-selected={key === selectedKey}
            key={key}
          >
            <button
              aria-label={item.fileName}
              aria-pressed={selectedKey == null ? undefined : key === selectedKey}
              className="flex min-w-0 flex-1 items-center gap-2 rounded p-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-accent"
              data-attachment-cell-item
              data-attachment-key={key}
              data-attachment-index={index}
              onClick={(event) => onSelect(entry, event)}
              ref={(element) => {
                if (element) rows.current.set(key, element);
                else rows.current.delete(key);
              }}
              title={item.fileName}
              type="button"
            >
              <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded border bg-muted/40">
                {url &&
                failedThumbnails[key] !== url &&
                !attachmentTextKind(item) &&
                item.mimeType.startsWith("image/") ? (
                  <img
                    alt=""
                    className="size-full object-contain"
                    loading="lazy"
                    onError={() => setFailedThumbnails((failed) => ({ ...failed, [key]: url }))}
                    src={url}
                  />
                ) : (
                  <AttachmentFileIcon fileName={item.fileName} mimeType={item.mimeType} size={32} />
                )}
              </span>
              <span className="flex min-w-0 flex-1 items-start" title={item.fileName}>
                <span className="min-w-0 line-clamp-2 break-all">{stem}</span>
                {extension ? (
                  <span className="max-w-1/2 shrink-0 truncate">{extension}</span>
                ) : null}
              </span>
            </button>
            {showActions && url ? (
              <div className="pointer-events-none flex shrink-0 items-center gap-0.5 pr-1 opacity-0 group-hover/file:pointer-events-auto group-hover/file:opacity-100 group-focus-within/file:pointer-events-auto group-focus-within/file:opacity-100 group-data-[selected=true]/file:pointer-events-auto group-data-[selected=true]/file:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100">
                <Button asChild size="icon-sm" variant="ghost">
                  <a
                    aria-label={`${messages.nodeDetail.downloadFile}: ${item.fileName}`}
                    download={item.fileName}
                    href={item.assetId ? buildDownloadUrl(item.assetId, item.fileName) : url}
                    onClick={(event) => event.stopPropagation()}
                    title={messages.nodeDetail.downloadFile}
                  >
                    <Download aria-hidden className="size-4" />
                  </a>
                </Button>
                <Button asChild size="icon-sm" variant="ghost">
                  <a
                    aria-label={`${messages.nodeDetail.openFileInNewTab}: ${item.fileName}`}
                    href={url}
                    onClick={(event) => event.stopPropagation()}
                    rel="noreferrer"
                    target="_blank"
                    title={messages.nodeDetail.openFileInNewTab}
                  >
                    <ExternalLink aria-hidden className="size-4" />
                  </a>
                </Button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
};
