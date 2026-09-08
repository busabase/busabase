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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "kui/dropdown-menu";
import { cn } from "kui/utils";
import {
  ChevronRightIcon,
  Database,
  Download,
  FileCode,
  FileCog,
  FileIcon,
  FileJson,
  FileTerminal,
  FileText,
  FolderIcon,
  FolderOpenIcon,
  type LucideIcon,
  MoreHorizontal,
  Paintbrush,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  type CSSProperties,
  createContext,
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
  const pending = createCr.isPending;
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
      // One request: the endpoint approves and merges inside the same call when
      // the actor may write. The two follow-ups used to re-approve a change
      // request the server had already merged.
      await createCr.mutateAsync({
        autoMerge: true,
        operations: [{ kind: "delete", nodeId }],
      });
      await Promise.all([
        queryClient.cancelQueries({ queryKey: orpc.nodes.get.key() }),
        queryClient.cancelQueries({ queryKey: orpc.forms.getByNode.key() }),
        queryClient.cancelQueries({ queryKey: orpc.nodes.resolveRouteState.key() }),
      ]);
      // A failed background refetch retains the previous successful `data` in
      // TanStack Query. Remove detail families outright so an archived node can
      // never be painted from that stale value while its tombstone resolves.
      queryClient.removeQueries({ queryKey: orpc.nodes.get.key() });
      queryClient.removeQueries({ queryKey: orpc.forms.getByNode.key() });
      queryClient.removeQueries({ queryKey: orpc.nodes.resolveRouteState.key() });
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

export function renderFileTree(
  nodes: SkillTreeNode[],
  depth = 0,
  // Decided once for the whole tree, from the root level: any folder anywhere
  // nests under a root-level folder, so this covers the entire tree.
  //
  // Deciding it per level instead breaks the "deeper is further right" rule: a
  // folder whose children are all files would drop the column for them, and
  // since losing the spacer (-22px) outweighs one depth step (+14px), those
  // children rendered 8px LEFT of the root-level files. Reserving the column
  // whenever the tree has folders keeps file names aligned with sibling folder
  // names, and a Drive with no folders at all still avoids the phantom indent.
  reserveChevronColumn = nodes.some((node) => node.type === "folder"),
): ReactNode {
  return nodes.map((node) =>
    node.type === "folder" ? (
      <DriveFileTreeFolder depth={depth} key={node.path} name={node.name} path={node.path}>
        {renderFileTree(node.children, depth + 1, reserveChevronColumn)}
      </DriveFileTreeFolder>
    ) : (
      <DriveFileTreeFile
        alignWithFolders={reserveChevronColumn}
        depth={depth}
        key={node.path}
        name={node.name}
        path={node.path}
      />
    ),
  );
}

interface DriveFileTreeContextType {
  expandedPaths: Set<string>;
  togglePath: (path: string) => void;
  selectedPath?: string;
  onSelect?: (path: string) => void;
  onDownloadFile?: (path: string) => void;
  onRemoveFile?: (path: string) => void;
  onRenameFile?: (path: string) => void;
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
  onDownloadFile?: (path: string) => void;
  onRemoveFile?: (path: string) => void;
  onRenameFile?: (path: string) => void;
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
  onDownloadFile,
  onRemoveFile,
  onRenameFile,
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
    () => ({
      expandedPaths,
      onDownloadFile,
      onRemoveFile,
      onRenameFile,
      onSelect,
      selectedPath,
      togglePath,
    }),
    [expandedPaths, onDownloadFile, onRemoveFile, onRenameFile, onSelect, selectedPath, togglePath],
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

/**
 * A folder puts this inline padding on its own `<button>`, where it overrides the
 * button's `px-2`. A file row puts it on the wrapper `<div>` instead (so the hover
 * background spans the full row), and the inner button's `px-2` then adds another
 * 8px on top — which left file names 8px to the right of sibling folder names.
 * Drop the base inset here and let `px-2` supply it, so both land at the same x.
 */
const driveFileTreeFileRowStyle = (depth: number): CSSProperties => ({
  paddingLeft: depth * 14,
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
  /** True when the tree contains folders, i.e. a chevron column exists. */
  alignWithFolders?: boolean;
}

export function DriveFileTreeFile({
  path,
  name,
  depth = 0,
  alignWithFolders = false,
}: DriveFileTreeFileProps) {
  const messages = useCoreI18n();
  const { selectedPath, onSelect, onDownloadFile, onRemoveFile, onRenameFile } =
    useContext(DriveFileTreeContext);
  const isSelected = selectedPath === path;
  const FileGlyph = guessFileTreeIcon(path);
  const hasActions = Boolean(onDownloadFile || onRemoveFile || onRenameFile);

  return (
    <div
      className={cn(
        "group/file-row flex min-h-8 items-center rounded transition-colors duration-150 hover:bg-muted/50 focus-within:bg-muted/50",
        isSelected && "bg-muted",
      )}
      style={driveFileTreeFileRowStyle(depth)}
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-2 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        onClick={() => onSelect?.(path)}
        role="treeitem"
        type="button"
      >
        {/* Reserve the chevron column when the tree has folders, so file names
            line up with sibling folder names; a folder-less Drive skips it and
            avoids indenting every file under a column that is not there. */}
        {alignWithFolders ? <span aria-hidden className="size-4 shrink-0" /> : null}
        <FileGlyph
          aria-hidden
          className={cn("size-4 shrink-0 text-muted-foreground", isSelected && "text-foreground")}
        />
        <span className={cn("truncate", isSelected && "font-medium text-foreground")}>{name}</span>
      </button>
      {hasActions ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              aria-label={fmt(messages.nodeDetail.fileActionsFor, { name })}
              className="mr-1 flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 outline-none transition-[opacity,color,background-color,transform] duration-150 hover:bg-background/70 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] group-hover/file-row:opacity-100 data-[state=open]:bg-background/70 data-[state=open]:text-foreground data-[state=open]:opacity-100"
              onClick={(event) => event.stopPropagation()}
              type="button"
            >
              <MoreHorizontal aria-hidden className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-40">
            {onRenameFile ? (
              <DropdownMenuItem onSelect={() => onRenameFile(path)}>
                <Pencil aria-hidden />
                {messages.nodeDetail.renameFile}
              </DropdownMenuItem>
            ) : null}
            {onDownloadFile ? (
              <DropdownMenuItem onSelect={() => onDownloadFile(path)}>
                <Download aria-hidden />
                {messages.nodeDetail.downloadFile}
              </DropdownMenuItem>
            ) : null}
            {onRemoveFile ? <DropdownMenuSeparator /> : null}
            {onRemoveFile ? (
              <DropdownMenuItem onSelect={() => onRemoveFile(path)} variant="destructive">
                <Trash2 aria-hidden />
                {messages.nodeDetail.removeFromDrive}
              </DropdownMenuItem>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </div>
  );
}
