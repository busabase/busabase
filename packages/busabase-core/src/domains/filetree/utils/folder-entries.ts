import type { FileTreeEntriesVO, FileTreeFileVO } from "busabase-contract/types";

/**
 * Split an in-memory file list into one folder's direct subfolders and files —
 * the same shape `fileTrees.listEntries` returns from the database.
 *
 * Used where the whole list is already in hand (the demo router, and small
 * nodes whose detail arrived complete), so both paths render identically.
 */
export const folderEntriesFromFiles = (
  files: readonly FileTreeFileVO[],
  folder: string,
): FileTreeEntriesVO => {
  const prefix = folder === "" ? "" : `${folder}/`;
  const folderNames = new Set<string>();
  const direct: FileTreeFileVO[] = [];
  for (const file of files) {
    if (!file.path.startsWith(prefix)) continue;
    const rest = file.path.slice(prefix.length);
    const slash = rest.indexOf("/");
    if (slash === -1) direct.push(file);
    else folderNames.add(rest.slice(0, slash));
  }
  return {
    folder,
    folders: [...folderNames].sort().map((name) => ({ name, path: `${prefix}${name}` })),
    foldersTruncated: false,
    // Every folder is already in hand, so there is never a next page.
    foldersNextCursor: null,
    files: direct.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
    nextCursor: null,
  };
};
