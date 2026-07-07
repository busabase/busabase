import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { FileTreeNodeVO } from "busabase-contract/types";
import { CodeBlock } from "kui/ai-elements/code-block";
import { FileTree, FileTreeFile, FileTreeFolder } from "kui/ai-elements/file-tree";
import { FileText, Folder, HardDrive, Sparkles, Table2, Trash2 } from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import {
  type ComponentProps,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { toast } from "sonner";
import { useLocation } from "wouter";
import { fmt, useCoreI18n } from "../../../i18n";
import { registerNodeDetail } from "../node-detail-registry";
import type { SkillCodeLanguage } from "./field-preview";
import { ConfirmActionDialog, EmptyState } from "./primitives";
import { NodeDetailSkeleton } from "./skeletons";

/**
 * Delete action for a folder/doc/skill node. Creates a `node_delete` change
 * request and approve-merges it (soft-archive → recoverable from Trash). Folders
 * warn about the cascade (their subtree is archived in one batch).
 */
function NodeDeleteButton({
  orpc,
  nodeId,
  nodeType,
  nodeName,
  childCount = 0,
}: {
  orpc: BusabaseQueryUtils;
  nodeId: string;
  nodeType: string;
  nodeName: string;
  childCount?: number;
}) {
  const messages = useCoreI18n();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const createCr = useMutation(orpc.nodes.createChangeRequest.mutationOptions());
  const reviewCr = useMutation(orpc.changeRequests.review.mutationOptions());
  const mergeCr = useMutation(orpc.changeRequests.merge.mutationOptions());
  const pending = createCr.isPending || reviewCr.isPending || mergeCr.isPending;
  const nodeTypeLabels: Record<string, string> = {
    doc: messages.nodeDetail.doc,
    folder: messages.nodeDetail.folder,
    skill: messages.nodeDetail.skill,
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
    if (file.type === "folder") {
      if (!byPath.has(file.path)) {
        const node: SkillTreeNode = { name, path: file.path, type: "folder", children: [] };
        byPath.set(file.path, node);
        ensureDir(parentPath).push(node);
      }
    } else {
      ensureDir(parentPath).push({ name, path: file.path, type: "file", children: [] });
    }
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

interface FileTreeNamespace {
  createChangeRequest: BusabaseQueryUtils["skills"]["createChangeRequest"];
  get: BusabaseQueryUtils["skills"]["get"];
  readFile: BusabaseQueryUtils["skills"]["readFile"];
}

interface FileTreeDetailViewProps {
  orpc: BusabaseQueryUtils;
  slug: string | null;
  namespace: FileTreeNamespace;
  nodeType: "skill" | "drive";
  labels: {
    notFoundTitle: string;
    notFoundBody: string;
    selectBody: string;
    skeletonVariant: "skill";
  };
}

export function FileTreeDetailView({
  orpc,
  slug,
  namespace,
  nodeType,
  labels,
}: FileTreeDetailViewProps) {
  const messages = useCoreI18n();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<null | "save" | "changeRequest">(null);
  const [fileActionError, setFileActionError] = useState<string | null>(null);

  const fileTreeQuery = useQuery({
    ...namespace.get.queryOptions({ input: { nodeId: slug ?? "" } }),
    enabled: Boolean(slug),
  });
  const fileTree = fileTreeQuery.data ?? null;

  // Reset the open file when switching file-tree nodes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only on slug change
  useEffect(() => {
    setOpenPath(null);
    setIsEditing(false);
    setDraft("");
    setFileActionError(null);
  }, [slug]);

  const fileQuery = useQuery({
    ...namespace.readFile.queryOptions({
      input: { nodeId: fileTree?.node.id ?? "", filePath: openPath ?? "" },
    }),
    enabled: Boolean(fileTree && openPath),
  });
  const createCr = useMutation(namespace.createChangeRequest.mutationOptions());
  const reviewCr = useMutation(orpc.changeRequests.review.mutationOptions());
  const mergeCr = useMutation(orpc.changeRequests.merge.mutationOptions());

  const tree = useMemo(() => buildFileTree(fileTree?.files ?? []), [fileTree?.files]);
  const expandedFolders = useMemo(() => new Set(collectFolderPaths(tree)), [tree]);
  const filePaths = useMemo(
    () =>
      new Set(
        (fileTree?.files ?? []).filter((file) => file.type === "file").map((file) => file.path),
      ),
    [fileTree?.files],
  );

  useEffect(() => {
    if (!fileTree || openPath) {
      return;
    }
    const entryFile =
      fileTree.files.find((file) => file.type === "file" && file.path === fileTree.entryFile) ??
      fileTree.files.find((file) => file.type === "file");
    if (entryFile) {
      setOpenPath(entryFile.path);
    }
  }, [fileTree, openPath]);

  const selectFile = useCallback(
    (path: string) => {
      // FileTreeFolder also fires onSelect; only react to real files.
      if (filePaths.has(path)) {
        setOpenPath(path);
        setIsEditing(false);
        setDraft("");
        setFileActionError(null);
      }
    },
    [filePaths],
  );

  const startEditingFile = () => {
    if (!fileQuery.data) {
      return;
    }
    setDraft(fileQuery.data.content);
    setFileActionError(null);
    setIsEditing(true);
  };

  const cancelEditingFile = () => {
    setIsEditing(false);
    setDraft("");
    setFileActionError(null);
  };

  const saveFile = async (mode: "save" | "changeRequest") => {
    if (!fileTree || !openPath || !fileQuery.data) {
      return;
    }
    setBusy(mode);
    setFileActionError(null);
    try {
      const changeRequest = await createCr.mutateAsync({
        nodeId: fileTree.node.id,
        message: `Update ${openPath}`,
        operations: [
          {
            kind: "update",
            path: openPath,
            content: draft,
            baseContentHash: fileQuery.data.contentHash,
          },
        ],
      });
      if (mode === "changeRequest") {
        setLocation(`/inbox/${changeRequest.id}`);
        return;
      }
      await reviewCr.mutateAsync({ changeRequestId: changeRequest.id, verdict: "approved" });
      await mergeCr.mutateAsync({ changeRequestId: changeRequest.id });
      await queryClient.invalidateQueries({
        queryKey: namespace.get.queryOptions({ input: { nodeId: fileTree.node.id } }).queryKey,
      });
      await queryClient.invalidateQueries({
        queryKey: namespace.readFile.queryOptions({
          input: { nodeId: fileTree.node.id, filePath: openPath },
        }).queryKey,
      });
      await Promise.all([fileTreeQuery.refetch(), fileQuery.refetch()]);
      setIsEditing(false);
      setDraft("");
    } catch (caught) {
      setFileActionError(
        caught instanceof Error ? caught.message : messages.nodeDetail.couldNotSave,
      );
    } finally {
      setBusy(null);
    }
  };

  if (!fileTree) {
    return fileTreeQuery.isLoading ? (
      <NodeDetailSkeleton variant={labels.skeletonVariant} />
    ) : (
      <EmptyState
        title={labels.notFoundTitle}
        body={slug ? fmt(labels.notFoundBody, { slug }) : labels.selectBody}
      />
    );
  }

  const metaChips = [
    fileTree.visibility,
    fileTree.version ? `v${fileTree.version}` : null,
    fileTree.entryFile ? `entry: ${fileTree.entryFile}` : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <div className="mx-auto w-full max-w-6xl p-4 md:p-6">
      <div className="rounded-xl border bg-background p-5">
        <div className="flex items-start justify-between gap-4">
          <h1 className="min-w-0 font-semibold text-xl">{fileTree.node.name}</h1>
          <NodeDeleteButton
            nodeId={fileTree.node.id}
            nodeName={fileTree.node.name}
            nodeType={nodeType}
            orpc={orpc}
          />
        </div>
        {fileTree.node.description ? (
          <p className="mt-1 text-muted-foreground text-sm">{fileTree.node.description}</p>
        ) : null}
        {metaChips.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {metaChips.map((chip) => (
              <span
                className="rounded-full border bg-muted px-2.5 py-1 text-muted-foreground text-xs"
                key={chip}
              >
                {chip}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-[280px_minmax(0,1fr)]">
        {fileTree.files.length === 0 ? (
          <div className="rounded-lg border bg-background p-4 text-muted-foreground text-sm">
            {messages.nodeDetail.noFilesYet}
          </div>
        ) : (
          <FileTree
            className="max-h-[70vh] overflow-auto"
            defaultExpanded={expandedFolders}
            key={fileTree.node.id}
            // FileTreeProps.onSelect collides with HTMLAttributes.onSelect; it is
            // invoked with the node path string at runtime.
            onSelect={selectFile as unknown as ComponentProps<typeof FileTree>["onSelect"]}
            selectedPath={openPath ?? undefined}
          >
            {renderFileTree(tree)}
          </FileTree>
        )}

        <div className="min-h-[320px]">
          {openPath ? (
            <div className="mb-2 flex min-h-9 items-center justify-between gap-3 rounded-md border bg-background px-3 py-2">
              <div className="min-w-0 truncate font-mono text-muted-foreground text-xs">
                {openPath}
              </div>
              {fileQuery.data && !fileQuery.isError ? (
                isEditing ? (
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      className="rounded-md px-2.5 py-1.5 text-muted-foreground text-xs transition-colors hover:text-foreground disabled:opacity-40"
                      disabled={busy !== null}
                      onClick={cancelEditingFile}
                      type="button"
                    >
                      {messages.common.cancel}
                    </button>
                    <button
                      className="rounded-md border px-2.5 py-1.5 text-xs transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={busy !== null || draft === fileQuery.data.content}
                      onClick={() => void saveFile("changeRequest")}
                      type="button"
                    >
                      {busy === "changeRequest"
                        ? messages.nodeDetail.saving
                        : messages.nodeDetail.saveAsChangeRequest}
                    </button>
                    <button
                      className="rounded-md bg-foreground px-2.5 py-1.5 text-background text-xs transition-colors hover:bg-foreground/85 disabled:cursor-not-allowed disabled:opacity-50"
                      disabled={busy !== null || draft === fileQuery.data.content}
                      onClick={() => void saveFile("save")}
                      type="button"
                    >
                      {busy === "save" ? messages.nodeDetail.saving : messages.nodeDetail.save}
                    </button>
                  </div>
                ) : (
                  <button
                    className="shrink-0 rounded-md border px-2.5 py-1.5 text-xs transition-colors hover:bg-muted"
                    onClick={startEditingFile}
                    type="button"
                  >
                    {messages.common.edit}
                  </button>
                )
              ) : null}
            </div>
          ) : null}
          {fileActionError ? (
            <div className="mb-2 rounded-md border bg-background p-3 text-destructive text-sm">
              {fileActionError}
            </div>
          ) : null}
          {!openPath ? (
            <div className="grid h-full min-h-[320px] place-items-center rounded-md border bg-background p-8 text-center text-muted-foreground text-sm">
              {messages.nodeDetail.selectFile}
            </div>
          ) : fileQuery.isLoading ? (
            <div className="rounded-md border bg-background p-4 text-muted-foreground text-sm">
              {fmt(messages.nodeDetail.readingFile, { path: openPath })}
            </div>
          ) : fileQuery.isError ? (
            <div className="rounded-md border bg-background p-4 text-destructive text-sm">
              {fileQuery.error instanceof Error
                ? fileQuery.error.message
                : messages.nodeDetail.couldNotReadFile}
            </div>
          ) : isEditing ? (
            <textarea
              aria-label={openPath}
              className="min-h-[520px] w-full resize-y rounded-md border bg-background p-4 font-mono text-sm leading-6 outline-none placeholder:text-muted-foreground"
              onChange={(event) => setDraft(event.target.value)}
              spellCheck={false}
              value={draft}
            />
          ) : (
            <CodeBlock
              code={fileQuery.data?.content ?? ""}
              language={guessFileTreeLanguage(openPath)}
              showLineNumbers
            />
          )}
        </div>
      </div>
    </div>
  );
}

export function SkillDetailView({ orpc, slug }: { orpc: BusabaseQueryUtils; slug: string | null }) {
  const messages = useCoreI18n();
  return (
    <FileTreeDetailView
      labels={{
        notFoundTitle: messages.nodeDetail.skillNotFoundTitle,
        notFoundBody: messages.nodeDetail.skillNotFoundBody,
        selectBody: messages.nodeDetail.selectSkillBody,
        skeletonVariant: "skill",
      }}
      namespace={orpc.skills}
      nodeType="skill"
      orpc={orpc}
      slug={slug}
    />
  );
}

export function DriveDetailView({ orpc, slug }: { orpc: BusabaseQueryUtils; slug: string | null }) {
  const messages = useCoreI18n();
  return (
    <FileTreeDetailView
      labels={{
        notFoundTitle: messages.nodeDetail.driveNotFoundTitle,
        notFoundBody: messages.nodeDetail.driveNotFoundBody,
        selectBody: messages.nodeDetail.selectDriveBody,
        skeletonVariant: "skill",
      }}
      namespace={orpc.drives}
      nodeType="drive"
      orpc={orpc}
      slug={slug}
    />
  );
}

registerNodeDetail("skill", SkillDetailView);
registerNodeDetail("drive", DriveDetailView);

export function DocDetailView({ orpc, slug }: { orpc: BusabaseQueryUtils; slug: string | null }) {
  const messages = useCoreI18n();
  const [, setLocation] = useLocation();
  const docQuery = useQuery({
    ...orpc.docs.get.queryOptions({ input: { nodeId: slug ?? "" } }),
    enabled: Boolean(slug),
  });
  const doc = docQuery.data ?? null;
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<null | "save" | "changeRequest">(null);
  const [error, setError] = useState<string | null>(null);

  // Default to read-only; reset to view mode when switching docs.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only on slug change
  useEffect(() => {
    setIsEditing(false);
    setDraft("");
    setError(null);
  }, [slug]);

  const createCr = useMutation(orpc.docs.createChangeRequest.mutationOptions());
  const reviewCr = useMutation(orpc.changeRequests.review.mutationOptions());
  const mergeCr = useMutation(orpc.changeRequests.merge.mutationOptions());

  if (!doc) {
    return docQuery.isLoading ? (
      <NodeDetailSkeleton variant="doc" />
    ) : (
      <EmptyState
        title={messages.nodeDetail.docNotFoundTitle}
        body={
          slug
            ? fmt(messages.nodeDetail.docNotFoundBody, { slug })
            : messages.nodeDetail.selectDocBody
        }
      />
    );
  }

  const startEditing = () => {
    setDraft(doc.body);
    setError(null);
    setIsEditing(true);
  };

  // Direct Save: propose + approve + merge in one go (mirrors a Base "Save & Merge").
  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      const changeRequest = await createCr.mutateAsync({
        nodeId: doc.node.id,
        body: draft,
      });
      await reviewCr.mutateAsync({
        changeRequestId: changeRequest.id,
        verdict: "approved",
      });
      await mergeCr.mutateAsync({ changeRequestId: changeRequest.id });
      await docQuery.refetch();
      setIsEditing(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : messages.nodeDetail.couldNotSave);
    } finally {
      setBusy(null);
    }
  };

  // Save as Change Request: propose only, then open it for review.
  const saveAsChangeRequest = async () => {
    setBusy("changeRequest");
    setError(null);
    try {
      const changeRequest = await createCr.mutateAsync({
        nodeId: doc.node.id,
        body: draft,
      });
      setLocation(`/inbox/${changeRequest.id}`);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : messages.nodeDetail.couldNotCreateChangeRequest,
      );
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-3xl flex-col px-6 py-10">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate font-semibold text-3xl text-foreground tracking-tight">
            {doc.node.name}
          </h1>
          {doc.node.description ? (
            <p className="mt-1 text-muted-foreground text-sm">{doc.node.description}</p>
          ) : null}
        </div>
        {isEditing ? (
          <div className="flex shrink-0 items-center gap-2">
            <button
              className="rounded-button px-3 py-1.5 text-muted-foreground text-sm hover:text-foreground disabled:opacity-40"
              disabled={busy !== null}
              onClick={() => {
                setIsEditing(false);
                setError(null);
              }}
              type="button"
            >
              {messages.common.cancel}
            </button>
            <button
              className="rounded-button border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-40"
              disabled={busy !== null}
              onClick={saveAsChangeRequest}
              type="button"
            >
              {busy === "changeRequest"
                ? messages.nodeDetail.saving
                : messages.nodeDetail.saveAsChangeRequest}
            </button>
            <button
              className="rounded-button bg-primary px-3 py-1.5 text-primary-foreground text-sm disabled:opacity-40"
              disabled={busy !== null}
              onClick={save}
              type="button"
            >
              {busy === "save" ? messages.nodeDetail.saving : messages.nodeDetail.save}
            </button>
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-2">
            <button
              className="rounded-button border px-3 py-1.5 text-sm hover:bg-muted"
              onClick={startEditing}
              type="button"
            >
              {messages.common.edit}
            </button>
            <NodeDeleteButton
              nodeId={doc.node.id}
              nodeName={doc.node.name}
              nodeType="doc"
              orpc={orpc}
            />
          </div>
        )}
      </div>
      {error ? <p className="mb-3 text-destructive text-sm">{error}</p> : null}
      {isEditing ? (
        <textarea
          aria-label={messages.nodeDetail.docBody}
          className="min-h-[60vh] flex-1 resize-none border-0 bg-transparent p-0 text-[15px] text-foreground leading-7 outline-none placeholder:text-muted-foreground"
          onChange={(event) => setDraft(event.target.value)}
          placeholder={messages.nodeDetail.writePlaceholder}
          value={draft}
        />
      ) : doc.body.trim() ? (
        <div className="flex-1 whitespace-pre-wrap text-[15px] text-foreground leading-7">
          {doc.body}
        </div>
      ) : (
        <div className="flex-1 text-muted-foreground text-sm">{messages.nodeDetail.emptyDoc}</div>
      )}
    </div>
  );
}

registerNodeDetail("doc", DocDetailView);

export function FolderDetailView({
  orpc,
  slug,
}: {
  orpc: BusabaseQueryUtils;
  slug: string | null;
}) {
  const messages = useCoreI18n();
  const folderQuery = useQuery({
    ...orpc.folders.get.queryOptions({ input: { nodeId: slug ?? "" } }),
    enabled: Boolean(slug),
  });
  const folder = folderQuery.data ?? null;

  if (!folder) {
    return folderQuery.isLoading ? (
      <NodeDetailSkeleton variant="folder" />
    ) : (
      <EmptyState
        title={messages.nodeDetail.folderNotFoundTitle}
        body={
          slug
            ? fmt(messages.nodeDetail.folderNotFoundBody, { slug })
            : messages.nodeDetail.selectFolderBody
        }
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-6 py-8">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-semibold text-2xl tracking-tight">{folder.node.name}</h1>
          {folder.node.description ? (
            <p className="mt-2 text-muted-foreground text-sm">{folder.node.description}</p>
          ) : null}
        </div>
        <NodeDeleteButton
          childCount={folder.children.length}
          nodeId={folder.node.id}
          nodeName={folder.node.name}
          nodeType="folder"
          orpc={orpc}
        />
      </div>
      {folder.children.length === 0 ? (
        <EmptyState
          title={messages.nodeDetail.emptyFolderTitle}
          body={messages.nodeDetail.emptyFolderBody}
        />
      ) : (
        <>
          <p className="mb-2 font-semibold text-[11px] uppercase tracking-widest text-muted-foreground/60">
            {folder.children.length}{" "}
            {folder.children.length === 1 ? messages.nodeDetail.item : messages.nodeDetail.items}
          </p>
          <div className="-mx-2 flex flex-col">
            {folder.children.map((child) => {
              const Icon = FOLDER_CHILD_ICONS[child.type] ?? FileText;
              return (
                <Link
                  key={child.id}
                  className="group flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/50"
                  href={`/${child.type}/${child.slug}`}
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate text-sm">{child.name}</span>
                  <span className="text-[11px] text-muted-foreground/50">{child.type}</span>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

const FOLDER_CHILD_ICONS: Record<string, typeof Folder> = {
  folder: Folder,
  base: Table2,
  doc: FileText,
  skill: Sparkles,
  drive: HardDrive,
};

registerNodeDetail("folder", FolderDetailView);
