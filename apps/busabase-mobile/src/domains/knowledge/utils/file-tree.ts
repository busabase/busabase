import type { FileTreeFileVO, FileTreeNodeVO } from "busabase-contract/types";
import { getAttachmentKindLabel } from "~/lib/attachment";
import type { FileTreeListItem, FileTreeVisibility, MetadataDraft } from "../types/file-tree";

const fileKindByExtension: Record<string, string> = {
  css: "CSS",
  env: "Environment",
  js: "JavaScript",
  json: "JSON",
  jsx: "React",
  md: "Markdown",
  mdx: "MDX",
  ts: "TypeScript",
  tsx: "React",
  txt: "Text file",
  yaml: "YAML",
  yml: "YAML",
};

export const visibilityOptions: Array<{ value: FileTreeVisibility; label: string }> = [
  { value: "private", label: "Private" },
  { value: "workspace", label: "Workspace" },
  { value: "public", label: "Public" },
];

const getExtension = (path: string) => {
  const fileName = path.split("/").filter(Boolean).at(-1) ?? path;
  const extension = fileName.includes(".") ? fileName.split(".").pop() : "";
  return extension?.toLowerCase() ?? "";
};

const getFileKindLabel = (file: FileTreeFileVO) => {
  const extension = getExtension(file.name || file.path);
  return (
    fileKindByExtension[extension] ?? getAttachmentKindLabel({ fileName: file.name || file.path })
  );
};

export const formatFileSubtitle = (file: FileTreeFileVO) => {
  const kind = getFileKindLabel(file);
  if (!file.updatedAt) {
    return kind;
  }
  const date = new Date(file.updatedAt);
  if (Number.isNaN(date.getTime())) {
    return kind;
  }
  const updated = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(
    date,
  );
  return `${kind} · ${updated}`;
};

export const formatItemCount = (count: number) => `${count} item${count === 1 ? "" : "s"}`;

const countLines = (value: string) => (value.length === 0 ? 0 : value.split(/\r\n|\r|\n/).length);

const countCharacters = (value: string) => Array.from(value).length;

export const formatCount = (value: number, singular: string, plural = `${singular}s`) =>
  `${value.toLocaleString()} ${value === 1 ? singular : plural}`;

const formatSignedCount = (value: number, singular: string, plural = `${singular}s`) => {
  const label = Math.abs(value) === 1 ? singular : plural;
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toLocaleString()} ${label}`;
};

export const formatTextStats = (value: string) =>
  `${formatCount(countLines(value), "line")} · ${formatCount(countCharacters(value), "character")}`;

export const formatTextChangeSummary = (before: string, after: string) => {
  const lineDelta = countLines(after) - countLines(before);
  const characterDelta = countCharacters(after) - countCharacters(before);

  if (lineDelta === 0 && characterDelta === 0) {
    return "No changes";
  }

  return `${formatSignedCount(lineDelta, "line")} · ${formatSignedCount(
    characterDelta,
    "character",
  )}`;
};

export const resolveMessage = (message: string, fallback: string) => message.trim() || fallback;

export const getVisibilityLabel = (visibility: FileTreeVisibility) =>
  visibilityOptions.find((option) => option.value === visibility)?.label ?? visibility;

export const metadataChanged = (fileTree: FileTreeNodeVO | null, draft: MetadataDraft | null) =>
  !!fileTree &&
  !!draft &&
  (draft.entryFile.trim() !== fileTree.entryFile ||
    draft.version.trim() !== fileTree.version ||
    draft.visibility !== fileTree.visibility);

const getParentPath = (path: string) => {
  const parts = path.split("/");
  if (parts.length <= 1) {
    return "Root";
  }
  return parts.slice(0, -1).join("/");
};

export const normalizeFolderPath = (path: string) => path.replace(/^\/+|\/+$/g, "");

export const getFolderForFile = (file: FileTreeListItem) => {
  if (file.type === "folder") {
    return normalizeFolderPath(file.path);
  }
  return getParentPath(file.path) === "Root" ? "" : normalizeFolderPath(getParentPath(file.path));
};

export const getDisplayName = (file: FileTreeListItem, currentFolder: string) => {
  const prefix = currentFolder ? `${currentFolder}/` : "";
  const relativePath = file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.path;
  return file.name || relativePath.split("/").filter(Boolean).at(-1) || file.path;
};

export const getParentFolder = (folderPath: string) => {
  const parts = normalizeFolderPath(folderPath).split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
};

export const getFolderItemCount = (files: FileTreeListItem[], folderPath: string) =>
  files.filter((file) => getFolderForFile(file) === normalizeFolderPath(folderPath)).length;

export const sortFilesForMobile = (files: FileTreeListItem[], currentFolder: string) =>
  [...files].sort((left, right) => {
    if (left.type !== right.type) {
      return left.type === "folder" ? -1 : 1;
    }
    return getDisplayName(left, currentFolder).localeCompare(
      getDisplayName(right, currentFolder),
      undefined,
      { numeric: true, sensitivity: "base" },
    );
  });

export const buildFileTreeListItems = (files: FileTreeFileVO[]): FileTreeListItem[] => {
  const folders = new Map<string, FileTreeListItem>();
  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    for (let index = 1; index < parts.length; index++) {
      const folderPath = parts.slice(0, index).join("/");
      if (!folders.has(folderPath)) {
        folders.set(folderPath, {
          path: folderPath,
          name: parts[index - 1] ?? folderPath,
          type: "folder",
          size: 0,
          updatedAt: null,
          mimeType: null,
          assetId: null,
          displayName: null,
        });
      }
    }
  }
  return [...folders.values(), ...files.map((file) => ({ ...file, type: "file" as const }))];
};
