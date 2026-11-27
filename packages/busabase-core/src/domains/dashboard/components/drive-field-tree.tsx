"use client";

// The `drive` field's folder tree, read-only: the record page draws a drive
// cell with it, and the record editor (`drive-field-editor.tsx`) reuses its
// pieces. Rows are the Drive node's own (`DriveFileTree` + `renderFileTree`),
// so a drive column's files look like a Drive's files; a file opens in the same
// preview the attachment column uses.

import { FileText } from "lucide-react";
import { type RefObject, useCallback, useMemo, useRef, useState } from "react";
import {
  useAssetContentUrlResolver,
  useAssetDownloadUrlBuilder,
} from "../../assets/hooks/asset-content-url-context";
import { buildAssetDownloadUrl } from "../../assets/utils/asset-content-url";
import { getDriveFieldEntries, getSafeAttachmentUrl } from "../helpers/field";
import { fileTreeFileName } from "../helpers/file-tree-files";
import { AttachmentPreviewDialog } from "./attachment-preview-dialog";
import {
  buildFileTree,
  collectFolderPaths,
  DriveFileTree,
  renderFileTree,
} from "./file-tree-browser";

export type DriveFieldEntry = ReturnType<typeof getDriveFieldEntries>[number];

/** `a/b/c` → [`a`, `a/b`, `a/b/c`]: a folder and every folder it sits in. */
export const driveFolderChain = (folder: string): string[] => {
  const segments = folder.split("/").filter(Boolean);
  return segments.map((_, index) => segments.slice(0, index + 1).join("/"));
};

/** A file as the tree shows it: named after the last part of its path. */
const asShown = (entry: DriveFieldEntry): DriveFieldEntry => ({
  ...entry,
  fileName: fileTreeFileName(entry.path),
});

/** Download one file of a drive cell under the name the tree shows for it. */
export const downloadDriveEntry = (
  entry: DriveFieldEntry,
  buildDownloadUrl: (assetId: string, fileName?: string | null) => string = buildAssetDownloadUrl,
) => {
  const name = fileTreeFileName(entry.path);
  const url = entry.assetId ? buildDownloadUrl(entry.assetId, name) : getSafeAttachmentUrl(entry);
  if (!url) return;
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noreferrer";
  anchor.click();
};

/**
 * Every folder of a drive tree starts open and stays open unless the reader
 * closes it — so a folder that appears later (an upload, a move, a live
 * refresh) shows its files straight away instead of arriving collapsed.
 */
export function useDriveTreeExpansion(folders: readonly string[]) {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const expanded = useMemo(
    () => new Set(folders.filter((folder) => !collapsed.has(folder))),
    [collapsed, folders],
  );
  const onExpandedChange = useCallback(
    (next: Set<string>) => {
      setCollapsed(new Set(folders.filter((folder) => !next.has(folder))));
    },
    [folders],
  );
  /** Open `folder` and every folder above it. */
  const reveal = useCallback((folder: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      for (const path of driveFolderChain(folder)) next.delete(path);
      return next;
    });
  }, []);
  return { expanded, onExpandedChange, reveal };
}

/** One file of a drive cell, previewed the way an attachment cell previews its files. */
export function DriveFilePreviewDialog({
  entry,
  onClose,
  opener,
}: {
  entry: DriveFieldEntry | null;
  onClose: () => void;
  opener?: RefObject<HTMLElement | null>;
}) {
  const resolveAssetUrl = useAssetContentUrlResolver();
  const shown = entry ? asShown(entry) : null;
  return (
    <AttachmentPreviewDialog
      entries={
        shown
          ? [
              {
                key: shown.path,
                item: shown,
                url:
                  shown.assetId && resolveAssetUrl
                    ? resolveAssetUrl(shown.assetId)
                    : getSafeAttachmentUrl(shown),
              },
            ]
          : []
      }
      selectedKey={shown?.path ?? null}
      onSelect={() => {}}
      onCloseAutoFocus={
        opener
          ? (event) => {
              if (opener.current?.isConnected) {
                event.preventDefault();
                opener.current.focus({ preventScroll: true });
              }
            }
          : undefined
      }
      testId="drive-file-preview-dialog"
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open={shown !== null}
    />
  );
}

/**
 * A drive cell as a read-only folder tree (the record page). Clicking a file
 * opens its preview; its row menu downloads it. An empty cell is the same `-`
 * every other empty value shows.
 */
export function DriveFieldTree({ value }: { value: unknown }) {
  const entries = useMemo(() => getDriveFieldEntries(value), [value]);
  const entryByPath = useMemo(
    () => new Map(entries.map((entry) => [entry.path, entry])),
    [entries],
  );
  const tree = useMemo(() => buildFileTree(entries), [entries]);
  const folders = useMemo(() => collectFolderPaths(tree), [tree]);
  const expansion = useDriveTreeExpansion(folders);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const previewOpener = useRef<HTMLElement | null>(null);
  const buildDownloadUrl = useAssetDownloadUrlBuilder();

  if (entries.length === 0) return <span className="text-muted-foreground">-</span>;

  return (
    <div
      className="min-w-0"
      data-drive-field-tree
      onClickCapture={(event) => {
        if (event.target instanceof Element) {
          const trigger = event.target.closest<HTMLElement>('[role="treeitem"]');
          if (trigger) previewOpener.current = trigger;
        }
      }}
    >
      <DriveFileTree
        expanded={expansion.expanded}
        onDownloadFile={(path) => {
          const entry = entryByPath.get(path);
          if (entry) downloadDriveEntry(entry, buildDownloadUrl);
        }}
        onExpandedChange={expansion.onExpandedChange}
        onSelect={(path) => {
          if (entryByPath.has(path)) setPreviewPath(path);
        }}
      >
        {renderFileTree(tree)}
      </DriveFileTree>
      <DriveFilePreviewDialog
        opener={previewOpener}
        entry={previewPath ? (entryByPath.get(previewPath) ?? null) : null}
        onClose={() => setPreviewPath(null)}
      />
    </div>
  );
}

/**
 * A drive cell as the paths of its files, one per line and sorted — what a
 * change-request diff shows, so a file that only MOVED reads as a change
 * instead of the same file name on both sides.
 */
export function DriveFieldPathList({ value }: { value: unknown }) {
  const entries = getDriveFieldEntries(value).sort((a, b) => a.path.localeCompare(b.path));
  if (entries.length === 0) return <span className="text-muted-foreground">-</span>;
  return (
    <ul className="grid min-w-0 gap-0.5" data-drive-field-paths>
      {entries.map((entry) => (
        <li className="flex min-w-0 items-center gap-1.5 font-mono text-xs" key={entry.path}>
          <FileText aria-hidden className="size-3.5 shrink-0 opacity-70" />
          <span className="break-all">{entry.path}</span>
        </li>
      ))}
    </ul>
  );
}
