"use client";

// Shared file-tree browsing building blocks — extracted out of node-detail-views.tsx
// so any file-tree-backed node type (skill/drive/airapp/…) can reuse the same
// delete button, tree builder, and tree renderer instead of duplicating them.
// `FileTreeDetailView` (node-detail-views.tsx) and `AirAppDetailView`
// (../../airapp/components/AirAppDetailView.tsx) both build on top of this module.

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { FileTreeNodeVO } from "busabase-contract/types";
import { FileTreeFile, FileTreeFolder } from "kui/ai-elements/file-tree";
import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { toast } from "sonner";
import { useLocation, useSearch } from "wouter";
import { fmt, useCoreI18n } from "../../../i18n";
import { mergeSearchIntoHref } from "../helpers/link-search";
import { useIsAnonymousVisitor } from "../visitor-context";
import type { SkillCodeLanguage } from "./field-preview";
import { ConfirmActionDialog } from "./primitives";

/**
 * Delete action for a folder/doc/skill/drive/airapp node. Creates a `node_delete`
 * change request and approve-merges it (soft-archive → recoverable from Trash).
 * Folders warn about the cascade (their subtree is archived in one batch).
 */
/**
 * Exported so `BaseDetailView` (base-views.tsx) can reuse the exact same
 * delete-to-Trash flow for a Base's own node — `mergeNodeDelete` already
 * special-cases `node.type === "base"` (archives the base + its records in
 * lockstep), so this button works unchanged with `nodeType="base"`.
 */
export function NodeDeleteButton({
  orpc,
  nodeId,
  nodeType,
  nodeName,
  childCount = 0,
  onDeleted,
}: {
  orpc: BusabaseQueryUtils;
  nodeId: string;
  nodeType: string;
  nodeName: string;
  childCount?: number;
  /** Optional hook fired right after a successful delete (e.g. so an
   *  airapp node can tear down its live Nodepod runner instead of leaking
   *  it). No-op for node types that don't pass it. */
  onDeleted?: () => void;
}) {
  const messages = useCoreI18n();
  const [, rawSetLocation] = useLocation();
  const currentSearch = useSearch();
  const setLocation = (to: string) => rawSetLocation(mergeSearchIntoHref(to, currentSearch));
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const createCr = useMutation(orpc.nodes.createChangeRequest.mutationOptions());
  const reviewCr = useMutation(orpc.changeRequests.review.mutationOptions());
  const mergeCr = useMutation(orpc.changeRequests.merge.mutationOptions());
  const pending = createCr.isPending || reviewCr.isPending || mergeCr.isPending;
  // Deleting a node is manage-only; a public read-only visitor never sees it.
  // Self-gating here covers every detail-header mount. All hooks run first.
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
        queryKey: orpc.nodes.listArchived.queryOptions({}).queryKey,
      });
      toast.success(fmt(messages.nodeDetail.movedToTrash, { type: label }));
      setConfirming(false);
      setLocation("/");
      onDeleted?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : fmt(messages.nodeDetail.failedDelete, { type: label }),
      );
      setConfirming(false);
    }
  };

  return (
    <>
      <button
        className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border/60 bg-background px-2.5 py-1.5 text-muted-foreground text-xs transition-colors hover:bg-red-50 hover:text-red-700"
        onClick={() => setConfirming(true)}
        type="button"
      >
        <Trash2 className="size-3.5" />
        {messages.nodeDetail.delete}
      </button>
      <ConfirmActionDialog
        body={body}
        confirmLabel={messages.nodeDetail.moveToTrash}
        onCancel={() => setConfirming(false)}
        onConfirm={handleConfirm}
        open={confirming}
        pending={pending}
        title={fmt(messages.nodeDetail.deleteTitle, { type: label })}
      />
    </>
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
