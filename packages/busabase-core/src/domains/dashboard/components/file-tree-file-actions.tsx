"use client";

import type { FileTreeFileVO } from "busabase-contract/types";
import { Button } from "kui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "kui/dialog";
import { Input } from "kui/input";
import { Label } from "kui/label";
import {
  Check,
  ChevronRight,
  Files,
  FileText,
  Folder,
  FolderPlus,
  FolderTree,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useCoreI18n } from "../../../i18n";
import {
  fileTreeFileName,
  fileTreeUploadPath,
  formatFileTreeBytes,
  normalizeFileTreeFolder,
  validateFileTreeFolder,
  validateFileTreeName,
  validateFileTreePath,
} from "../helpers/file-tree-files";
import { SplitSubmitButton, type SubmitActionKind } from "./split-submit-button";

export type FileTreeMutationMode = SubmitActionKind;

export function FileTreeUploadControl({
  availableFolders,
  defaultFolder,
  existingPaths,
  onSubmit,
}: {
  availableFolders: string[];
  defaultFolder: string;
  existingPaths: Set<string>;
  onSubmit: (files: File[], folder: string, mode: FileTreeMutationMode) => Promise<void>;
}) {
  const messages = useCoreI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [selectedFolder, setSelectedFolder] = useState(defaultFolder);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [busy, setBusy] = useState<FileTreeMutationMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const newFolderError = creatingFolder ? validateFileTreeName(newFolderName) : null;
  const newFolderPath =
    creatingFolder && !newFolderError
      ? fileTreeUploadPath(selectedFolder, newFolderName.trim())
      : "";
  const folderConflict = Boolean(newFolderPath && availableFolders.includes(newFolderPath));
  const folder = creatingFolder && !newFolderError ? newFolderPath : selectedFolder;
  const selectedFolderSegments = selectedFolder.split("/").filter(Boolean);
  const selectedFolderBreadcrumbs = selectedFolderSegments.map((segment, index) => ({
    path: selectedFolderSegments.slice(0, index + 1).join("/"),
    segment,
  }));
  const paths = files.map((file) => fileTreeUploadPath(folder, file.name));
  const invalidFolderPath = validateFileTreeFolder(folder) !== null;
  const invalidUploadFileName = paths.some((path) => validateFileTreePath(path) !== null);
  const invalidPath =
    Boolean(newFolderError) || folderConflict || invalidFolderPath || invalidUploadFileName;
  const conflictPath = paths.find((path) => existingPaths.has(path));
  const duplicatePath = new Set(paths).size !== paths.length;
  // Each cause gets its own copy: a bad new-folder name and an unstorable
  // uploaded file name are different problems, and pointing either of them at
  // the generic "folder path" message sends the user to fix the wrong field.
  const problem =
    error ??
    (conflictPath
      ? messages.nodeDetail.fileAlreadyExists.replace("{path}", conflictPath)
      : folderConflict
        ? messages.nodeDetail.folderAlreadyExists.replace("{path}", newFolderPath)
        : duplicatePath
          ? messages.nodeDetail.duplicateUploadNames
          : newFolderError
            ? messages.nodeDetail.invalidFolderName
            : invalidFolderPath
              ? messages.nodeDetail.invalidFilePath
              : invalidUploadFileName
                ? messages.nodeDetail.invalidUploadFileName
                : null);

  const reset = () => {
    setFiles([]);
    setSelectedFolder(defaultFolder);
    setCreatingFolder(false);
    setNewFolderName("");
    setBusy(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  const submit = async (mode: FileTreeMutationMode) => {
    if (files.length === 0 || invalidPath || conflictPath || duplicatePath) return;
    setBusy(mode);
    setError(null);
    try {
      await onSubmit(files, normalizeFileTreeFolder(folder), mode);
      setOpen(false);
      reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : messages.nodeDetail.fileUploadFailed);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <input
        className="sr-only"
        multiple
        onChange={(event) => {
          const selected = Array.from(event.target.files ?? []);
          if (selected.length === 0) return;
          setFiles(selected);
          // Only seed the destination when the dialog is opening. Re-picking
          // files from the already-open dialog ("Choose files" in the footer)
          // must keep the folder the user just chose — silently snapping it
          // back to `defaultFolder` is invisible mid-dialog and would upload
          // to the wrong parent.
          if (!open) {
            setSelectedFolder(defaultFolder);
            setCreatingFolder(false);
            setNewFolderName("");
          }
          setError(null);
          setOpen(true);
        }}
        ref={inputRef}
        tabIndex={-1}
        type="file"
      />
      <Button
        aria-label={messages.nodeDetail.uploadFiles}
        className="size-8 shrink-0 text-muted-foreground transition-[color,background-color,transform] duration-150 active:scale-[0.96]"
        onClick={() => inputRef.current?.click()}
        size="icon-sm"
        title={messages.nodeDetail.uploadFiles}
        type="button"
        variant="ghost"
      >
        <Upload aria-hidden className="size-3.5" />
      </Button>

      <Dialog
        onOpenChange={(next) => {
          if (busy) return;
          setOpen(next);
          if (!next) reset();
        }}
        open={open}
      >
        <DialogContent className="!flex max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-h-[min(90dvh,760px)] sm:max-w-lg">
          <DialogHeader className="shrink-0 border-border/60 border-b px-5 py-4">
            <DialogTitle className="text-base">{messages.nodeDetail.uploadFiles}</DialogTitle>
            <DialogDescription>{messages.nodeDetail.uploadFilesDescription}</DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
            <div className="space-y-1.5">
              <Label>
                {creatingFolder
                  ? messages.nodeDetail.parentFolder
                  : messages.nodeDetail.uploadDestination}
              </Label>
              <div
                aria-label={messages.nodeDetail.uploadDestination}
                className="max-h-40 overflow-y-auto rounded-md border border-border/60 p-1"
                role="radiogroup"
              >
                <button
                  aria-checked={selectedFolder === ""}
                  className={`flex min-h-9 w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted/60 ${
                    selectedFolder === "" ? "bg-muted font-medium" : ""
                  }`}
                  disabled={busy !== null}
                  onClick={() => setSelectedFolder("")}
                  role="radio"
                  type="button"
                >
                  <FolderTree aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">{messages.nodeDetail.driveRoot}</span>
                  {selectedFolder === "" ? (
                    <Check aria-hidden className="size-3.5 shrink-0" />
                  ) : null}
                </button>
                {availableFolders.map((path) => {
                  const selected = selectedFolder === path;
                  const depth = path.split("/").length - 1;
                  return (
                    <button
                      aria-checked={selected}
                      className={`flex min-h-9 w-full items-center gap-2 rounded-sm py-1.5 pr-2 text-left text-sm transition-colors hover:bg-muted/60 ${
                        selected ? "bg-muted font-medium" : ""
                      }`}
                      disabled={busy !== null}
                      key={path}
                      onClick={() => setSelectedFolder(path)}
                      role="radio"
                      style={{ paddingLeft: 8 + depth * 16 }}
                      type="button"
                    >
                      <Folder aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate">{fileTreeFileName(path)}</span>
                      {selected ? <Check aria-hidden className="size-3.5 shrink-0" /> : null}
                    </button>
                  );
                })}
              </div>
              {!creatingFolder ? (
                <Button
                  className="h-8 max-w-full px-2 text-muted-foreground"
                  disabled={busy !== null}
                  onClick={() => {
                    setCreatingFolder(true);
                    setNewFolderName("");
                  }}
                  size="sm"
                  title={messages.nodeDetail.newFolderIn.replace(
                    "{folder}",
                    selectedFolder || messages.nodeDetail.driveRoot,
                  )}
                  type="button"
                  variant="ghost"
                >
                  <FolderPlus aria-hidden className="size-3.5" />
                  <span className="truncate">
                    {messages.nodeDetail.newFolderIn.replace(
                      "{folder}",
                      selectedFolder
                        ? fileTreeFileName(selectedFolder)
                        : messages.nodeDetail.driveRoot,
                    )}
                  </span>
                </Button>
              ) : (
                <div className="space-y-1.5 rounded-md border border-border/60 bg-muted/20 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="font-medium text-sm">{messages.nodeDetail.newFolder}</div>
                    <Button
                      aria-label={messages.nodeDetail.cancelNewFolder}
                      className="size-7 text-muted-foreground"
                      disabled={busy !== null}
                      onClick={() => {
                        setCreatingFolder(false);
                        setNewFolderName("");
                      }}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <X aria-hidden className="size-3.5" />
                    </Button>
                  </div>
                  <div>
                    <div className="text-muted-foreground text-xs">
                      {messages.nodeDetail.parentFolder}
                    </div>
                    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1 text-xs">
                      <FolderTree aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                      <span>{messages.nodeDetail.driveRoot}</span>
                      {selectedFolderBreadcrumbs.map(({ path, segment }) => (
                        <span className="inline-flex min-w-0 items-center gap-1" key={path}>
                          <ChevronRight
                            aria-hidden
                            className="size-3 shrink-0 text-muted-foreground"
                          />
                          <span className="max-w-40 truncate font-medium">{segment}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                  <Label htmlFor="file-tree-new-folder-name">
                    {messages.nodeDetail.newFolderName}
                  </Label>
                  <Input
                    aria-describedby="file-tree-new-folder-help"
                    autoFocus
                    className="h-9"
                    disabled={busy !== null}
                    id="file-tree-new-folder-name"
                    onChange={(event) => setNewFolderName(event.target.value)}
                    placeholder={messages.nodeDetail.newFolderPlaceholder}
                    value={newFolderName}
                  />
                  <p className="text-muted-foreground text-xs" id="file-tree-new-folder-help">
                    {messages.nodeDetail.newFolderInside.replace(
                      "{folder}",
                      selectedFolder || messages.nodeDetail.driveRoot,
                    )}
                  </p>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <Label>{messages.nodeDetail.files}</Label>
                <span className="text-muted-foreground text-xs tabular-nums">{files.length}</span>
              </div>
              <div className="max-h-56 overflow-y-auto rounded-md border border-border/60">
                <ul className="divide-y divide-border/50">
                  {files.map((file, index) => (
                    <li
                      className="flex min-h-11 items-center gap-3 px-3 py-2"
                      key={`${file.name}:${file.size}:${index}`}
                    >
                      <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">{file.name}</div>
                        <div className="text-muted-foreground text-xs">
                          {formatFileTreeBytes(file.size)}
                        </div>
                      </div>
                      <Button
                        aria-label={messages.nodeDetail.removeSelectedFile.replace(
                          "{name}",
                          file.name,
                        )}
                        className="size-8 text-muted-foreground"
                        disabled={busy !== null}
                        onClick={() =>
                          setFiles((current) =>
                            current.filter((_, itemIndex) => itemIndex !== index),
                          )
                        }
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <X aria-hidden className="size-3.5" />
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {problem ? (
              <div
                aria-live="polite"
                className="rounded-md bg-rejected/10 px-3 py-2 text-rejected-strong text-sm dark:text-rejected-soft"
              >
                {problem}
              </div>
            ) : null}
          </div>

          <div className="flex shrink-0 items-center justify-between gap-3 border-border/60 border-t bg-muted/20 px-5 py-3">
            <Button
              className="h-8"
              disabled={busy !== null}
              onClick={() => inputRef.current?.click()}
              size="sm"
              type="button"
              variant="outline"
            >
              <Files aria-hidden className="size-3.5" />
              {messages.nodeDetail.chooseDifferentFiles}
            </Button>
            <SplitSubmitButton
              changeRequestAction={{
                label: messages.nodeDetail.uploadAsChangeRequest,
                loadingLabel: messages.nodeDetail.uploadingFiles,
                isLoading: busy === "changeRequest",
                onSubmit: () => void submit("changeRequest"),
              }}
              disabled={files.length === 0 || invalidPath || Boolean(conflictPath) || duplicatePath}
              dropdownPosition="above"
              hint={messages.common.mergeImmediatelyHint}
              immediateAction={{
                label: messages.nodeDetail.uploadNow,
                loadingLabel: messages.nodeDetail.uploadingFiles,
                isLoading: busy === "immediate",
                onSubmit: () => void submit("immediate"),
              }}
            />
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function FileTreeRenameDialog({
  existingPaths,
  file,
  onOpenChange,
  onSubmit,
  open,
}: {
  existingPaths: Set<string>;
  file: FileTreeFileVO | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (nextName: string, mode: FileTreeMutationMode) => Promise<void>;
  open: boolean;
}) {
  const messages = useCoreI18n();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<FileTreeMutationMode | null>(null);
  const [error, setError] = useState<string | null>(null);
  const currentName = file ? fileTreeFileName(file.path) : "";
  const parent = file ? file.path.split("/").slice(0, -1).join("/") : "";
  const nextPath = file ? fileTreeUploadPath(parent, name) : "";
  const validationError = validateFileTreeName(name) ?? validateFileTreePath(nextPath);
  const conflict = Boolean(file && nextPath !== file.path && existingPaths.has(nextPath));
  const disabled =
    !file || !name.trim() || name.trim() === currentName || Boolean(validationError) || conflict;

  useEffect(() => {
    if (open && file) {
      setName(currentName);
      setError(null);
    }
  }, [currentName, file, open]);

  const close = () => {
    if (busy) return;
    onOpenChange(false);
    setName("");
    setError(null);
  };

  const submit = async (mode: FileTreeMutationMode) => {
    if (disabled) return;
    setBusy(mode);
    setError(null);
    try {
      await onSubmit(name.trim(), mode);
      setBusy(null);
      onOpenChange(false);
      setName("");
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : messages.nodeDetail.fileRenameFailed);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) close();
      }}
      open={open}
    >
      <DialogContent className="p-0 sm:max-w-md">
        <DialogHeader className="border-border/60 border-b px-5 py-4">
          <DialogTitle className="text-base">{messages.nodeDetail.renameFile}</DialogTitle>
          <DialogDescription>{file?.path}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-5 py-4">
          <Label htmlFor="file-tree-rename-name">{messages.nodeDetail.newFileName}</Label>
          <Input
            autoFocus
            className="h-9"
            disabled={busy !== null}
            id="file-tree-rename-name"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !disabled && !busy) void submit("immediate");
            }}
            value={name}
          />
          {conflict || validationError || error ? (
            <p aria-live="polite" className="text-rejected-strong text-sm dark:text-rejected-soft">
              {error ??
                (conflict
                  ? messages.nodeDetail.fileAlreadyExists.replace("{path}", nextPath)
                  : messages.nodeDetail.invalidFileName)}
            </p>
          ) : null}
        </div>
        <div className="flex justify-end border-border/60 border-t bg-muted/20 px-5 py-3">
          <SplitSubmitButton
            changeRequestAction={{
              label: messages.nodeDetail.renameAsChangeRequest,
              loadingLabel: messages.nodeDetail.renamingFile,
              isLoading: busy === "changeRequest",
              onSubmit: () => void submit("changeRequest"),
            }}
            disabled={disabled}
            dropdownPosition="above"
            hint={messages.common.mergeImmediatelyHint}
            immediateAction={{
              label: messages.nodeDetail.renameNow,
              loadingLabel: messages.nodeDetail.renamingFile,
              isLoading: busy === "immediate",
              onSubmit: () => void submit("immediate"),
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function FileTreeRemoveDialog({
  file,
  onOpenChange,
  onSubmit,
  open,
}: {
  file: FileTreeFileVO | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (mode: FileTreeMutationMode) => Promise<void>;
  open: boolean;
}) {
  const messages = useCoreI18n();
  const [busy, setBusy] = useState<FileTreeMutationMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    onOpenChange(false);
    setError(null);
  };

  const submit = async (mode: FileTreeMutationMode) => {
    if (!file) return;
    setBusy(mode);
    setError(null);
    try {
      await onSubmit(mode);
      setBusy(null);
      onOpenChange(false);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : messages.nodeDetail.fileRemoveFailed);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog onOpenChange={(next) => (!next ? close() : onOpenChange(true))} open={open}>
      <DialogContent className="p-0 sm:max-w-md">
        <DialogHeader className="border-border/60 border-b px-5 py-4">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Trash2 aria-hidden className="size-4 text-rejected-strong dark:text-rejected-soft" />
            {messages.nodeDetail.removeFromDrive}
          </DialogTitle>
          <DialogDescription>{file?.path}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 px-5 py-4">
          <p className="text-sm leading-6">{messages.nodeDetail.removeFileDescription}</p>
          <p className="text-muted-foreground text-xs leading-5">
            {messages.nodeDetail.removeFileAssetHint}
          </p>
          {error ? (
            <p aria-live="polite" className="text-rejected-strong text-sm dark:text-rejected-soft">
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-3 border-border/60 border-t bg-muted/20 px-5 py-3">
          <Button disabled={busy !== null} onClick={close} size="sm" type="button" variant="ghost">
            {messages.common.cancel}
          </Button>
          <SplitSubmitButton
            changeRequestAction={{
              label: messages.nodeDetail.removeAsChangeRequest,
              loadingLabel: messages.nodeDetail.removingFile,
              isLoading: busy === "changeRequest",
              onSubmit: () => void submit("changeRequest"),
            }}
            dropdownPosition="above"
            immediateAction={{
              label: messages.nodeDetail.removeNow,
              loadingLabel: messages.nodeDetail.removingFile,
              isLoading: busy === "immediate",
              onSubmit: () => void submit("immediate"),
            }}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
