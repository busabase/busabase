import type { FileTreeFileVO } from "busabase-contract/types";
import {
  fileTreeFileName,
  fileTreeParentPath,
  fileTreeUploadPath,
  inferFileTreeMimeType,
  validateFileTreeName,
} from "./file-tree-files";

export type FileTreeSelectionKind = "file" | "folder";
export type FileTreeSelectionKey = `${FileTreeSelectionKind}:${string}`;

export interface FileTreeCreateOperation {
  kind: "create";
  path: string;
  assetId: string;
  displayName?: string;
  mimeType?: string;
}

export interface FileTreeDeleteOperation {
  kind: "delete";
  path: string;
  baseContentHash?: string;
}

export type FileTreeBulkOperation = FileTreeCreateOperation | FileTreeDeleteOperation;

export interface FileTreeFolderRenamePlan {
  currentFolderPath: string;
  nextFolderPath: string;
  sourcePaths: string[];
  targetPaths: string[];
  operations: FileTreeBulkOperation[];
}

export type FileTreeFolderRenameResult =
  | { ok: true; plan: FileTreeFolderRenamePlan }
  | { ok: false; reason: "empty" | "invalidName" | "sameName" | "collision"; paths: string[] };

export const fileTreeSelectionKey = (
  kind: FileTreeSelectionKind,
  path: string,
): FileTreeSelectionKey => `${kind}:${path}`;

export const parseFileTreeSelectionKey = (
  key: FileTreeSelectionKey,
): { kind: FileTreeSelectionKind; path: string } => {
  const separator = key.indexOf(":");
  return {
    kind: key.slice(0, separator) as FileTreeSelectionKind,
    path: key.slice(separator + 1),
  };
};

const pathBelongsToFolder = (path: string, folderPath: string): boolean =>
  path.startsWith(`${folderPath}/`);

/**
 * Expands selected folders into descendant files while keeping the source file
 * order. A Set at the output boundary makes a selected folder plus one of its
 * selected children resolve to one operation and one ZIP entry.
 */
export const resolveFileTreeSelectedPaths = (
  selection: ReadonlySet<FileTreeSelectionKey>,
  files: ReadonlyArray<Pick<FileTreeFileVO, "path">>,
): string[] => {
  const selectedFiles = new Set<string>();
  const selectedFolders: string[] = [];
  for (const key of selection) {
    const selected = parseFileTreeSelectionKey(key);
    if (selected.kind === "file") selectedFiles.add(selected.path);
    else selectedFolders.push(selected.path);
  }

  const resolved = new Set<string>();
  for (const file of files) {
    if (
      selectedFiles.has(file.path) ||
      selectedFolders.some((folderPath) => pathBelongsToFolder(file.path, folderPath))
    ) {
      resolved.add(file.path);
    }
  }
  return [...resolved];
};

export const buildFileTreeFolderRenamePlan = ({
  contentHashes = new Map<string, string>(),
  existingPaths,
  files,
  folderPath,
  nextName,
}: {
  contentHashes?: ReadonlyMap<string, string>;
  existingPaths: ReadonlySet<string>;
  files: ReadonlyArray<Pick<FileTreeFileVO, "assetId" | "displayName" | "mimeType" | "path">>;
  folderPath: string;
  nextName: string;
}): FileTreeFolderRenameResult => {
  const trimmedName = nextName.trim();
  if (validateFileTreeName(trimmedName)) {
    return { ok: false, reason: "invalidName", paths: [] };
  }

  const currentName = fileTreeFileName(folderPath);
  if (trimmedName === currentName) {
    return { ok: false, reason: "sameName", paths: [] };
  }

  const sourceFiles = files.filter((file) => pathBelongsToFolder(file.path, folderPath));
  if (sourceFiles.length === 0) {
    return { ok: false, reason: "empty", paths: [] };
  }

  const nextFolderPath = fileTreeUploadPath(fileTreeParentPath(folderPath), trimmedName);
  const sourcePaths = sourceFiles.map((file) => file.path);
  const sourcePathSet = new Set(sourcePaths);
  const targetPaths = sourceFiles.map((file) =>
    fileTreeUploadPath(nextFolderPath, file.path.slice(folderPath.length + 1)),
  );
  const conflicts = targetPaths.filter(
    (path) => existingPaths.has(path) && !sourcePathSet.has(path),
  );
  if (conflicts.length > 0) {
    return { ok: false, reason: "collision", paths: conflicts };
  }

  const createOperations: FileTreeCreateOperation[] = sourceFiles.map((file, index) => ({
    kind: "create",
    path: targetPaths[index] as string,
    assetId: file.assetId,
    displayName: file.displayName ?? fileTreeFileName(file.path),
    mimeType: inferFileTreeMimeType(targetPaths[index] as string, file.mimeType),
  }));
  const deleteOperations: FileTreeDeleteOperation[] = sourceFiles.map((file) => ({
    kind: "delete",
    path: file.path,
    ...(contentHashes.get(file.path) ? { baseContentHash: contentHashes.get(file.path) } : {}),
  }));

  return {
    ok: true,
    plan: {
      currentFolderPath: folderPath,
      nextFolderPath,
      sourcePaths,
      targetPaths,
      operations: [...createOperations, ...deleteOperations],
    },
  };
};

/** ZIP entries always use relative Drive paths and retain nested directories. */
export const fileTreeZipEntryPath = (path: string): string =>
  path
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .split("/")
    .filter((segment) => segment && segment !== "." && segment !== "..")
    .join("/");
