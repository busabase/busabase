import type { SearchResultKind } from "busabase-contract/types";
import { File, FileText, Folder, GitMerge } from "lucide-react";
import type { ReactNode } from "react";

export const normalizeSearchText = (value: string) => value.trim().toLowerCase();

export const searchKindIcon: Record<SearchResultKind, ReactNode> = {
  base: <Folder className="size-4" />,
  change_request: <GitMerge className="size-4" />,
  file: <File className="size-4" />,
  record: <FileText className="size-4" />,
};

export const isConflictErrorMessage = (message: string) =>
  /conflict|conflicting field|changed since this change request/i.test(message);
