import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { SkillVO } from "busabase-contract/types";
import { CodeBlock } from "kui/ai-elements/code-block";
import { FileTree, FileTreeFile, FileTreeFolder } from "kui/ai-elements/file-tree";
import { FileText, Folder, Sparkles, Table2, Trash2 } from "lucide-react";
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

// Build a nested tree from the skill's flat file list, synthesizing any parent
// folders that have no explicit entry. Folders sort before files, then by name.
export function buildSkillTree(files: SkillVO["files"]): SkillTreeNode[] {
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

export const SKILL_LANGUAGE_BY_EXTENSION: Record<string, string> = {
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

export const guessSkillLanguage = (path: string): SkillCodeLanguage => {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return (SKILL_LANGUAGE_BY_EXTENSION[ext] ?? "text") as SkillCodeLanguage;
};

export function renderSkillTree(nodes: SkillTreeNode[]): ReactNode {
  return nodes.map((node) =>
    node.type === "folder" ? (
      <FileTreeFolder key={node.path} name={node.name} path={node.path}>
        {renderSkillTree(node.children)}
      </FileTreeFolder>
    ) : (
      <FileTreeFile key={node.path} name={node.name} path={node.path} />
    ),
  );
}

export function SkillDetailView({ orpc, slug }: { orpc: BusabaseQueryUtils; slug: string | null }) {
  const messages = useCoreI18n();
  const [openPath, setOpenPath] = useState<string | null>(null);

  const skillQuery = useQuery({
    ...orpc.skills.get.queryOptions({ input: { nodeId: slug ?? "" } }),
    enabled: Boolean(slug),
  });
  const skill = skillQuery.data ?? null;

  // Reset the open file when switching skills.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only on slug change
  useEffect(() => {
    setOpenPath(null);
  }, [slug]);

  const fileQuery = useQuery({
    ...orpc.skills.readFile.queryOptions({
      input: { nodeId: skill?.node.id ?? "", filePath: openPath ?? "" },
    }),
    enabled: Boolean(skill && openPath),
  });

  const tree = useMemo(() => buildSkillTree(skill?.files ?? []), [skill?.files]);
  const expandedFolders = useMemo(() => new Set(collectFolderPaths(tree)), [tree]);
  const filePaths = useMemo(
    () =>
      new Set((skill?.files ?? []).filter((file) => file.type === "file").map((file) => file.path)),
    [skill?.files],
  );

  const selectFile = useCallback(
    (path: string) => {
      // FileTreeFolder also fires onSelect; only react to real files.
      if (filePaths.has(path)) {
        setOpenPath(path);
      }
    },
    [filePaths],
  );

  if (!skill) {
    return skillQuery.isLoading ? (
      <NodeDetailSkeleton variant="skill" />
    ) : (
      <EmptyState
        title={messages.nodeDetail.skillNotFoundTitle}
        body={
          slug
            ? fmt(messages.nodeDetail.skillNotFoundBody, { slug })
            : messages.nodeDetail.selectSkillBody
        }
      />
    );
  }

  const metaChips = [
    skill.visibility,
    skill.version ? `v${skill.version}` : null,
    skill.entryFile ? `entry: ${skill.entryFile}` : null,
  ].filter((value): value is string => Boolean(value));

  return (
    <div className="mx-auto w-full max-w-6xl p-4 md:p-6">
      <div className="rounded-xl border bg-background p-5">
        <div className="flex items-start justify-between gap-4">
          <h1 className="min-w-0 font-semibold text-xl">{skill.node.name}</h1>
          <NodeDeleteButton
            nodeId={skill.node.id}
            nodeName={skill.node.name}
            nodeType="skill"
            orpc={orpc}
          />
        </div>
        {skill.node.description ? (
          <p className="mt-1 text-muted-foreground text-sm">{skill.node.description}</p>
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
        {skill.files.length === 0 ? (
          <div className="rounded-lg border bg-background p-4 text-muted-foreground text-sm">
            {messages.nodeDetail.noFilesYet}
          </div>
        ) : (
          <FileTree
            className="max-h-[70vh] overflow-auto"
            defaultExpanded={expandedFolders}
            key={skill.node.id}
            // FileTreeProps.onSelect collides with HTMLAttributes.onSelect; it is
            // invoked with the node path string at runtime.
            onSelect={selectFile as unknown as ComponentProps<typeof FileTree>["onSelect"]}
            selectedPath={openPath ?? undefined}
          >
            {renderSkillTree(tree)}
          </FileTree>
        )}

        <div className="min-h-[320px]">
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
          ) : (
            <CodeBlock
              code={fileQuery.data?.content ?? ""}
              language={guessSkillLanguage(openPath)}
              showLineNumbers
            />
          )}
        </div>
      </div>
    </div>
  );
}

registerNodeDetail("skill", SkillDetailView);

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
};

registerNodeDetail("folder", FolderDetailView);
