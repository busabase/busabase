"use client";

// Shared file-tree browsing building blocks — extracted out of node-detail-views.tsx
// so any file-tree-backed node type (skill/drive/airapp/…) can reuse the same
// delete dialog, tree builder, and tree renderer instead of duplicating them.
// `FileTreeDetailView` (node-detail-views.tsx) and `AirAppDetailView`
// (../../airapp/components/AirAppDetailView.tsx) both build on top of this module.
//
// `DriveFileTree`/`DriveFileTreeFolder`/`DriveFileTreeFile` below are a
// deliberately independent reimplementation of `kui/ai-elements/file-tree` —
// that kui component hardcodes its row/icon/indentation styling with no
// className override hooks and doesn't export its context, so there was no
// way to reskin it without either modifying the protected `packages/kui`
// (out of bounds without explicit sign-off) or duplicating the expand/select
// state machine here. This is that duplication, done once, on purpose.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { FileTreeNodeVO } from "busabase-contract/types";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "kui/collapsible";
import { cn } from "kui/utils";
import {
  ChevronRightIcon,
  Database,
  FileCode,
  FileCog,
  FileIcon,
  FileJson,
  FileTerminal,
  FileText,
  FolderIcon,
  FolderOpenIcon,
  type LucideIcon,
  Paintbrush,
} from "lucide-react";
import {
  type CSSProperties,
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
import { useLocation, useSearch } from "wouter";
import { fmt, useCoreI18n } from "../../../i18n";
import { mergeSearchIntoHref } from "../helpers/link-search";
import { useIsAnonymousVisitor } from "../visitor-context";
import type { SkillCodeLanguage } from "./field-preview";
import { ConfirmActionDialog } from "./primitives";

/**
 * The confirm-and-archive half of the delete flow, with no trigger of its own —
 * the caller owns `open`. Delete used to be a standalone toolbar button sitting
 * next to the "•••" menu; it now lives as an item *inside* that menu
 * (`NodeActionsMenu`, and the sidebar row's equivalent in `dashboard-shell.tsx`),
 * so the trigger and the dialog were separated and only this half remains here.
 * Every entry point drives this one implementation, which is what keeps the
 * confirm copy, the folder cascade warning, and the CR-approve-merge sequence
 * from drifting apart.
 *
 * Creates a `node_delete` change request and approve-merges it (soft-archive →
 * recoverable from Trash). Folders warn about the cascade (their subtree is
 * archived in one batch). `mergeNodeDelete` already special-cases
 * `node.type === "base"` (archives the base + its records in lockstep), so this
 * works unchanged with `nodeType="base"`.
 */
export function NodeDeleteDialog({
  orpc,
  nodeId,
  nodeType,
  nodeName,
  childCount = 0,
  open,
  onOpenChange,
  onDeleted,
  navigateHome = true,
}: {
  orpc: BusabaseQueryUtils;
  nodeId: string;
  nodeType: string;
  nodeName: string;
  childCount?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional hook fired right after a successful delete (e.g. so an
   *  airapp node can tear down its live Nodepod runner instead of leaking
   *  it). No-op for node types that don't pass it. */
  onDeleted?: () => void;
  /**
   * Navigate to the workbench root after a successful delete. Correct for a
   * detail page (you just archived the very node you were looking at, so the
   * route no longer resolves), but wrong for the sidebar, where deleting some
   * OTHER node must not yank you off the page you're working on — that caller
   * passes `false` unless the deleted node is the one currently open.
   */
  navigateHome?: boolean;
}) {
  const messages = useCoreI18n();
  const [, rawSetLocation] = useLocation();
  const currentSearch = useSearch();
  const setLocation = (to: string) => rawSetLocation(mergeSearchIntoHref(to, currentSearch));
  const queryClient = useQueryClient();
  const createCr = useMutation(orpc.nodes.createChangeRequest.mutationOptions());
  const reviewCr = useMutation(orpc.changeRequests.review.mutationOptions());
  const mergeCr = useMutation(orpc.changeRequests.merge.mutationOptions());
  const pending = createCr.isPending || reviewCr.isPending || mergeCr.isPending;
  // Deleting a node is manage-only; a public read-only visitor never sees it.
  // Self-gating here covers every mount. All hooks run first.
  const isAnon = useIsAnonymousVisitor();
  if (isAnon) {
    return null;
  }
  const nodeTypeLabels: Record<string, string> = {
    doc: messages.nodeDetail.doc,
    file: messages.nodeDetail.file,
    folder: messages.nodeDetail.folder,
    drive: messages.nodeDetail.drive,
    skill: messages.nodeDetail.skill,
    base: messages.nodeDetail.base,
  };
  const label = nodeTypeLabels[nodeType] ?? `${nodeType[0]?.toUpperCase()}${nodeType.slice(1)}`;
  const body =
    nodeType === "folder" && childCount > 0
      ? fmt(messages.nodeDetail.deleteFolderBody, {
          count: childCount,
          name: nodeName,
          plural: childCount === 1 ? "" : "s",
        })
      : fmt(messages.nodeDetail.deleteBody, { name: nodeName });

  const handleConfirm = async () => {
    try {
      const cr = await createCr.mutateAsync({ operations: [{ kind: "delete", nodeId }] });
      await reviewCr.mutateAsync({ changeRequestIds: [cr.id], verdict: "approved" });
      await mergeCr.mutateAsync({ changeRequestIds: [cr.id] });
      await queryClient.invalidateQueries({
        queryKey: orpc.nodes.list.queryOptions({}).queryKey,
      });
      await queryClient.invalidateQueries({
        queryKey: orpc.nodes.list.queryOptions({ input: { status: "archived" } }).queryKey,
      });
      toast.success(fmt(messages.nodeDetail.movedToTrash, { type: label }));
      onOpenChange(false);
      if (navigateHome) setLocation("/");
      onDeleted?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : fmt(messages.nodeDetail.failedDelete, { type: label }),
      );
      onOpenChange(false);
    }
  };

  return (
    <ConfirmActionDialog
      body={body}
      confirmLabel={messages.nodeDetail.moveToTrash}
      onCancel={() => onOpenChange(false)}
      onConfirm={handleConfirm}
      open={open}
      pending={pending}
      title={fmt(messages.nodeDetail.deleteTitle, { type: label })}
    />
  );
}

export interface SkillTreeNode {
  name: string;
  path: string;
  type: "file" | "folder";
  children: SkillTreeNode[];
}

// Build a nested tree from the file-tree node's flat file list, synthesizing any parent
// folders that have no explicit entry. Folders sort before files, then by name.
export function buildFileTree(files: FileTreeNodeVO["files"]): SkillTreeNode[] {
  const roots: SkillTreeNode[] = [];
  const byPath = new Map<string, SkillTreeNode>();
  const ensureDir = (dirPath: string): SkillTreeNode[] => {
    if (!dirPath) {
      return roots;
    }
    const existing = byPath.get(dirPath);
    if (existing) {
      return existing.children;
    }
    const segments = dirPath.split("/");
    const node: SkillTreeNode = {
      name: segments[segments.length - 1] ?? dirPath,
      path: dirPath,
      type: "folder",
      children: [],
    };
    byPath.set(dirPath, node);
    ensureDir(segments.slice(0, -1).join("/")).push(node);
    return node.children;
  };
  for (const file of files) {
    const segments = file.path.split("/");
    const name = segments[segments.length - 1] ?? file.path;
    const parentPath = segments.slice(0, -1).join("/");
    ensureDir(parentPath).push({ name, path: file.path, type: "file", children: [] });
  }
  const sortNodes = (nodes: SkillTreeNode[]) => {
    nodes.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === "folder" ? -1 : 1,
    );
    for (const node of nodes) {
      sortNodes(node.children);
    }
  };
  sortNodes(roots);
  return roots;
}

export const collectFolderPaths = (nodes: SkillTreeNode[]): string[] =>
  nodes.flatMap((node) =>
    node.type === "folder" ? [node.path, ...collectFolderPaths(node.children)] : [],
  );

export const FILE_TREE_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  json: "json",
  md: "markdown",
  mdx: "markdown",
  py: "python",
  sh: "bash",
  bash: "bash",
  yml: "yaml",
  yaml: "yaml",
  css: "css",
  html: "html",
  sql: "sql",
  toml: "toml",
};

export const guessFileTreeLanguage = (path: string): SkillCodeLanguage => {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return (FILE_TREE_LANGUAGE_BY_EXTENSION[ext] ?? "text") as SkillCodeLanguage;
};

// Glyph only, never color — `DriveFileTreeFile` always renders these in the
// same neutral text-muted-foreground/text-foreground tokens as everything
// else in the tree, so recognizability doesn't cost the tree's flat,
// non-rainbow look.
const FILE_TREE_ICON_BY_EXTENSION: Record<string, LucideIcon> = {
  bash: FileTerminal,
  css: Paintbrush,
  html: FileCode,
  js: FileCode,
  json: FileJson,
  jsx: FileCode,
  md: FileText,
  mdx: FileText,
  py: FileCode,
  sh: FileTerminal,
  sql: Database,
  toml: FileCog,
  ts: FileCode,
  tsx: FileCode,
  yaml: FileCog,
  yml: FileCog,
};

const guessFileTreeIcon = (path: string): LucideIcon => {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return FILE_TREE_ICON_BY_EXTENSION[ext] ?? FileIcon;
};

export function renderFileTree(nodes: SkillTreeNode[], depth = 0): ReactNode {
  return nodes.map((node) =>
    node.type === "folder" ? (
      <DriveFileTreeFolder depth={depth} key={node.path} name={node.name} path={node.path}>
        {renderFileTree(node.children, depth + 1)}
      </DriveFileTreeFolder>
    ) : (
      <DriveFileTreeFile depth={depth} key={node.path} name={node.name} path={node.path} />
    ),
  );
}

interface DriveFileTreeContextType {
  expandedPaths: Set<string>;
  togglePath: (path: string) => void;
  selectedPath?: string;
  onSelect?: (path: string) => void;
}

// oxlint-disable-next-line eslint(no-empty-function)
const noopTogglePath = () => {};

const DriveFileTreeContext = createContext<DriveFileTreeContextType>({
  // oxlint-disable-next-line eslint-plugin-unicorn(no-new-builtin)
  expandedPaths: new Set(),
  togglePath: noopTogglePath,
});

export interface DriveFileTreeProps {
  className?: string;
  expanded?: Set<string>;
  defaultExpanded?: Set<string>;
  selectedPath?: string;
  onSelect?: (path: string) => void;
  onExpandedChange?: (expanded: Set<string>) => void;
  children?: ReactNode;
}

/** Root tree container + expand-state provider. See the module doc comment above
 *  for why this doesn't reuse `kui/ai-elements/file-tree`'s `FileTree`. */
export function DriveFileTree({
  expanded: controlledExpanded,
  defaultExpanded,
  selectedPath,
  onSelect,
  onExpandedChange,
  className,
  children,
}: DriveFileTreeProps) {
  const [internalExpanded, setInternalExpanded] = useState(
    () => defaultExpanded ?? new Set<string>(),
  );
  const expandedPaths = controlledExpanded ?? internalExpanded;

  const togglePath = useCallback(
    (path: string) => {
      const next = new Set(expandedPaths);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      setInternalExpanded(next);
      onExpandedChange?.(next);
    },
    [expandedPaths, onExpandedChange],
  );

  const contextValue = useMemo(
    () => ({ expandedPaths, onSelect, selectedPath, togglePath }),
    [expandedPaths, onSelect, selectedPath, togglePath],
  );

  return (
    <DriveFileTreeContext.Provider value={contextValue}>
      <div
        className={cn("rounded-lg border bg-background font-mono text-sm", className)}
        role="tree"
      >
        <div className="p-2">{children}</div>
      </div>
    </DriveFileTreeContext.Provider>
  );
}

// Depth-based left padding instead of nesting each level in its own
// `ml-4 border-l pl-2` wrapper (kui's approach) — a deeply nested tree used
// to draw one vertical guide line per level, which got noisy fast. A flat
// per-row inline padding keeps the indentation without the extra rules.
const driveFileTreeRowStyle = (depth: number): CSSProperties => ({
  paddingLeft: 8 + depth * 14,
});

export interface DriveFileTreeFolderProps {
  path: string;
  name: string;
  depth?: number;
  children?: ReactNode;
}

export function DriveFileTreeFolder({ path, name, depth = 0, children }: DriveFileTreeFolderProps) {
  const { expandedPaths, togglePath, selectedPath, onSelect } = useContext(DriveFileTreeContext);
  const isExpanded = expandedPaths.has(path);
  const isSelected = selectedPath === path;
  const FolderGlyph = isExpanded ? FolderOpenIcon : FolderIcon;

  return (
    <Collapsible onOpenChange={() => togglePath(path)} open={isExpanded}>
      <div role="treeitem" tabIndex={0}>
        <CollapsibleTrigger asChild>
          <button
            className={cn(
              "flex w-full items-center gap-1.5 rounded px-2 py-1 text-left transition-colors hover:bg-muted/50",
              isSelected && "bg-muted",
            )}
            onClick={() => onSelect?.(path)}
            style={driveFileTreeRowStyle(depth)}
            type="button"
          >
            <ChevronRightIcon
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                isExpanded && "rotate-90",
              )}
            />
            <FolderGlyph
              className={cn(
                "size-4 shrink-0 text-muted-foreground",
                isSelected && "text-foreground",
              )}
            />
            <span className={cn("truncate", isSelected && "font-medium text-foreground")}>
              {name}
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>{children}</CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export interface DriveFileTreeFileProps {
  path: string;
  name: string;
  depth?: number;
}

export function DriveFileTreeFile({ path, name, depth = 0 }: DriveFileTreeFileProps) {
  const { selectedPath, onSelect } = useContext(DriveFileTreeContext);
  const isSelected = selectedPath === path;
  const FileGlyph = guessFileTreeIcon(path);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        onSelect?.(path);
      }
    },
    [onSelect, path],
  );

  return (
    <div
      className={cn(
        "flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 transition-colors hover:bg-muted/50",
        isSelected && "bg-muted",
      )}
      onClick={() => onSelect?.(path)}
      onKeyDown={handleKeyDown}
      role="treeitem"
      style={driveFileTreeRowStyle(depth)}
      tabIndex={0}
    >
      {/* Spacer matching the folder row's chevron, so file names align under folder names. */}
      <span className="size-4 shrink-0" />
      <FileGlyph
        className={cn("size-4 shrink-0 text-muted-foreground", isSelected && "text-foreground")}
      />
      <span className={cn("truncate", isSelected && "font-medium text-foreground")}>{name}</span>
    </div>
  );
}
