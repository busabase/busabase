// Pure logic behind the mobile `drive` field editor (RecordDriveField). The
// path rules themselves are NOT here — they live in busabase-core's
// `drive-field-value`, shared with the server validator and the web editor.
// This module only adapts them to what the phone shows: the Drive node's own
// folder list (`FileTreeList`), a folder the user is standing in, and the
// messages a refused change turns into.
import type { AssetAttachmentRef, FileTreeFileVO } from "busabase-contract/types";
import {
  countDriveFolderFiles,
  type DriveEntry,
  type DriveMoveResult,
  moveDriveEntry,
  moveDriveFolder,
  removeDriveFolder,
} from "busabase-core/base/drive-field-value";
import {
  fileTreeFileName,
  fileTreeParentPath,
  fileTreeUploadPath,
  normalizeFileTreeFolder,
  validateFileTreeName,
  validateFileTreePath,
} from "busabase-core/dashboard/file-tree-files";
import type { FileTreeListItem } from "~/domains/knowledge/types/file-tree";
import {
  buildFileTreeListItems,
  buildFolderListItem,
  getFolderForFile,
  sortFilesForMobile,
} from "~/domains/knowledge/utils/file-tree";
import { type CoreMessages, fmt } from "~/i18n/messages";

export type DriveRef = DriveEntry<AssetAttachmentRef>;

/** What the editor holds: the cell's files and the folder being viewed ("" = root). */
export interface DriveView {
  entries: DriveRef[];
  folder: string;
}

export type DriveEditFailure =
  | "invalid"
  | "conflict"
  | "missing"
  | "intoItself"
  | "tooLong"
  | "fileExists";

/**
 * The outcome of one organising step. `unchanged` is its own branch — nothing
 * to save and nothing to complain about, the sheet just closes.
 */
export type DriveEditResult =
  | { ok: true; view: DriveView }
  | { ok: "unchanged" }
  | { ok: false; reason: DriveEditFailure; path?: string };

/** A drive entry as the Drive node's file list sees a file. */
export const toDriveListFile = (entry: DriveRef): FileTreeFileVO => ({
  path: entry.path,
  name: fileTreeFileName(entry.path),
  size: entry.size,
  updatedAt: null,
  mimeType: entry.mimeType || null,
  assetId: entry.assetId ?? entry.attachmentId,
  displayName: null,
});

/** `a/b/c` → [`a`, `a/b`, `a/b/c`]. */
const folderChain = (folder: string): string[] => {
  const segments = normalizeFileTreeFolder(folder).split("/").filter(Boolean);
  return segments.map((_, index) => segments.slice(0, index + 1).join("/"));
};

/**
 * Every row the editor can list: the files, the folders their paths imply, and
 * the folder being viewed with its parents. That last one matters for a NEW
 * folder, which no path implies yet — exactly like a Drive node, it exists only
 * while you are in it about to add a file, and is gone once you leave it empty.
 */
export const buildDriveListItems = (view: DriveView): FileTreeListItem[] => {
  const items = buildFileTreeListItems(view.entries.map(toDriveListFile));
  const folders = new Set(items.filter((item) => item.type === "folder").map((item) => item.path));
  for (const folder of folderChain(view.folder)) {
    if (!folders.has(folder)) items.push(buildFolderListItem(folder));
  }
  return items;
};

/** The rows listed inside `folder`, folders first — the Drive screen's own order. */
export const listDriveFolder = (items: FileTreeListItem[], folder: string): FileTreeListItem[] =>
  sortFilesForMobile(
    items.filter((item) => getFolderForFile(item) === folder),
    folder,
  );

/** True while the viewed folder holds no file, so it would vanish on leaving. */
export const isPendingDriveFolder = (view: DriveView): boolean =>
  view.folder !== "" && countDriveFolderFiles(view.entries, view.folder) === 0;

/** Where the viewer ends up after `from` moved to `to`: carried along if it was inside. */
const followFolder = (current: string, from: string, to: string): string => {
  if (current === from) return to;
  if (current.startsWith(`${from}/`)) return fileTreeUploadPath(to, current.slice(from.length + 1));
  return current;
};

const fromMoveResult = (
  result: DriveMoveResult<AssetAttachmentRef>,
  folder: string,
): DriveEditResult => {
  if (result.ok) return { ok: true, view: { entries: result.entries, folder } };
  if (result.reason === "unchanged") return { ok: "unchanged" };
  return { ok: false, reason: result.reason, path: result.path };
};

/** Rename or move one file by editing its full path. */
export const renameDriveFile = (
  view: DriveView,
  fromPath: string,
  input: string,
): DriveEditResult =>
  fromMoveResult(
    moveDriveEntry(view.entries, fromPath, normalizeFileTreeFolder(input)),
    view.folder,
  );

/**
 * Rename or move a folder by editing its path; everything inside moves with it.
 * An empty `input` moves the contents to the root. A folder that holds no file
 * yet (one just created) has nothing to move — only the viewer's place changes.
 */
export const renameDriveFolder = (
  view: DriveView,
  fromFolder: string,
  input: string,
): DriveEditResult => {
  const from = normalizeFileTreeFolder(fromFolder);
  const to = normalizeFileTreeFolder(input);
  if (to === from) return { ok: "unchanged" };
  if (to.startsWith(`${from}/`)) return { ok: false, reason: "intoItself", path: to };
  if (countDriveFolderFiles(view.entries, from) > 0) {
    return fromMoveResult(
      moveDriveFolder(view.entries, from, to),
      followFolder(view.folder, from, to),
    );
  }
  if (validateFileTreePath(to) !== null) return { ok: false, reason: "invalid", path: to };
  const blocker = view.entries.find(
    (entry) => entry.path === to || to.startsWith(`${entry.path}/`),
  );
  if (blocker) return { ok: false, reason: "conflict", path: blocker.path };
  return { ok: true, view: { entries: view.entries, folder: followFolder(view.folder, from, to) } };
};

/** Remove a folder and every file in it; a viewer inside it steps out to its parent. */
export const deleteDriveFolder = (view: DriveView, folder: string): DriveView => {
  const target = normalizeFileTreeFolder(folder);
  const inside = view.folder === target || view.folder.startsWith(`${target}/`);
  return {
    entries: removeDriveFolder(view.entries, target),
    folder: inside ? fileTreeParentPath(target) : view.folder,
  };
};

/**
 * Open a new folder named `name` inside the viewed one. Nothing is written —
 * the folder becomes real when a file lands in it. An existing folder of that
 * name is simply opened.
 */
export const createDriveFolder = (view: DriveView, name: string): DriveEditResult => {
  const problem = validateFileTreeName(name);
  if (problem === "tooLong") return { ok: false, reason: "tooLong" };
  if (problem) return { ok: false, reason: "invalid" };
  const path = fileTreeUploadPath(view.folder, name.trim());
  if (view.entries.some((entry) => entry.path === path)) {
    return { ok: false, reason: "fileExists", path };
  }
  return { ok: true, view: { entries: view.entries, folder: path } };
};

/** "1 file" / "3 files" in the user's language. */
export const formatDriveFileCount = (count: number, messages: CoreMessages["driveField"]) =>
  count === 1 ? messages.fileCountOne : fmt(messages.fileCount, { count });

/** The sentence a refused change shows under its input. */
export const describeDriveEditFailure = (
  failure: { reason: DriveEditFailure; path?: string },
  messages: CoreMessages["driveField"],
): string => {
  switch (failure.reason) {
    case "invalid":
      // No path means a folder NAME was refused; an empty path, an empty input.
      if (failure.path === undefined) return messages.invalidName;
      return failure.path
        ? fmt(messages.invalidPath, { path: failure.path })
        : messages.pathRequired;
    case "conflict":
      return fmt(messages.pathTaken, { path: failure.path ?? "" });
    case "intoItself":
      return messages.intoItself;
    case "tooLong":
      return messages.nameTooLong;
    case "fileExists":
      return messages.fileExists;
    case "missing":
      return messages.missing;
  }
};
