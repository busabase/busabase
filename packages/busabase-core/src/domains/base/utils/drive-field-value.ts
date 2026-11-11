// Pure, isomorphic helpers for the `drive` field type — no DB, no React, no
// server-only imports, so the server validator, the web editor and the mobile
// editor all run the SAME rules.
//
// A drive cell stores exactly what an `attachment` cell stores (an array of
// asset refs) plus a `path` on each ref, e.g. `contracts/2026/main.pdf`.
// Folders are implied by the paths and never stored on their own — the same
// shape a Drive node uses, so an empty folder exists only while you are about
// to put a file in it. Path rules are the Drive node's (`file-tree-files`).
import {
  fileTreeFileName,
  fileTreeParentPath,
  fileTreeUploadPath,
  normalizeFileTreeFolder,
  validateFileTreePath,
} from "../../dashboard/helpers/file-tree-files";

/** The part of a drive ref these helpers read; every other ref field rides along untouched. */
export interface DriveEntryLike {
  fileName: string;
  path?: unknown;
}

export type DriveEntry<T extends DriveEntryLike = DriveEntryLike> = T & { path: string };

/**
 * Where an entry sits in its cell's tree. A ref without a path — written by an
 * API caller that only knows attachment refs, or by an older client — sits at
 * the root under its file name, so it is never lost or rejected.
 */
export const driveEntryPath = (entry: DriveEntryLike): string =>
  typeof entry.path === "string" && entry.path !== "" ? entry.path : entry.fileName;

export type DrivePathProblem =
  | { reason: "invalid"; path: string }
  | { reason: "duplicate"; path: string }
  | { reason: "fileFolderClash"; path: string };

/**
 * The first path problem in a drive cell, or null when the tree is sound:
 * every path is a valid relative Drive path, no two entries share a path, and
 * no file sits where a folder is implied (`a` and `a/b.pdf` in the same cell).
 */
export const findDrivePathProblem = (
  entries: readonly DriveEntryLike[],
): DrivePathProblem | null => {
  const paths = new Set<string>();
  for (const entry of entries) {
    const path = driveEntryPath(entry);
    if (validateFileTreePath(path) !== null) return { reason: "invalid", path };
    if (paths.has(path)) return { reason: "duplicate", path };
    paths.add(path);
  }
  for (const path of paths) {
    for (const folder of driveAncestorFolders(path)) {
      if (paths.has(folder)) return { reason: "fileFolderClash", path: folder };
    }
  }
  return null;
};

/** `a/b/c.pdf` → [`a`, `a/b`]. */
const driveAncestorFolders = (path: string): string[] => {
  const segments = path.split("/").slice(0, -1);
  return segments.map((_, index) => segments.slice(0, index + 1).join("/"));
};

/** Every folder the cell's paths imply, sorted. */
export const driveFolderPaths = (entries: readonly DriveEntryLike[]): string[] => {
  const folders = new Set<string>();
  for (const entry of entries) {
    for (const folder of driveAncestorFolders(driveEntryPath(entry))) folders.add(folder);
  }
  return [...folders].sort((a, b) => a.localeCompare(b));
};

/**
 * Put `entry` at `path`. A new last segment is a rename, so `fileName` — what
 * grid chips, cards and an `attachment` column show — follows it; a move into
 * another folder keeps the name as it is.
 */
const placeAt = <T extends DriveEntryLike>(entry: T, path: string): DriveEntry<T> => {
  const name = fileTreeFileName(path);
  return name === fileTreeFileName(driveEntryPath(entry))
    ? { ...entry, path }
    : { ...entry, path, fileName: name };
};

/** `report.pdf` taken → `report (2).pdf`, then `report (3).pdf`, … */
const nextFreePath = (path: string, taken: ReadonlySet<string>): string => {
  if (!taken.has(path)) return path;
  const parent = fileTreeParentPath(path);
  const name = fileTreeFileName(path);
  const dot = name.lastIndexOf(".");
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const extension = dot > 0 ? name.slice(dot) : "";
  for (let index = 2; ; index++) {
    const candidate = fileTreeUploadPath(parent, `${stem} (${index})${extension}`);
    if (!taken.has(candidate)) return candidate;
  }
};

/**
 * Give every entry an explicit, unique path. Entries keep their order; an entry
 * whose path is already taken gets `name (2).ext` (and that file name). Used to turn an `attachment`
 * column into a `drive` column (files land at the root) and to normalize a cell
 * before an editor works on it.
 */
export const withDrivePaths = <T extends DriveEntryLike>(
  entries: readonly T[],
): DriveEntry<T>[] => {
  const taken = new Set<string>();
  return entries.map((entry) => {
    const path = nextFreePath(driveEntryPath(entry), taken);
    taken.add(path);
    return placeAt(entry, path);
  });
};

/** Drop the paths — a `drive` column turned back into an `attachment` column. */
export const withoutDrivePaths = <T extends DriveEntryLike>(
  entries: readonly T[],
): Omit<T, "path">[] =>
  entries.map((entry) => {
    const { path: _path, ...rest } = entry;
    return rest;
  });

/**
 * Put freshly uploaded refs into `folder`, after the existing entries. A name
 * already taken in that folder gets `name (2).ext` rather than overwriting the
 * file that is there.
 */
export const addDriveEntries = <T extends DriveEntryLike, U extends DriveEntryLike>(
  entries: readonly T[],
  uploaded: readonly U[],
  folder: string,
): Array<DriveEntry<T> | DriveEntry<U>> => {
  const existing = withDrivePaths(entries);
  const taken = new Set(existing.map((entry) => entry.path));
  const target = normalizeFileTreeFolder(folder);
  const added = uploaded.map((entry) => {
    const path = nextFreePath(fileTreeUploadPath(target, entry.fileName), taken);
    taken.add(path);
    return placeAt(entry, path);
  });
  return [...existing, ...added];
};

export type DriveMoveResult<T extends DriveEntryLike> =
  | { ok: true; entries: DriveEntry<T>[] }
  | { ok: false; reason: "invalid" | "conflict" | "unchanged" | "missing"; path?: string };

/**
 * Rename or move one file to `nextPath` (a new last segment renames it — its
 * `fileName` follows). Refuses (instead of overwriting) when another entry
 * already sits there, so a move never silently drops a file.
 */
export const moveDriveEntry = <T extends DriveEntryLike>(
  entries: readonly T[],
  fromPath: string,
  nextPath: string,
): DriveMoveResult<T> => {
  const current = withDrivePaths(entries);
  if (!current.some((entry) => entry.path === fromPath)) return { ok: false, reason: "missing" };
  if (nextPath === fromPath) return { ok: false, reason: "unchanged" };
  if (validateFileTreePath(nextPath) !== null) {
    return { ok: false, reason: "invalid", path: nextPath };
  }
  const next = current.map((entry) => (entry.path === fromPath ? placeAt(entry, nextPath) : entry));
  const problem = findDrivePathProblem(next);
  if (problem) {
    return {
      ok: false,
      reason: problem.reason === "invalid" ? "invalid" : "conflict",
      path: problem.path,
    };
  }
  return { ok: true, entries: next };
};

/**
 * Rename or move a whole folder: every path under `fromFolder/` moves under
 * `toFolder/` (an empty `toFolder` is the root). Refuses on any collision, and
 * refuses to move a folder into itself.
 */
export const moveDriveFolder = <T extends DriveEntryLike>(
  entries: readonly T[],
  fromFolder: string,
  toFolder: string,
): DriveMoveResult<T> => {
  const from = normalizeFileTreeFolder(fromFolder);
  const to = normalizeFileTreeFolder(toFolder);
  const current = withDrivePaths(entries);
  const prefix = `${from}/`;
  if (!from || !current.some((entry) => entry.path.startsWith(prefix))) {
    return { ok: false, reason: "missing" };
  }
  if (to === from) return { ok: false, reason: "unchanged" };
  if (to.startsWith(prefix)) return { ok: false, reason: "invalid", path: to };
  const next = current.map((entry) =>
    entry.path.startsWith(prefix)
      ? placeAt(entry, fileTreeUploadPath(to, entry.path.slice(prefix.length)))
      : entry,
  );
  const problem = findDrivePathProblem(next);
  if (problem) {
    return {
      ok: false,
      reason: problem.reason === "invalid" ? "invalid" : "conflict",
      path: problem.path,
    };
  }
  return { ok: true, entries: next };
};

/** Remove one file. */
export const removeDriveEntry = <T extends DriveEntryLike>(
  entries: readonly T[],
  path: string,
): DriveEntry<T>[] => withDrivePaths(entries).filter((entry) => entry.path !== path);

/** Remove a folder and everything under it. */
export const removeDriveFolder = <T extends DriveEntryLike>(
  entries: readonly T[],
  folder: string,
): DriveEntry<T>[] => {
  const prefix = `${normalizeFileTreeFolder(folder)}/`;
  return withDrivePaths(entries).filter((entry) => !entry.path.startsWith(prefix));
};

/** How many files sit anywhere under `folder` (the root when empty). */
export const countDriveFolderFiles = (
  entries: readonly DriveEntryLike[],
  folder: string,
): number => {
  const normalized = normalizeFileTreeFolder(folder);
  if (!normalized) return entries.length;
  const prefix = `${normalized}/`;
  return entries.filter((entry) => driveEntryPath(entry).startsWith(prefix)).length;
};
