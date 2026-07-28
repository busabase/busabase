"use client";

// Shared file-tree browsing building blocks — extracted out of node-detail-views.tsx
// so any file-tree-backed node type (skill/drive/airapp/…) can reuse the same
// delete dialog, tree builder, and tree renderer instead of duplicating them.
// `FileTreeDetailView` (node-detail-views.tsx) and `AirAppDetailView`
// (../../airapp/components/AirAppDetailView.tsx) both build on top of this module.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { FileTreeNodeVO } from "busabase-contract/types";
import { FileTreeFile, FileTreeFolder } from "kui/ai-elements/file-tree";
import type { ReactNode } from "react";
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
      await reviewCr.mutateAsync({ changeRequestId: cr.id, verdict: "approved" });
      await mergeCr.mutateAsync({ changeRequestId: cr.id });
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

export function renderFileTree(nodes: SkillTreeNode[]): ReactNode {
  return nodes.map((node) =>
    node.type === "folder" ? (
      <FileTreeFolder key={node.path} name={node.name} path={node.path}>
        {renderFileTree(node.children)}
      </FileTreeFolder>
    ) : (
      <FileTreeFile key={node.path} name={node.name} path={node.path} />
    ),
  );
}
