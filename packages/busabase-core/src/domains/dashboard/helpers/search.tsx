import type { SearchResultKind } from "busabase-contract/types";
import { File, FileText, Folder, GitMerge, NotebookText } from "lucide-react";
import type { ReactNode } from "react";
import { stripHtmlTags } from "./html";

export const normalizeSearchText = (value: string) => value.trim().toLowerCase();

export const searchSnippetText = (value: string) =>
  stripHtmlTags(value)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/(^|\s)#{1,6}\s+/g, "$1")
    .replace(/(^|\s)>\s+/g, "$1")
    .replace(/\*\*|__|~~|`/g, "")
    .replace(/\s+/g, " ")
    .trim();

export const highlightSearchText = (value: string, query: string): ReactNode => {
  const needle = query.trim();
  if (!needle) return value;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matcher = new RegExp(escaped, "gi");
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const match of value.matchAll(matcher)) {
    const start = match.index;
    if (start > cursor) parts.push(value.slice(cursor, start));
    parts.push(
      <mark className="bg-primary/15 text-inherit" key={`${start}-${match[0]}`}>
        {match[0]}
      </mark>,
    );
    cursor = start + match[0].length;
  }
  if (cursor < value.length) parts.push(value.slice(cursor));
  return parts;
};

export const searchKindIcon: Record<SearchResultKind, ReactNode> = {
  base: <Folder className="size-4" />,
  change_request: <GitMerge className="size-4" />,
  file: <File className="size-4" />,
  record: <FileText className="size-4" />,
  // A content match inside a doc/html/whiteboard/workflow node.
  node: <NotebookText className="size-4" />,
};

export const isConflictErrorMessage = (message: string) =>
  /conflict|conflicting field|changed since this change request/i.test(message);
