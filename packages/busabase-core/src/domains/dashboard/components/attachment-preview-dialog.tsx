"use client";

import { Button } from "kui/button";
import { Dialog, DialogClose, DialogTitle } from "kui/dialog";
import { Sheet, SheetContent, SheetTitle } from "kui/sheet";
import { ChevronLeft, ChevronRight, Download, ExternalLink, RotateCcw, X } from "lucide-react";
import { FileFetchService } from "previewfile-core/client/file-fetch";
import { type ComponentProps, useEffect, useId, useRef, useState } from "react";
import { useCoreI18n } from "../../../i18n";
import { useAssetDownloadUrlBuilder } from "../../assets/hooks/asset-content-url-context";
import type { getAttachmentRefs } from "../helpers/field";
import { useSidePanelViewport } from "../hooks/use-side-panel-viewport";
import { DEFAULT_SIDE_PANEL_WIDTH } from "../side-panel-layout";
import { AttachmentFileList } from "./attachment-file-list";
import { AttachmentViewer } from "./attachment-viewer";
import { DialogContent } from "./localized-dialog-content";
import { SidePanelVisibilityButton } from "./side-panel-visibility-button";
import "./attachment-preview-dialog.css";

export interface AttachmentPreviewEntry {
  key: string;
  item: ReturnType<typeof getAttachmentRefs>[number];
  url: string | null;
}

interface AttachmentPreviewDialogProps {
  entries: AttachmentPreviewEntry[];
  selectedKey: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (key: string) => void;
  onCloseAutoFocus?: ComponentProps<typeof DialogContent>["onCloseAutoFocus"];
  testId?: string;
}

export const AttachmentPreviewDialog = ({
  entries,
  selectedKey,
  open,
  onOpenChange,
  onSelect,
  onCloseAutoFocus,
  testId = "attachment-preview-dialog",
}: AttachmentPreviewDialogProps) => {
  const messages = useCoreI18n();
  const buildDownloadUrl = useAssetDownloadUrlBuilder();
  const isMobile = useSidePanelViewport();
  const [panelOpen, setPanelOpen] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const opener = useRef<HTMLElement | null>(null);
  const panelToggle = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const hasMultiple = entries.length > 1;
  const listOpen = hasMultiple && (isMobile ? drawerOpen : panelOpen);
  useEffect(() => {
    if (!open) {
      setPanelOpen(true);
      setDrawerOpen(false);
      setAttempt(0);
    }
  }, [open]);
  useEffect(() => {
    if (!isMobile) setDrawerOpen(false);
  }, [isMobile]);
  const selected = entries.find((entry) => entry.key === selectedKey) ?? entries[0];
  const index = selected ? entries.indexOf(selected) : -1;
  const item = selected?.item;
  const url = selected?.url;
  const choose = (key: string) => {
    onSelect(key);
    setDrawerOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="inset-0 flex h-dvh max-h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:rounded-none lg:inset-4 lg:mx-auto lg:h-auto lg:max-h-none lg:w-auto lg:max-w-[var(--attachment-preview-max-width)] lg:rounded-lg lg:dark:border lg:dark:border-border"
        data-attachment-preview-surface
        data-testid={testId}
        onOpenAutoFocus={() => {
          opener.current =
            document.activeElement instanceof HTMLElement ? document.activeElement : null;
        }}
        onCloseAutoFocus={
          onCloseAutoFocus ??
          ((event) => {
            if (opener.current?.isConnected) {
              event.preventDefault();
              opener.current.focus({ preventScroll: true });
            }
          })
        }
        onEscapeKeyDown={(event) => {
          if (document.fullscreenElement) {
            event.preventDefault();
            void document.exitFullscreen();
          }
        }}
        showCloseButton={false}
      >
        <header className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-b bg-background px-3 py-2 sm:flex-nowrap sm:px-4">
          <DialogTitle className="min-w-0 flex-1 truncate text-sm" title={item?.fileName}>
            {item?.fileName ?? messages.nodeDetail.filePreviewTitle}
          </DialogTitle>
          <div className="flex shrink-0 items-center gap-1">
            {hasMultiple ? (
              <>
                <Button
                  aria-label={messages.base.paginationPrevious}
                  title={messages.base.paginationPrevious}
                  disabled={index <= 0}
                  onClick={() => entries[index - 1] && choose(entries[index - 1].key)}
                  size="icon-sm"
                  variant="ghost"
                >
                  <ChevronLeft aria-hidden className="size-4" />
                </Button>
                <span
                  aria-live="polite"
                  data-attachment-position
                  className="px-2 text-sm tabular-nums"
                >
                  {index + 1} / {entries.length}
                </span>
                <Button
                  aria-label={messages.base.paginationNext}
                  title={messages.base.paginationNext}
                  disabled={index >= entries.length - 1}
                  onClick={() => entries[index + 1] && choose(entries[index + 1].key)}
                  size="icon-sm"
                  variant="ghost"
                >
                  <ChevronRight aria-hidden className="size-4" />
                </Button>
              </>
            ) : null}
            <Button
              aria-label={messages.nodeDetail.filePreviewRetry}
              title={messages.nodeDetail.filePreviewRetry}
              disabled={!url}
              onClick={() => {
                if (url) FileFetchService.getInstance().clearUrl(url);
                setAttempt((value) => value + 1);
              }}
              size="icon-sm"
              variant="ghost"
            >
              <RotateCcw aria-hidden className="size-4" />
            </Button>
            {item && url ? (
              <>
                <Button asChild size="icon-sm" variant="ghost">
                  <a
                    aria-label={messages.nodeDetail.downloadFile}
                    title={messages.nodeDetail.downloadFile}
                    download={item.fileName}
                    href={item.assetId ? buildDownloadUrl(item.assetId, item.fileName) : url}
                  >
                    <Download aria-hidden className="size-4" />
                  </a>
                </Button>
                <Button asChild size="icon-sm" variant="ghost">
                  <a
                    aria-label={messages.nodeDetail.openFileInNewTab}
                    title={messages.nodeDetail.openFileInNewTab}
                    href={url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    <ExternalLink aria-hidden className="size-4" />
                  </a>
                </Button>
              </>
            ) : null}
            {hasMultiple ? (
              <SidePanelVisibilityButton
                aria-controls={panelId}
                onOpenChange={isMobile ? setDrawerOpen : setPanelOpen}
                open={listOpen}
                ref={panelToggle}
              />
            ) : null}
            <DialogClose asChild>
              <Button
                aria-label={messages.common.close}
                title={messages.common.close}
                size="icon-sm"
                variant="ghost"
              >
                <X aria-hidden className="size-4" />
              </Button>
            </DialogClose>
          </div>
        </header>
        <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <div className="min-h-0 min-w-0 flex-1 overflow-hidden" data-attachment-preview-body>
            {item && url ? (
              <AttachmentViewer
                key={JSON.stringify([selected.key, url, item.fileName, item.mimeType, attempt])}
                file={{ name: item.fileName, mimeType: item.mimeType, url, size: item.size }}
              />
            ) : (
              <div className="grid h-full place-items-center p-4 text-muted-foreground text-sm">
                {messages.nodeDetail.filePreviewUnavailable}
              </div>
            )}
          </div>
          {hasMultiple && !isMobile ? (
            <aside
              aria-label={messages.nodeDetail.files}
              className="flex h-full min-h-0 shrink-0 flex-col border-l bg-background"
              data-testid="attachment-preview-panel"
              hidden={!panelOpen}
              id={panelId}
              style={{ width: DEFAULT_SIDE_PANEL_WIDTH, display: panelOpen ? undefined : "none" }}
            >
              <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3 text-sm">
                <span className="font-medium">{messages.nodeDetail.files}</span>
                <span className="text-muted-foreground tabular-nums" data-attachment-list-count>
                  {entries.length} {messages.common.items}
                </span>
              </div>
              <AttachmentFileList
                active={open && panelOpen}
                className="min-h-0 flex-1 overflow-y-auto p-2"
                entries={entries}
                onSelect={(entry) => choose(entry.key)}
                selectedKey={selected?.key}
                showActions
              />
            </aside>
          ) : null}
        </div>
        {hasMultiple && isMobile ? (
          <Sheet open={open && drawerOpen} onOpenChange={setDrawerOpen}>
            <SheetContent
              aria-describedby={undefined}
              className="flex min-w-0 flex-col gap-0 p-0 sm:max-w-none [&>button]:hidden"
              data-testid="attachment-preview-drawer"
              id={panelId}
              onCloseAutoFocus={(event) => {
                event.preventDefault();
                panelToggle.current?.focus({ preventScroll: true });
              }}
              onEscapeKeyDown={(event) => {
                if (document.fullscreenElement) {
                  event.preventDefault();
                  void document.exitFullscreen();
                }
              }}
              side="right"
              style={{ width: DEFAULT_SIDE_PANEL_WIDTH, maxWidth: "100vw" }}
            >
              <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
                <SheetTitle className="flex-1 text-sm">{messages.nodeDetail.files}</SheetTitle>
                <span
                  className="text-muted-foreground text-sm tabular-nums"
                  data-attachment-list-count
                >
                  {entries.length} {messages.common.items}
                </span>
                <SidePanelVisibilityButton onOpenChange={setDrawerOpen} open={drawerOpen} />
              </div>
              <AttachmentFileList
                active={open && drawerOpen}
                className="min-h-0 flex-1 overflow-y-auto p-2"
                entries={entries}
                onSelect={(entry) => choose(entry.key)}
                selectedKey={selected?.key}
                showActions
              />
            </SheetContent>
          </Sheet>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};
