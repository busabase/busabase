"use client";

// The `drive` field's record editor: the cell's files as a folder tree, a
// target folder that uploads land in, "new folder", and rename / move / remove
// for files and folders. Nothing here writes anything — every edit becomes the
// cell's next value through `onChange` and is saved with the record, like any
// other field. Every mutation goes through the pure helpers in
// `base/utils/drive-field-value.ts` (the server validates with the same rules),
// which refuse a conflicting edit instead of overwriting a file.

import type { BaseFieldVO } from "busabase-contract/types";
import { Button } from "kui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "kui/dialog";
import { Input } from "kui/input";
import { Label } from "kui/label";
import { cn } from "kui/utils";
import { Folder, FolderPlus, FolderTree, Paperclip, X } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { fmt, useCoreI18n, useIString } from "../../../i18n";
import {
  addDriveEntries,
  countDriveFolderFiles,
  type DriveMoveResult,
  driveFolderPaths,
  moveDriveEntry,
  moveDriveFolder,
  removeDriveEntry,
  removeDriveFolder,
} from "../../base/utils/drive-field-value";
import { getDriveFieldEntries } from "../helpers/field";
import {
  fileTreeUploadPath,
  normalizeFileTreeFolder,
  validateFileTreeName,
  validateFileTreePath,
} from "../helpers/file-tree-files";
import { type FieldFileUploader, useFieldFileUpload } from "../hooks/use-field-file-upload";
import {
  type DriveFieldEntry,
  DriveFilePreviewDialog,
  downloadDriveEntry,
  driveFolderChain,
  useDriveTreeExpansion,
} from "./drive-field-tree";
import { buildFileTree, DriveFileTree, renderFileTree } from "./file-tree-browser";
import { DialogContent } from "./localized-dialog-content";
import { ConfirmActionDialog } from "./primitives";

/** `path` is `folder` itself or sits somewhere under it. */
const isInsideFolder = (path: string, folder: string) =>
  path === folder || path.startsWith(`${folder}/`);

/** Re-point a path that sits under `from` to the same place under `to`. */
const moveUnderFolder = (path: string, from: string, to: string) =>
  isInsideFolder(path, from) ? `${to}${path.slice(from.length)}` : path;

type PathCheck = { ok: true; apply: () => void } | { ok: false; message: string | null };

type MoveTarget = { kind: "file" | "folder"; path: string };

interface Props {
  ariaDescribedBy?: string;
  field: BaseFieldVO;
  inputId: string;
  onChange: (value: unknown) => void;
  onUploadAttachment?: FieldFileUploader;
  value: unknown;
}

export function DriveFieldEditor({
  ariaDescribedBy,
  field,
  inputId,
  onChange,
  onUploadAttachment,
  value,
}: Props) {
  const messages = useCoreI18n();
  const copy = messages.recordView.drive;
  const resolveIString = useIString();
  const fieldName = resolveIString(field.name);
  const newFolderInputId = useId();
  const upload = useFieldFileUpload(field, onUploadAttachment);
  const entries = useMemo(() => getDriveFieldEntries(value), [value]);
  const entryByPath = useMemo(
    () => new Map(entries.map((entry) => [entry.path, entry])),
    [entries],
  );
  const impliedFolders = useMemo(() => driveFolderPaths(entries), [entries]);
  // Folders made with "New folder" (or emptied while they were the target)
  // that no file sits in yet. They exist only in this editor: a drive cell
  // stores files, and a folder is implied by their paths.
  const [pendingFolders, setPendingFolders] = useState<string[]>([]);
  const emptyFolders = useMemo(
    () => pendingFolders.filter((folder) => !impliedFolders.includes(folder)),
    [impliedFolders, pendingFolders],
  );
  const allFolders = useMemo(
    () =>
      [...new Set([...impliedFolders, ...emptyFolders.flatMap(driveFolderChain)])].sort((a, b) =>
        a.localeCompare(b),
      ),
    [emptyFolders, impliedFolders],
  );
  const tree = useMemo(() => buildFileTree(entries, emptyFolders), [emptyFolders, entries]);
  const expansion = useDriveTreeExpansion(allFolders);
  const [targetFolder, setTargetFolder] = useState("");
  // A target whose folder has gone (removed, or moved away) falls back to the root.
  const target = targetFolder && allFolders.includes(targetFolder) ? targetFolder : "";
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [removeFolderTarget, setRemoveFolderTarget] = useState<string | null>(null);
  const [previewPath, setPreviewPath] = useState<string | null>(null);
  const busy = upload.isUploading;
  const rootLabel = messages.nodeDetail.driveRoot;

  /**
   * Save the cell's next files. When an edit empties the folder uploads are
   * going to, that folder stays (as an empty one) so the next upload still
   * lands where the reader is looking.
   */
  const commit = (next: DriveFieldEntry[]) => {
    onChange(next);
    if (target && !driveFolderPaths(next).includes(target)) {
      setPendingFolders((current) => (current.includes(target) ? current : [...current, target]));
    }
  };

  const handleFiles = (fileList: FileList | null) => {
    const folder = target;
    return upload.upload(fileList, (uploaded) => {
      const next = upload.merge(entries, uploaded, (existing, added) =>
        addDriveEntries(existing, added, folder),
      );
      onChange(next);
      // A folder with files in it is implied by their paths from now on.
      const nowImplied = driveFolderPaths(next);
      setPendingFolders((current) => current.filter((path) => !nowImplied.includes(path)));
    });
  };

  // ── new folder ────────────────────────────────────────────────────────────
  const newFolderPath = fileTreeUploadPath(target, newFolderName.trim());
  const newFolderProblem = !newFolderName.trim()
    ? null
    : validateFileTreeName(newFolderName) !== null || validateFileTreePath(newFolderPath) !== null
      ? messages.nodeDetail.invalidFolderName
      : allFolders.includes(newFolderPath)
        ? fmt(messages.nodeDetail.folderAlreadyExists, { path: newFolderPath })
        : entryByPath.has(newFolderPath)
          ? fmt(copy.pathTaken, { path: newFolderPath })
          : null;
  const canCreateFolder = Boolean(newFolderName.trim()) && newFolderProblem === null;

  const closeNewFolder = () => {
    setCreatingFolder(false);
    setNewFolderName("");
  };

  const createFolder = () => {
    if (!canCreateFolder) return;
    setPendingFolders((current) => [...current, newFolderPath]);
    setTargetFolder(newFolderPath);
    expansion.reveal(newFolderPath);
    closeNewFolder();
  };

  // ── rename / move ─────────────────────────────────────────────────────────
  const moveProblem = (
    result: Extract<DriveMoveResult<DriveFieldEntry>, { ok: false }>,
    kind: MoveTarget["kind"],
    from: string,
    to: string,
  ): string | null => {
    if (result.reason === "unchanged" || result.reason === "missing") return null;
    if (result.reason === "conflict") return fmt(copy.pathTaken, { path: result.path ?? to });
    if (kind === "folder" && isInsideFolder(to, from)) return copy.folderIntoItself;
    return copy.invalidPath;
  };

  /** Folders made in this editor, and the target, follow a folder that moves. */
  const followFolderMove = (from: string, to: string) => {
    setPendingFolders((current) => current.map((path) => moveUnderFolder(path, from, to)));
    setTargetFolder((current) => moveUnderFolder(current, from, to));
    expansion.reveal(to);
  };

  const checkFileMove =
    (from: string) =>
    (to: string): PathCheck => {
      const result = moveDriveEntry(entries, from, to);
      if (!result.ok) return { ok: false, message: moveProblem(result, "file", from, to) };
      return {
        ok: true,
        apply: () => {
          // `moveDriveEntry` renames `fileName` along with a new last segment,
          // so grid chips and cards show the new name too.
          commit(result.entries);
          expansion.reveal(to.split("/").slice(0, -1).join("/"));
        },
      };
    };

  const checkFolderMove =
    (from: string) =>
    (to: string): PathCheck => {
      if (countDriveFolderFiles(entries, from) > 0) {
        const result = moveDriveFolder(entries, from, to);
        if (!result.ok) return { ok: false, message: moveProblem(result, "folder", from, to) };
        return {
          ok: true,
          apply: () => {
            onChange(result.entries);
            followFolderMove(from, to);
          },
        };
      }
      // A folder with no file in it yet has nothing to move: only its name changes.
      if (to === from) return { ok: false, message: null };
      if (validateFileTreePath(to) !== null) return { ok: false, message: copy.invalidPath };
      if (isInsideFolder(to, from)) return { ok: false, message: copy.folderIntoItself };
      const taken = allFolders.includes(to)
        ? to
        : driveFolderChain(to).find((path) => entryByPath.has(path));
      if (taken) return { ok: false, message: fmt(copy.pathTaken, { path: taken }) };
      return { ok: true, apply: () => followFolderMove(from, to) };
    };

  // ── remove ────────────────────────────────────────────────────────────────
  /** Forget folders made in this editor under `folder`, and move the target off it. */
  const forgetFolder = (folder: string) => {
    setPendingFolders((current) => current.filter((path) => !isInsideFolder(path, folder)));
    setTargetFolder((current) => (current && isInsideFolder(current, folder) ? "" : current));
  };

  const requestRemoveFolder = (folder: string) => {
    // An empty folder holds nothing to lose, so it goes without asking.
    if (countDriveFolderFiles(entries, folder) === 0) {
      forgetFolder(folder);
      return;
    }
    setRemoveFolderTarget(folder);
  };

  const confirmRemoveFolder = () => {
    if (removeFolderTarget === null) return;
    onChange(removeDriveFolder(entries, removeFolderTarget));
    forgetFolder(removeFolderTarget);
    setRemoveFolderTarget(null);
  };

  const removeFolderCount =
    removeFolderTarget === null ? 0 : countDriveFolderFiles(entries, removeFolderTarget);
  const targetIsEmpty = target !== "" && countDriveFolderFiles(entries, target) === 0;
  const showTree = entries.length > 0 || emptyFolders.length > 0;

  return (
    <div className="grid min-w-0 gap-2" data-drive-field-editor={field.slug}>
      <div className="flex flex-wrap items-center gap-2">
        <label
          className="inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-md border border-border/70 border-dashed bg-card px-3 py-1.5 text-sm transition-colors hover:bg-accent"
          htmlFor={inputId}
        >
          <Paperclip size={14} />
          {upload.label}
        </label>
        <input
          accept={upload.accept}
          aria-describedby={ariaDescribedBy}
          aria-label={fieldName}
          className="sr-only"
          disabled={busy || !upload.canUpload}
          id={inputId}
          multiple={upload.multiple}
          onChange={(event) => {
            void handleFiles(event.currentTarget.files);
            event.currentTarget.value = "";
          }}
          type="file"
        />
        <button
          className="inline-flex w-fit items-center gap-1.5 rounded-md border border-border/70 bg-card px-3 py-1.5 text-sm transition-colors hover:bg-accent disabled:opacity-50"
          disabled={busy || creatingFolder}
          onClick={() => setCreatingFolder(true)}
          type="button"
        >
          <FolderPlus size={14} />
          {messages.nodeDetail.newFolder}
        </button>
        <span
          className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs"
          data-drive-target-folder={target}
        >
          <span className="shrink-0">{messages.nodeDetail.uploadDestination}</span>
          <span className="inline-flex min-w-0 items-center gap-1 rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-foreground">
            {target ? (
              <Folder aria-hidden className="size-3 shrink-0" />
            ) : (
              <FolderTree aria-hidden className="size-3 shrink-0" />
            )}
            <span className="truncate">{target || rootLabel}</span>
          </span>
        </span>
      </div>

      {creatingFolder ? (
        <div className="grid gap-1.5 rounded-md border border-border/60 bg-muted/20 p-2.5">
          <Label className="text-xs" htmlFor={newFolderInputId}>
            {fmt(messages.nodeDetail.newFolderIn, { folder: target || rootLabel })}
          </Label>
          <div className="flex items-center gap-2">
            <Input
              aria-invalid={newFolderProblem !== null}
              autoFocus
              className="h-8"
              id={newFolderInputId}
              onChange={(event) => setNewFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  createFolder();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  closeNewFolder();
                }
              }}
              placeholder={messages.nodeDetail.newFolderPlaceholder}
              value={newFolderName}
            />
            <Button disabled={!canCreateFolder} onClick={createFolder} size="sm" type="button">
              {messages.common.add}
            </Button>
            <Button
              aria-label={messages.nodeDetail.cancelNewFolder}
              className="size-8 shrink-0 text-muted-foreground"
              onClick={closeNewFolder}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <X aria-hidden className="size-3.5" />
            </Button>
          </div>
          {newFolderProblem ? (
            <p aria-live="polite" className="text-rejected-strong text-xs dark:text-rejected-soft">
              {newFolderProblem}
            </p>
          ) : null}
        </div>
      ) : null}

      {upload.uploadError ? <p className="text-destructive text-xs">{upload.uploadError}</p> : null}

      {showTree ? (
        <DriveFileTree
          className="bg-card"
          expanded={expansion.expanded}
          onDownloadFile={(path) => {
            const entry = entryByPath.get(path);
            if (entry) downloadDriveEntry(entry);
          }}
          onExpandedChange={expansion.onExpandedChange}
          onRemoveFile={busy ? undefined : (path) => commit(removeDriveEntry(entries, path))}
          onRemoveFolder={busy ? undefined : requestRemoveFolder}
          onRenameFile={busy ? undefined : (path) => setMoveTarget({ kind: "file", path })}
          onRenameFolder={busy ? undefined : (path) => setMoveTarget({ kind: "folder", path })}
          renameFileLabel={copy.moveFile}
          renameFolderLabel={copy.moveFolder}
          onSelect={(path) => {
            if (entryByPath.has(path)) setPreviewPath(path);
            else setTargetFolder(path);
          }}
          selectedPath={target || undefined}
        >
          <button
            aria-level={1}
            aria-selected={target === ""}
            className={cn(
              "flex min-h-8 w-full items-center gap-1.5 rounded px-2 py-1 text-left outline-none transition-colors duration-150 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring",
              target === "" && "bg-muted font-medium",
            )}
            onClick={() => setTargetFolder("")}
            role="treeitem"
            type="button"
          >
            <FolderTree aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{rootLabel}</span>
          </button>
          {renderFileTree(tree, 1)}
        </DriveFileTree>
      ) : null}

      {targetIsEmpty ? (
        <p className="text-muted-foreground text-xs">{copy.emptyFolderHint}</p>
      ) : null}

      {moveTarget ? (
        <DrivePathDialog
          check={
            moveTarget.kind === "file"
              ? checkFileMove(moveTarget.path)
              : checkFolderMove(moveTarget.path)
          }
          key={`${moveTarget.kind}:${moveTarget.path}`}
          kind={moveTarget.kind}
          onClose={() => setMoveTarget(null)}
          path={moveTarget.path}
        />
      ) : null}

      <ConfirmActionDialog
        body={
          removeFolderTarget === null
            ? ""
            : fmt(copy.removeFolderBody, {
                count: removeFolderCount,
                folder: removeFolderTarget,
                plural: removeFolderCount === 1 ? "" : "s",
              })
        }
        confirmLabel={messages.nodeDetail.removeFolder}
        onCancel={() => setRemoveFolderTarget(null)}
        onConfirm={confirmRemoveFolder}
        open={removeFolderTarget !== null}
        title={messages.nodeDetail.removeFolder}
      />

      <DriveFilePreviewDialog
        entry={previewPath ? (entryByPath.get(previewPath) ?? null) : null}
        onClose={() => setPreviewPath(null)}
      />
    </div>
  );
}

/**
 * Rename or move one file or folder by editing its FULL path: changing the last
 * part renames it, changing the folders before it moves it. `check` runs on
 * every keystroke, so a path that is taken or invalid is explained before the
 * reader presses Apply — and Apply stays off until the path is usable.
 */
function DrivePathDialog({
  check,
  kind,
  onClose,
  path,
}: {
  check: (nextPath: string) => PathCheck;
  kind: MoveTarget["kind"];
  onClose: () => void;
  path: string;
}) {
  const messages = useCoreI18n();
  const copy = messages.recordView.drive;
  const inputId = useId();
  const hintId = useId();
  const [draft, setDraft] = useState(path);
  const result = check(normalizeFileTreeFolder(draft));

  const submit = () => {
    if (!result.ok) return;
    result.apply();
    onClose();
  };

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <DialogContent className="p-0 sm:max-w-md" data-testid="drive-path-dialog">
        <DialogHeader className="border-border/60 border-b px-5 py-4">
          <DialogTitle className="text-base">
            {kind === "file" ? copy.moveFile : copy.moveFolder}
          </DialogTitle>
          <DialogDescription className="break-all font-mono text-xs">{path}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 px-5 py-4">
          <Label htmlFor={inputId}>{kind === "file" ? copy.filePath : copy.folderPath}</Label>
          <Input
            aria-describedby={hintId}
            aria-invalid={!result.ok && result.message !== null}
            autoFocus
            className="h-9 font-mono"
            id={inputId}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
            value={draft}
          />
          <p className="text-muted-foreground text-xs" id={hintId}>
            {kind === "file" ? copy.movePathHint : copy.moveFolderHint}
          </p>
          {!result.ok && result.message ? (
            <p aria-live="polite" className="text-rejected-strong text-sm dark:text-rejected-soft">
              {result.message}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end gap-2 border-border/60 border-t bg-muted/20 px-5 py-3">
          <Button onClick={onClose} size="sm" type="button" variant="ghost">
            {messages.common.cancel}
          </Button>
          <Button disabled={!result.ok} onClick={submit} size="sm" type="button">
            {copy.apply}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
