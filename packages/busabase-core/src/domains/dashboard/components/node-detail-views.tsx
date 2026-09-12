import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { hasApiKeyLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { FilePreviewVO, FileTreeFileVO, FormVO, NodeVO } from "busabase-contract/types";
import { CodeBlock } from "kui/ai-elements/code-block";
import { Button } from "kui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "kui/tabs";
import { cn } from "kui/utils";
import {
  AppWindow,
  Download,
  File,
  Files,
  FileText,
  Folder,
  Form,
  HardDrive,
  Info,
  RefreshCw,
  Share2,
  Sparkles,
  Table2,
} from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useLocation, useSearch } from "wouter";
import { fmt, useCoreI18n } from "../../../i18n";
import { AirAppDetailView } from "../../airapp/components/AirAppDetailView";
import { AirAppSidePanelPreview } from "../../airapp/components/RunPanel";
import { DocEditor } from "../../doc/components";
import { useDocImageUpload } from "../../doc/hooks/use-doc-image-upload";
import { isBuiltinDrivePreviewSufficient } from "../../filetree/utils/preview-capability";
import { FormDetailView } from "../../form/components/form-detail-view";
import {
  buildFileTreeRenameOperations,
  buildPreviewFileEmbedUrl,
  fileTreeFileName,
  fileTreeParentPath,
  fileTreeUploadPath,
  inferFileTreeMimeType,
  resolveFileTreePreviewKind,
} from "../helpers/file-tree-files";
import { mergeSearchIntoHref } from "../helpers/link-search";
import { asNodeDetail } from "../helpers/node-detail";
import { useFileTreeAssetUpload } from "../hooks/use-file-tree-asset-upload";
import { useNodeAgentPrompts } from "../hooks/use-node-agent-prompts";
import { useRegisterTopbarNodeActions } from "../hooks/use-register-topbar-node-actions";
import { useReportLoadedNode } from "../hooks/use-report-loaded-node";
import type { LoadedNode } from "../node-detail-registry";
import { type NodeDetailProps, registerNodeDetail } from "../node-detail-registry";
import { registerSidePanelTab, type SidePanelTabProps } from "../side-panel-registry";
import { useIsAnonymousVisitor } from "../visitor-context";
import { AgentPromptsView } from "./agent-prompts-view";
import { AssetMediaPreview } from "./assets";
import { MarkdownFieldPreview } from "./field-preview";
import {
  buildFileTree,
  collectFolderPaths,
  DriveFileTree,
  FILE_TREE_LANGUAGE_BY_EXTENSION,
  guessFileTreeLanguage,
  renderFileTree,
  type SkillTreeNode,
} from "./file-tree-browser";
import {
  type FileTreeMutationMode,
  FileTreeRemoveDialog,
  FileTreeRenameDialog,
  FileTreeUploadControl,
} from "./file-tree-file-actions";
import { NodeActionsMenu } from "./node-actions-menu";
import { NodeAgentPromptsButton } from "./node-agent-prompts-button";
import { resolveSpaceId } from "./node-agent-prompts-dialog";
import { NodePinButton, nodeSidePanelTabId } from "./node-pin-button";
import { NodeSettingsDialog } from "./node-settings-dialog";
import { NodeShareDialog } from "./node-share-button";
import { EmptyState } from "./primitives";
import { FileContentSkeleton, NodeDetailSkeleton } from "./skeletons";
import { SplitSubmitButton, useWorkspacePermissionLevel } from "./split-submit-button";

// Re-exported for backward compat — these building blocks moved to
// `./file-tree-browser` so `AirAppDetailView` can reuse them without a
// circular import back into this file.
export {
  buildFileTree,
  collectFolderPaths,
  FILE_TREE_LANGUAGE_BY_EXTENSION,
  guessFileTreeLanguage,
  renderFileTree,
  type SkillTreeNode,
};

interface FileTreeDetailViewProps {
  orpc: BusabaseQueryUtils;
  slug: string | null;
  /** Also the `type` discriminator sent to the shared `/file-trees` endpoints. */
  nodeType: "skill" | "drive";
  onNodeLoaded?: NodeDetailProps["onNodeLoaded"];
  /** Hides Pin/Permissions/Delete — used when rendered inside the side panel
   *  preview (see `registerSidePanelTab` calls below), where those node-level
   *  actions don't apply to a "glance at it while working elsewhere" view. */
  hideActions?: boolean;
  /**
   * Renders AirApp-style tabs with this node as the FIRST one, ahead of the file
   * browser. Omit and the view is exactly what it was: a file browser with no tab
   * strip.
   *
   * A prop rather than a `nodeType === "skill"` branch because the two node types
   * sharing this component want different things. A Skill IS a manual — what you
   * want on opening one is what you can ask an agent to do with it, and the files
   * are the implementation. A Drive is storage; its files ARE the point.
   */
  agentPromptsTab?: ReactNode;
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
  nodeType,
  onNodeLoaded,
  hideActions = false,
  agentPromptsTab,
  labels,
}: FileTreeDetailViewProps) {
  const messages = useCoreI18n();
  const queryClient = useQueryClient();
  const [, rawSetLocation] = useLocation();
  const currentSearch = useSearch();
  const setLocation = useCallback(
    (to: string) => rawSetLocation(mergeSearchIntoHref(to, currentSearch)),
    [rawSetLocation, currentSearch],
  );
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<null | "save" | "changeRequest">(null);
  const [fileActionError, setFileActionError] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<FileTreeFileVO | null>(null);
  const [removeTarget, setRemoveTarget] = useState<FileTreeFileVO | null>(null);
  const [builtinPreviewPath, setBuiltinPreviewPath] = useState<string | null>(null);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [remotePreview, setRemotePreview] = useState<
    // `attempt` is the retry generation, not decoration: pressing Retry bumps
    // `previewAttempt`, which is what re-runs this effect. Dropping the field
    // would make that dependency look unused.
    | { path: string; status: "loading"; attempt: number }
    | { path: string; status: "resolved"; result: FilePreviewVO }
    | null
  >(null);
  const previewRequestRef = useRef(0);
  const uploadedAssetsRef = useRef(
    new Map<string, { assetId: string; displayName: string; mimeType: string }>(),
  );
  const isAnonymous = useIsAnonymousVisitor();
  const permissionLevel = useWorkspacePermissionLevel();
  const canChangeFiles =
    nodeType === "drive" &&
    !hideActions &&
    !isAnonymous &&
    hasApiKeyLevel(permissionLevel, "changeRequest");
  const uploadAsset = useFileTreeAssetUpload(orpc);

  const fileTreeQuery = useQuery({
    ...orpc.nodes.get.queryOptions({ input: { nodeId: slug ?? "", type: nodeType } }),
    enabled: Boolean(slug),
  });
  // `nodes.get` is one route for every node type, so narrow to this view's branch.
  const fileTree = asNodeDetail(fileTreeQuery.isError ? undefined : fileTreeQuery.data, nodeType);
  useReportLoadedNode(fileTree?.node, onNodeLoaded);
  // `enabled: !hideActions` keeps the side-panel preview instance of this
  // same component (rendered with `hideActions`) from ever touching the
  // shared topbar slot that the real page's instance owns.
  useRegisterTopbarNodeActions(
    fileTree ? (
      <>
        {agentPromptsTab ? null : (
          <NodeAgentPromptsButton
            orpc={orpc}
            nodeId={fileTree.node.id}
            nodeName={fileTree.node.name}
            nodeType={nodeType}
          />
        )}
        <NodePinButton
          payload={{ nodeId: fileTree.node.id }}
          tabId={nodeSidePanelTabId(nodeType, fileTree.node.id)}
          tabType={`${nodeType}-preview`}
          title={fileTree.node.name}
        />
        <NodeActionsMenu
          nodeId={fileTree.node.id}
          nodeName={fileTree.node.name}
          nodeSlug={fileTree.node.slug}
          nodeType={nodeType}
          orpc={orpc}
        />
      </>
    ) : null,
    !hideActions,
  );

  // Reset the open file when switching file-tree nodes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only on slug change
  useEffect(() => {
    setOpenPath(null);
    setIsEditing(false);
    setDraft("");
    setFileActionError(null);
    setRenameTarget(null);
    setRemoveTarget(null);
    setBuiltinPreviewPath(null);
    setRemotePreview(null);
    uploadedAssetsRef.current.clear();
  }, [slug]);

  const fileQuery = useQuery({
    ...orpc.fileTrees.readFile.queryOptions({
      input: { nodeId: fileTree?.node.id ?? "", filePath: openPath ?? "", type: nodeType },
    }),
    enabled: Boolean(fileTree && openPath),
  });
  const previewConfigQuery = useQuery({
    ...orpc.fileTrees.previewConfig.queryOptions({}),
    enabled: nodeType === "drive" && Boolean(slug),
  });
  const createCr = useMutation(orpc.fileTrees.createChangeRequest.mutationOptions());
  const { mutateAsync: preparePreviewAsync } = useMutation(
    orpc.fileTrees.preparePreview.mutationOptions(),
  );

  // Only a provider that is actually usable reaches the remote path. A broken
  // or half-finished configuration keeps Drive rendering through the built-in
  // preview instead of turning every file into an error card; the problem stays
  // visible in Settings > File Preview and in the server logs. The server
  // enforces the same rule for the Embed and public API surfaces.
  const remotePreviewEnabled =
    previewConfigQuery.data?.provider === "previewfile" &&
    previewConfigQuery.data.status === "ready";
  // Same predicate the server enforces, so a Markdown/code/image/PDF file never
  // pays for a round trip that could only answer "use the built-in preview".
  // This has to gate BOTH the request below and the render branch further down:
  // skipping only the request leaves the remote panel waiting for an answer that
  // is never coming.
  const builtinPreviewSufficient =
    Boolean(openPath) &&
    Boolean(fileQuery.data) &&
    isBuiltinDrivePreviewSufficient({
      path: openPath ?? "",
      mimeType: fileQuery.data?.mimeType ?? "",
    });

  useEffect(() => {
    const requestId = previewRequestRef.current + 1;
    previewRequestRef.current = requestId;
    if (
      nodeType !== "drive" ||
      !remotePreviewEnabled ||
      !fileTree ||
      !openPath ||
      !fileQuery.data ||
      isEditing ||
      builtinPreviewPath === openPath ||
      builtinPreviewSufficient
    ) {
      setRemotePreview(null);
      return;
    }

    const requestedPath = openPath;
    setRemotePreview({ path: requestedPath, status: "loading", attempt: previewAttempt });
    void preparePreviewAsync({ nodeId: fileTree.node.id, filePath: requestedPath, type: "drive" })
      .then((result) => {
        if (previewRequestRef.current !== requestId) return;
        setRemotePreview({ path: requestedPath, status: "resolved", result });
      })
      .catch(() => {
        if (previewRequestRef.current !== requestId) return;
        setRemotePreview({
          path: requestedPath,
          status: "resolved",
          result: {
            state: "unavailable",
            provider: "previewfile",
            reason: "service_unavailable",
            retryable: true,
          },
        });
      });
  }, [
    builtinPreviewPath,
    fileQuery.data,
    fileTree,
    isEditing,
    nodeType,
    openPath,
    preparePreviewAsync,
    previewAttempt,
    remotePreviewEnabled,
    builtinPreviewSufficient,
  ]);

  const tree = useMemo(() => buildFileTree(fileTree?.files ?? []), [fileTree?.files]);
  const expandedFolders = useMemo(() => new Set(collectFolderPaths(tree)), [tree]);
  const filePaths = useMemo(
    () => new Set((fileTree?.files ?? []).map((file) => file.path)),
    [fileTree?.files],
  );
  const filesByPath = useMemo(
    () => new Map((fileTree?.files ?? []).map((file) => [file.path, file])),
    [fileTree?.files],
  );
  useEffect(() => {
    if (!fileTree || openPath) {
      return;
    }
    const entryFile =
      fileTree.files.find((file) => file.path === fileTree.entryFile) ?? fileTree.files[0];
    if (entryFile) {
      setOpenPath(entryFile.path);
    }
  }, [fileTree, openPath]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset expansion only when opening another file-tree node
  useEffect(() => {
    setExpandedPaths(expandedFolders);
  }, [fileTree?.node.id]);

  const selectFile = useCallback(
    (path: string) => {
      // FileTreeFolder also fires onSelect; only react to real files.
      if (filePaths.has(path)) {
        setOpenPath(path);
        setIsEditing(false);
        setDraft("");
        setFileActionError(null);
        setBuiltinPreviewPath(null);
      }
    },
    [filePaths],
  );

  type FileMutationOperation =
    | {
        kind: "create";
        path: string;
        assetId: string;
        displayName?: string;
        mimeType?: string;
      }
    | { kind: "delete"; path: string; baseContentHash?: string };

  const submitFileOperations = async ({
    message,
    mode,
    nextPath,
    operations,
    successMessage,
  }: {
    message: string;
    mode: FileTreeMutationMode;
    nextPath: string | null;
    operations: FileMutationOperation[];
    successMessage: string;
  }) => {
    if (!fileTree) throw new Error(messages.nodeDetail.couldNotSave);
    const changeRequest = await createCr.mutateAsync({
      autoMerge: mode === "immediate",
      message,
      nodeId: fileTree.node.id,
      operations,
      submittedBy: "web-editor",
      type: nodeType,
    });

    if (changeRequest.status !== "merged") {
      setLocation(`/inbox/${changeRequest.id}`);
      return false;
    }

    const deletedPaths = operations
      .filter(
        (operation): operation is Extract<FileMutationOperation, { kind: "delete" }> =>
          operation.kind === "delete",
      )
      .map((operation) => operation.path);
    await Promise.all(
      deletedPaths.map((path) =>
        queryClient.cancelQueries({
          queryKey: orpc.fileTrees.readFile.queryOptions({
            input: { filePath: path, nodeId: fileTree.node.id, type: nodeType },
          }).queryKey,
        }),
      ),
    );
    for (const path of deletedPaths) {
      queryClient.removeQueries({
        queryKey: orpc.fileTrees.readFile.queryOptions({
          input: { filePath: path, nodeId: fileTree.node.id, type: nodeType },
        }).queryKey,
      });
    }
    setOpenPath(nextPath);
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.nodes.get.queryOptions({
          input: { nodeId: fileTree.node.id, type: nodeType },
        }).queryKey,
      }),
      queryClient.invalidateQueries({ queryKey: orpc.assets.list.key() }),
    ]);
    await fileTreeQuery.refetch();
    setIsEditing(false);
    setDraft("");
    setFileActionError(null);
    toast.success(successMessage);
    return true;
  };

  const readFileForAction = async (path: string) => {
    if (!fileTree) throw new Error(messages.nodeDetail.couldNotReadFile);
    return queryClient.fetchQuery(
      orpc.fileTrees.readFile.queryOptions({
        input: { filePath: path, nodeId: fileTree.node.id, type: nodeType },
      }),
    );
  };

  const uploadFiles = async (files: File[], folder: string, mode: FileTreeMutationMode) => {
    const uploaded = [] as Array<{
      assetId: string;
      displayName: string;
      mimeType: string;
      path: string;
    }>;

    for (const file of files) {
      const cacheKey = `${file.name}:${file.size}:${file.lastModified}`;
      let asset = uploadedAssetsRef.current.get(cacheKey);
      if (!asset) {
        const result = await uploadAsset(file);
        if (!result.assetId) throw new Error(messages.nodeDetail.fileUploadMissingAsset);
        asset = {
          assetId: result.assetId,
          displayName: file.name,
          mimeType: inferFileTreeMimeType(file.name, file.type),
        };
        uploadedAssetsRef.current.set(cacheKey, asset);
      }
      uploaded.push({ ...asset, path: fileTreeUploadPath(folder, file.name) });
    }

    const merged = await submitFileOperations({
      message:
        uploaded.length === 1 ? `Upload ${uploaded[0]?.path}` : `Upload ${uploaded.length} files`,
      mode,
      nextPath: uploaded[0]?.path ?? openPath,
      operations: uploaded.map((file) => ({
        assetId: file.assetId,
        displayName: file.displayName,
        kind: "create",
        mimeType: file.mimeType,
        path: file.path,
      })),
      successMessage: messages.nodeDetail.filesUploaded.replace("{count}", String(uploaded.length)),
    });
    if (merged && folder) {
      setExpandedPaths((current) => {
        const next = new Set(current);
        const segments = folder.split("/");
        for (let index = 1; index <= segments.length; index += 1) {
          next.add(segments.slice(0, index).join("/"));
        }
        return next;
      });
    }
    for (const file of files) {
      uploadedAssetsRef.current.delete(`${file.name}:${file.size}:${file.lastModified}`);
    }
  };

  const renameFile = async (nextName: string, mode: FileTreeMutationMode) => {
    if (!renameTarget) return;
    const current = await readFileForAction(renameTarget.path);
    const { nextPath, operations } = buildFileTreeRenameOperations(
      renameTarget,
      nextName,
      current.contentHash || undefined,
    );
    await submitFileOperations({
      message: `Rename ${renameTarget.path} to ${nextPath}`,
      mode,
      nextPath,
      operations,
      successMessage: messages.nodeDetail.fileRenamed,
    });
    setRenameTarget(null);
  };

  const removeFile = async (mode: FileTreeMutationMode) => {
    if (!removeTarget) return;
    const current = await readFileForAction(removeTarget.path);
    const fileIndex = fileTree?.files.findIndex((file) => file.path === removeTarget.path) ?? -1;
    const nextFile =
      fileTree?.files[fileIndex + 1] ??
      (fileIndex > 0 ? fileTree?.files[fileIndex - 1] : undefined);
    await submitFileOperations({
      message: `Remove ${removeTarget.path} from ${nodeType}`,
      mode,
      nextPath: nextFile?.path ?? null,
      operations: [
        {
          kind: "delete",
          path: removeTarget.path,
          ...(current.contentHash ? { baseContentHash: current.contentHash } : {}),
        },
      ],
      successMessage: messages.nodeDetail.fileRemoved,
    });
    setRemoveTarget(null);
  };

  const downloadFile = async (path: string) => {
    try {
      const current = await readFileForAction(path);
      if (!current.assetUrl) throw new Error(messages.nodeDetail.fileDownloadFailed);
      const anchor = document.createElement("a");
      anchor.href = current.assetUrl;
      anchor.download = current.displayName ?? fileTreeFileName(path);
      anchor.rel = "noreferrer";
      anchor.target = "_blank";
      anchor.click();
    } catch (caught) {
      toast.error(
        caught instanceof Error ? caught.message : messages.nodeDetail.fileDownloadFailed,
      );
    }
  };

  const startEditingFile = () => {
    if (!fileQuery.data || fileQuery.data.encoding !== "utf8") {
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
      // `autoMerge` carries the button's intent to the endpoint, which decides and
      // applies it in the same request. It used to be omitted, so the endpoint's
      // permission-aware default answered BOTH modes the same way: "Request
      // review" already merged the file for a write-capable user, and the two
      // calls below then re-approved an already-merged change request.
      const changeRequest = await createCr.mutateAsync({
        nodeId: fileTree.node.id,
        type: nodeType,
        message: `Update ${openPath}`,
        autoMerge: mode === "save",
        operations: [
          {
            kind: "update",
            path: openPath,
            content: draft,
            baseContentHash: fileQuery.data.contentHash,
          },
        ],
      });
      // Branch on the result, not the requested mode: `autoMerge: true` is not a
      // permission override, so an actor without write on the node still gets a
      // pending request back and belongs in the inbox rather than in an error.
      if (changeRequest.status !== "merged") {
        setLocation(`/inbox/${changeRequest.id}`);
        return;
      }
      await queryClient.invalidateQueries({
        queryKey: orpc.nodes.get.queryOptions({
          input: { nodeId: fileTree.node.id, type: nodeType },
        }).queryKey,
      });
      await queryClient.invalidateQueries({
        queryKey: orpc.fileTrees.readFile.queryOptions({
          input: { nodeId: fileTree.node.id, filePath: openPath, type: nodeType },
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

  const fileCount = fileTree.files.length;
  const NodeIcon = nodeType === "drive" ? HardDrive : Sparkles;
  const nodeTypeLabel =
    nodeType === "drive" ? messages.nodeDetail.drive : messages.nodeDetail.skill;
  const previewKind = fileQuery.data
    ? resolveFileTreePreviewKind(openPath ?? "", fileQuery.data.mimeType)
    : "code";
  const previewMimeType = fileQuery.data
    ? inferFileTreeMimeType(openPath ?? "", fileQuery.data.mimeType)
    : "application/octet-stream";
  const resolvedRemotePreview =
    remotePreview?.path === openPath && remotePreview.status === "resolved"
      ? remotePreview.result
      : null;
  const shouldRenderRemotePreview =
    nodeType === "drive" &&
    remotePreviewEnabled &&
    !isEditing &&
    !builtinPreviewSufficient &&
    builtinPreviewPath !== openPath &&
    resolvedRemotePreview?.state !== "builtin";
  const previewLocale =
    typeof document === "undefined"
      ? "en"
      : document.documentElement.lang || navigator.language || "en";
  const remotePreviewReason =
    resolvedRemotePreview?.state === "unavailable"
      ? messages.nodeDetail.filePreviewReasons[resolvedRemotePreview.reason]
      : null;

  // One wrapper for both shapes: `Tabs` when a prompts tab was supplied, a
  // plain div otherwise — so a Drive renders the identical markup it always did.
  const Frame = agentPromptsTab ? FileTreeTabsFrame : FileTreePlainFrame;

  return (
    <Frame>
      {agentPromptsTab ? (
        <header className="shrink-0 border-border/60 border-b">
          <div className="flex min-w-0 items-start gap-2 px-3 pt-3 pb-2 md:px-4">
            <span className="flex h-5 shrink-0 items-center" title={nodeTypeLabel}>
              <NodeIcon className="size-4 translate-y-px text-muted-foreground" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1">
                <h1 className="truncate font-medium text-foreground text-sm">
                  {fileTree.node.name}
                </h1>
                <Button
                  aria-label={messages.nodeDetail.details}
                  className="shrink-0 text-muted-foreground"
                  onClick={() => setInfoOpen(true)}
                  size="icon-sm"
                  title={messages.nodeDetail.details}
                  type="button"
                  variant="ghost"
                >
                  <Info className="size-3.5" />
                </Button>
              </div>
              {fileTree.node.description ? (
                <p className="mt-1 text-muted-foreground text-sm leading-relaxed">
                  {fileTree.node.description}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex min-h-10 items-center px-3 md:px-4">
            <TabsList className="h-8 shrink-0 gap-1 bg-transparent p-0">
              <TabsTrigger className={FILE_TREE_TAB_TRIGGER_CLASS} value="prompts">
                <Sparkles className="size-3.5" />
                {messages.agentPrompts.title}
              </TabsTrigger>
              <TabsTrigger className={FILE_TREE_TAB_TRIGGER_CLASS} value="files">
                <Files className="size-3.5" />
                {messages.nodeDetail.files}
              </TabsTrigger>
            </TabsList>
          </div>
        </header>
      ) : (
        <header className="flex h-12 shrink-0 items-center gap-2 border-border/60 border-b px-3 md:px-4">
          <div className="flex min-w-0 items-center gap-2">
            <span title={nodeTypeLabel}>
              <NodeIcon className="size-4 shrink-0 text-muted-foreground" />
            </span>
            <h1 className="max-w-[60%] shrink-0 truncate font-medium text-foreground text-sm">
              {fileTree.node.name}
            </h1>
            {fileTree.node.description ? (
              <>
                <span
                  aria-hidden="true"
                  className="hidden shrink-0 text-muted-foreground/40 text-sm lg:inline"
                >
                  ·
                </span>
                <p
                  className="hidden min-w-0 flex-1 truncate text-muted-foreground text-sm lg:block"
                  title={fileTree.node.description}
                >
                  {fileTree.node.description}
                </p>
              </>
            ) : null}
            <Button
              aria-label={messages.nodeDetail.details}
              className="shrink-0 text-muted-foreground"
              onClick={() => setInfoOpen(true)}
              size="icon-sm"
              title={messages.nodeDetail.details}
              type="button"
              variant="ghost"
            >
              <Info className="size-3.5" />
            </Button>
          </div>
        </header>
      )}
      {infoOpen && (
        <NodeSettingsDialog
          initialTab="info"
          nodeId={fileTree.node.id}
          nodeName={fileTree.node.name}
          nodeSlug={fileTree.node.slug}
          nodeType={nodeType}
          onOpenChange={setInfoOpen}
          open={infoOpen}
          orpc={orpc}
        />
      )}

      {agentPromptsTab ? (
        <TabsContent
          className="mt-0 flex min-h-0 flex-1 flex-col overflow-auto px-4 pb-4"
          value="prompts"
        >
          {agentPromptsTab}
        </TabsContent>
      ) : null}

      <FileTreeBrowserPane hasTabs={agentPromptsTab !== undefined}>
        <aside className="min-h-[220px] border-border/60 border-b bg-muted/20 lg:min-h-0 lg:border-r lg:border-b-0">
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex min-h-11 items-center justify-between gap-3 border-border/50 border-b px-4">
              <div className="font-medium text-muted-foreground text-xs uppercase">
                {messages.nodeDetail.files}
              </div>
              <div className="flex items-center gap-1">
                {canChangeFiles ? (
                  <FileTreeUploadControl
                    availableFolders={collectFolderPaths(tree)}
                    defaultFolder={openPath ? fileTreeParentPath(openPath) : ""}
                    existingPaths={filePaths}
                    onSubmit={uploadFiles}
                  />
                ) : null}
                <div className="rounded-md border border-border/70 bg-card px-1.5 py-0.5 font-mono text-muted-foreground text-[11px] tabular-nums">
                  {fileCount}
                </div>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {fileTree.files.length === 0 ? (
                <div className="px-2 py-3 text-muted-foreground text-sm">
                  {messages.nodeDetail.noFilesYet}
                </div>
              ) : (
                <DriveFileTree
                  className="rounded-none border-0 bg-transparent font-sans text-[13px]"
                  expanded={expandedPaths}
                  key={fileTree.node.id}
                  onDownloadFile={(path) => void downloadFile(path)}
                  onRemoveFile={
                    canChangeFiles && !isEditing
                      ? (path) => setRemoveTarget(filesByPath.get(path) ?? null)
                      : undefined
                  }
                  onRenameFile={
                    canChangeFiles && !isEditing
                      ? (path) => setRenameTarget(filesByPath.get(path) ?? null)
                      : undefined
                  }
                  onExpandedChange={setExpandedPaths}
                  onSelect={selectFile}
                  selectedPath={openPath ?? undefined}
                >
                  {renderFileTree(tree)}
                </DriveFileTree>
              )}
            </div>
          </div>
        </aside>

        <main className="flex min-h-0 flex-col">
          <div className="flex min-h-11 flex-col gap-2 border-border/60 border-b px-4 py-2 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 truncate font-mono text-muted-foreground text-xs">
              {openPath ?? messages.nodeDetail.selectFile}
            </div>
            {openPath && fileQuery.data && !fileQuery.isError ? (
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {fileQuery.data.assetUrl ? (
                  <Button
                    asChild
                    className="size-8 text-muted-foreground"
                    size="icon-sm"
                    title={messages.nodeDetail.downloadFile}
                    variant="ghost"
                  >
                    <a
                      aria-label={messages.nodeDetail.downloadFile}
                      download={fileQuery.data.displayName ?? fileTreeFileName(openPath)}
                      href={fileQuery.data.assetUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      <Download aria-hidden className="size-3.5" />
                    </a>
                  </Button>
                ) : null}
                {fileQuery.data.encoding === "utf8" ? (
                  isEditing ? (
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <button
                        className="rounded-md px-2.5 py-1.5 text-muted-foreground text-xs transition-colors hover:bg-muted/60 hover:text-foreground disabled:opacity-40"
                        disabled={busy !== null}
                        onClick={cancelEditingFile}
                        type="button"
                      >
                        {messages.common.cancel}
                      </button>
                      <SplitSubmitButton
                        changeRequestAction={{
                          label: messages.nodeDetail.saveAsChangeRequest,
                          loadingLabel: messages.nodeDetail.saving,
                          onSubmit: () => void saveFile("changeRequest"),
                          isLoading: busy === "changeRequest",
                        }}
                        disabled={busy !== null || draft === fileQuery.data.content}
                        dropdownPosition="below"
                        hint={messages.common.mergeImmediatelyHint}
                        immediateAction={{
                          label: messages.nodeDetail.save,
                          loadingLabel: messages.nodeDetail.saving,
                          onSubmit: () => void saveFile("save"),
                          isLoading: busy === "save",
                        }}
                      />
                    </div>
                  ) : (
                    <button
                      className="w-fit shrink-0 rounded-md border border-border/70 bg-card px-2.5 py-1.5 text-xs transition-colors hover:bg-muted/60"
                      onClick={startEditingFile}
                      type="button"
                    >
                      {messages.common.edit}
                    </button>
                  )
                ) : null}
              </div>
            ) : null}
          </div>
          {fileActionError ? (
            <div className="border-border/60 border-b bg-destructive/5 px-4 py-2 text-destructive text-sm">
              {fileActionError}
            </div>
          ) : null}
          <div className="min-h-0 flex-1 overflow-auto">
            {!openPath ? (
              <div className="grid h-full min-h-[320px] place-items-center p-8 text-center text-muted-foreground text-sm">
                {messages.nodeDetail.selectFile}
              </div>
            ) : fileQuery.isLoading ? (
              <FileContentSkeleton />
            ) : fileQuery.isError ? (
              <div className="border-border/60 border-b bg-destructive/5 p-4 text-destructive text-sm">
                {fileQuery.error instanceof Error
                  ? fileQuery.error.message
                  : messages.nodeDetail.couldNotReadFile}
              </div>
            ) : isEditing ? (
              <textarea
                aria-label={openPath}
                className="min-h-[calc(100vh-15rem)] w-full resize-none border-0 bg-background p-4 font-mono text-sm leading-6 outline-none placeholder:text-muted-foreground"
                onChange={(event) => setDraft(event.target.value)}
                spellCheck={false}
                value={draft}
              />
            ) : shouldRenderRemotePreview ? (
              !resolvedRemotePreview || remotePreview?.status === "loading" ? (
                <div className="grid h-full min-h-[320px] place-items-center p-8 text-center text-muted-foreground text-sm">
                  <div className="flex flex-col items-center gap-3">
                    <RefreshCw aria-hidden className="size-5 animate-spin" />
                    {messages.nodeDetail.filePreviewPreparing}
                  </div>
                </div>
              ) : resolvedRemotePreview.state === "ready" ? (
                <div className="flex h-full min-h-[520px] flex-col">
                  <div className="flex h-8 shrink-0 items-center justify-end border-border/50 border-b px-3 text-muted-foreground text-[11px]">
                    {messages.nodeDetail.filePreviewPoweredBy}
                  </div>
                  <iframe
                    className="min-h-0 flex-1 border-0 bg-background"
                    referrerPolicy="no-referrer"
                    sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
                    src={buildPreviewFileEmbedUrl(resolvedRemotePreview.previewUrl, previewLocale)}
                    title={messages.nodeDetail.filePreviewTitle}
                  />
                </div>
              ) : (
                <div className="grid h-full min-h-[320px] place-items-center p-8">
                  <div className="max-w-md rounded-lg border border-border bg-card p-5 text-center shadow-sm">
                    <p className="font-medium text-foreground">
                      {messages.nodeDetail.filePreviewUnavailable}
                    </p>
                    <p className="mt-2 text-muted-foreground text-sm">{remotePreviewReason}</p>
                    <div className="mt-4 flex flex-wrap justify-center gap-2">
                      {resolvedRemotePreview.retryable ? (
                        <Button
                          onClick={() => setPreviewAttempt((attempt) => attempt + 1)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          <RefreshCw aria-hidden className="size-3.5" />
                          {messages.nodeDetail.filePreviewRetry}
                        </Button>
                      ) : null}
                      <Button
                        onClick={() => setBuiltinPreviewPath(openPath)}
                        size="sm"
                        type="button"
                      >
                        {messages.nodeDetail.filePreviewUseBuiltin}
                      </Button>
                    </div>
                  </div>
                </div>
              )
            ) : fileQuery.data && fileQuery.data.encoding !== "utf8" ? (
              <div className="p-5 text-muted-foreground text-sm">
                {fileQuery.data.assetUrl && previewKind !== "code" ? (
                  <div className="mb-4 grid max-h-[55vh] place-items-center overflow-hidden rounded-md border bg-muted">
                    <AssetMediaPreview
                      mediaClassName="max-h-[55vh] w-full object-contain"
                      mimeType={previewMimeType}
                      name={fileQuery.data.displayName ?? openPath}
                      url={fileQuery.data.assetUrl}
                    />
                  </div>
                ) : null}
                <p className="font-medium text-foreground">
                  {messages.nodeDetail.assetFilePreview}
                </p>
                <dl className="mt-4 grid gap-2 font-mono text-xs">
                  <div className="flex gap-2">
                    <dt className="shrink-0 text-muted-foreground">
                      {messages.nodeDetail.fileName}
                    </dt>
                    <dd className="min-w-0 truncate">{fileQuery.data.displayName ?? openPath}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="shrink-0 text-muted-foreground">
                      {messages.nodeDetail.assetId}
                    </dt>
                    <dd className="min-w-0 truncate">{fileQuery.data.assetId}</dd>
                  </div>
                  {fileQuery.data.assetUrl ? (
                    <div className="flex gap-2">
                      <dt className="shrink-0 text-muted-foreground">
                        {messages.nodeDetail.assetUrl}
                      </dt>
                      <dd className="min-w-0 truncate">
                        <a
                          className="text-primary underline-offset-2 hover:underline"
                          href={fileQuery.data.assetUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          {fileQuery.data.assetUrl}
                        </a>
                      </dd>
                    </div>
                  ) : null}
                  <div className="flex gap-2">
                    <dt className="shrink-0 text-muted-foreground">
                      {messages.nodeDetail.mediaType}
                    </dt>
                    <dd className="min-w-0 truncate">{fileQuery.data.mimeType}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="shrink-0 text-muted-foreground">
                      {messages.nodeDetail.contentHash}
                    </dt>
                    <dd className="min-w-0 truncate">{fileQuery.data.contentHash}</dd>
                  </div>
                </dl>
              </div>
            ) : previewKind === "image" && fileQuery.data?.assetUrl ? (
              // An SVG is both text and an image: it arrives with
              // `encoding: "utf8"`, so it never reaches the binary branch above
              // and used to render as source. Preview it as an image here; the
              // Edit button still exposes the markup.
              <div className="p-5">
                <div className="grid max-h-[70vh] place-items-center overflow-hidden rounded-md border bg-muted">
                  <AssetMediaPreview
                    mediaClassName="max-h-[70vh] w-full object-contain"
                    mimeType={previewMimeType}
                    name={fileQuery.data.displayName ?? openPath}
                    url={fileQuery.data.assetUrl}
                  />
                </div>
              </div>
            ) : previewKind === "markdown" ? (
              <div className="mx-auto w-full max-w-4xl p-4 md:p-6">
                <MarkdownFieldPreview value={fileQuery.data?.content ?? ""} />
              </div>
            ) : (
              <CodeBlock
                className="min-h-[calc(100vh-15rem)] !rounded-none !border-0 !bg-transparent"
                code={fileQuery.data?.content ?? ""}
                language={guessFileTreeLanguage(openPath)}
                showLineNumbers
              />
            )}
          </div>
        </main>
      </FileTreeBrowserPane>
      <FileTreeRenameDialog
        existingPaths={filePaths}
        file={renameTarget}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
        onSubmit={renameFile}
        open={renameTarget !== null}
      />
      <FileTreeRemoveDialog
        file={removeTarget}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        onSubmit={removeFile}
        open={removeTarget !== null}
      />
    </Frame>
  );
}

/** Shared by both trigger buttons; lifted from `AirAppDetailView`'s tab strip. */
const FILE_TREE_TAB_TRIGGER_CLASS =
  "h-7 gap-1.5 rounded-lg bg-transparent px-2.5 text-muted-foreground shadow-none transition-colors hover:bg-muted/40 hover:text-foreground data-[state=active]:bg-muted data-[state=active]:text-foreground data-[state=active]:shadow-none";

/** No tabs: the exact markup this view had before the Skill node grew a prompts tab. */
const FileTreePlainFrame = ({ children }: { children: ReactNode }) => (
  <div className="flex h-full min-h-0 w-full flex-col bg-background">{children}</div>
);

/**
 * Tabs, with the prompts tab first.
 *
 * `Tabs` wraps the header so its trigger list and content share one state owner.
 */
const FileTreeTabsFrame = ({ children }: { children: ReactNode }) => (
  <Tabs className="flex h-full min-h-0 w-full flex-col gap-0 bg-background" defaultValue="prompts">
    {children}
  </Tabs>
);

/**
 * The file browser itself. Inside tabs it is the "files" tab's content;
 * without them it is the whole body, and renders the same grid either way.
 *
 * `forceMount` is deliberate: the browser owns the open file, the edit draft and
 * the expanded folders, and a tab switch must not silently discard someone's
 * half-written edit.
 */
const FileTreeBrowserPane = ({ hasTabs, children }: { hasTabs: boolean; children: ReactNode }) => {
  const className = "mt-0 grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)]";
  if (!hasTabs) return <div className={className}>{children}</div>;
  return (
    <TabsContent className={`${className} data-[state=inactive]:hidden`} forceMount value="files">
      {children}
    </TabsContent>
  );
};

/**
 * A Skill node opens on what you can ASK for, not on its file tree.
 *
 * The node is a manual: the useful first question is "what can an agent do with
 * this", and the prompts answer it in one click (Copy, or Ask Agent). The files
 * are one tab over for whoever wants to read or edit them — which is also why
 * there is no separate "Source" tab: the Files tab already opens on `SKILL.md`
 * (the node's entry file), so a third tab would be a second door to the same
 * room.
 *
 * The prompts are keyed off the LOADED node rather than the route slug because
 * they need the node's id and name; until it loads, the tab renders nothing and
 * the file browser behaves exactly as before.
 */
export function SkillDetailView({
  orpc,
  slug,
  onNodeLoaded,
  hideActions,
}: NodeDetailProps & { hideActions?: boolean }) {
  const messages = useCoreI18n();
  const [loadedNode, setLoadedNode] = useState<LoadedNode | null>(null);
  const reportLoaded = useCallback(
    (node: LoadedNode) => {
      setLoadedNode(node);
      onNodeLoaded?.(node);
    },
    [onNodeLoaded],
  );

  return (
    <FileTreeDetailView
      agentPromptsTab={
        loadedNode ? (
          <SkillAgentPromptsTab node={loadedNode} orpc={orpc} />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
            {messages.common.loading}
          </div>
        )
      }
      hideActions={hideActions}
      labels={{
        notFoundTitle: messages.nodeDetail.skillNotFoundTitle,
        notFoundBody: messages.nodeDetail.skillNotFoundBody,
        selectBody: messages.nodeDetail.selectSkillBody,
        skeletonVariant: "skill",
      }}
      nodeType="skill"
      onNodeLoaded={reportLoaded}
      orpc={orpc}
      slug={slug}
    />
  );
}

/**
 * The same surface the prompts dialog shows — same component, same hook, same
 * Copy and Ask Agent — rendered inline instead of inside a Dialog.
 *
 * `onHandedOff` is a no-op here: there is no dialog to close once the prompt
 * reaches an agent, and the side panel it opens is its own confirmation.
 */
function SkillAgentPromptsTab({ node, orpc }: { node: LoadedNode; orpc: BusabaseQueryUtils }) {
  const {
    scenarios,
    capabilities,
    customPrompts,
    canSaveCustomPrompts,
    saving,
    saveCustomPrompts,
    loading,
  } = useNodeAgentPrompts({
    nodeId: node.id,
    nodeName: node.name,
    nodeType: "skill",
    orpc,
    spaceId: resolveSpaceId(),
  });

  return (
    <AgentPromptsView
      askAgent={{ orpc, sessionScopeId: node.id }}
      capabilities={capabilities}
      loading={loading}
      management={{
        customPrompts,
        canSave: canSaveCustomPrompts,
        saving,
        save: saveCustomPrompts,
      }}
      onHandedOff={() => {}}
      scenarios={scenarios}
    />
  );
}

export function DriveDetailView({
  orpc,
  slug,
  onNodeLoaded,
  hideActions,
}: NodeDetailProps & { hideActions?: boolean }) {
  const messages = useCoreI18n();
  return (
    <FileTreeDetailView
      hideActions={hideActions}
      labels={{
        notFoundTitle: messages.nodeDetail.driveNotFoundTitle,
        notFoundBody: messages.nodeDetail.driveNotFoundBody,
        selectBody: messages.nodeDetail.selectDriveBody,
        skeletonVariant: "skill",
      }}
      nodeType="drive"
      onNodeLoaded={onNodeLoaded}
      orpc={orpc}
      slug={slug}
    />
  );
}

registerNodeDetail("skill", SkillDetailView);
registerNodeDetail("drive", DriveDetailView);
registerNodeDetail("airapp", AirAppDetailView);
registerSidePanelTab("airapp-preview", AirAppSidePanelPreview);

function SkillSidePanelPreview({ orpc, payload }: SidePanelTabProps) {
  const { nodeId } = payload as { nodeId: string };
  return <SkillDetailView hideActions orpc={orpc} slug={nodeId} />;
}
registerSidePanelTab("skill-preview", SkillSidePanelPreview);

function DriveSidePanelPreview({ orpc, payload }: SidePanelTabProps) {
  const { nodeId } = payload as { nodeId: string };
  return <DriveDetailView hideActions orpc={orpc} slug={nodeId} />;
}
registerSidePanelTab("drive-preview", DriveSidePanelPreview);

export function FileNodeDetailView({
  orpc,
  slug,
  onNodeLoaded,
  hideActions,
}: NodeDetailProps & { hideActions?: boolean }) {
  const messages = useCoreI18n();
  const [infoOpen, setInfoOpen] = useState(false);
  const fileQuery = useQuery({
    ...orpc.nodes.get.queryOptions({ input: { nodeId: slug ?? "", type: "file" } }),
    enabled: Boolean(slug),
  });
  const detail = asNodeDetail(fileQuery.isError ? undefined : fileQuery.data, "file");
  useReportLoadedNode(detail?.node, onNodeLoaded);
  useRegisterTopbarNodeActions(
    detail ? (
      <>
        <NodeAgentPromptsButton
          orpc={orpc}
          nodeId={detail.node.id}
          nodeName={detail.node.name}
          nodeType="file"
        />
        <NodePinButton
          payload={{ nodeId: detail.node.id }}
          tabId={nodeSidePanelTabId("file", detail.node.id)}
          tabType="file-preview"
          title={detail.node.name}
        />
        <NodeActionsMenu
          nodeId={detail.node.id}
          nodeName={detail.node.name}
          nodeSlug={detail.node.slug}
          nodeType="file"
          orpc={orpc}
        />
      </>
    ) : null,
    !hideActions,
  );

  if (!detail) {
    return fileQuery.isLoading ? (
      <NodeDetailSkeleton variant="doc" />
    ) : (
      <EmptyState
        title={messages.nodeDetail.fileNotFoundTitle}
        body={
          slug
            ? fmt(messages.nodeDetail.fileNotFoundBody, { slug })
            : messages.nodeDetail.selectFileNodeBody
        }
      />
    );
  }

  const { node, asset } = detail;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      {/* Single compact toolbar (identity + info trigger, actions) replaces the
          old stacked title-block / metadata-sidebar chrome, giving the asset
          preview maximum space — mirrors AirAppDetailView's header pattern.
          Description/backing-asset metadata moved into `NodeSettingsDialog`'s
          Info tab. */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-border/60 border-b px-3 md:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <File className="size-4 shrink-0 text-muted-foreground" />
          <h1 className="truncate font-medium text-foreground text-sm">{node.name}</h1>
          <Button
            aria-label={messages.nodeDetail.details}
            className="shrink-0 text-muted-foreground"
            onClick={() => setInfoOpen(true)}
            size="icon-sm"
            title={messages.nodeDetail.details}
            type="button"
            variant="ghost"
          >
            <Info className="size-3.5" />
          </Button>
          {infoOpen && (
            <NodeSettingsDialog
              initialTab="info"
              nodeId={node.id}
              nodeName={node.name}
              nodeSlug={node.slug}
              nodeType="file"
              onOpenChange={setInfoOpen}
              open={infoOpen}
              orpc={orpc}
            />
          )}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4 md:p-6">
        <div className="mx-auto grid h-full min-h-[320px] max-w-5xl place-items-center overflow-hidden rounded-md border bg-muted">
          <AssetMediaPreview
            mediaClassName="max-h-[65vh] w-full object-contain"
            mimeType={asset.mimeType}
            name={asset.name}
            url={asset.url}
          />
        </div>
      </div>
    </div>
  );
}

registerNodeDetail("file", FileNodeDetailView);

function FileSidePanelPreview({ orpc, payload }: SidePanelTabProps) {
  const { nodeId } = payload as { nodeId: string };
  return <FileNodeDetailView hideActions orpc={orpc} slug={nodeId} />;
}
registerSidePanelTab("file-preview", FileSidePanelPreview);

export function DocDetailView({
  orpc,
  slug,
  onNodeLoaded,
  hideActions = false,
}: NodeDetailProps & { hideActions?: boolean }) {
  const messages = useCoreI18n();
  const [, rawSetLocation] = useLocation();
  const currentSearch = useSearch();
  const setLocation = useCallback(
    (to: string) => rawSetLocation(mergeSearchIntoHref(to, currentSearch)),
    [rawSetLocation, currentSearch],
  );
  const docQuery = useQuery({
    ...orpc.nodes.get.queryOptions({ input: { nodeId: slug ?? "", type: "doc" } }),
    enabled: Boolean(slug),
  });
  const doc = asNodeDetail(docQuery.isError ? undefined : docQuery.data, "doc");
  useReportLoadedNode(doc?.node, onNodeLoaded);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<null | "save" | "changeRequest">(null);
  const [error, setError] = useState<string | null>(null);

  // Registered only while NOT editing — mirrors the original ternary where
  // entering edit mode replaced Edit/Pin/Actions with Cancel/Save controls
  // (those stay rendered in-page, right next to the editor; see below).
  useRegisterTopbarNodeActions(
    !isEditing && doc ? (
      <>
        <button
          className="rounded-button border px-3 py-1.5 text-sm hover:bg-muted"
          onClick={() => {
            setDraft(doc.body);
            setError(null);
            setIsEditing(true);
          }}
          type="button"
        >
          {messages.common.edit}
        </button>
        <NodeAgentPromptsButton
          orpc={orpc}
          nodeId={doc.node.id}
          nodeName={doc.node.name}
          nodeType="doc"
        />
        <NodePinButton
          payload={{ nodeId: doc.node.id }}
          tabId={nodeSidePanelTabId("doc", doc.node.id)}
          tabType="doc-preview"
          title={doc.node.name}
        />
        <NodeActionsMenu
          nodeId={doc.node.id}
          nodeName={doc.node.name}
          nodeSlug={doc.node.slug}
          nodeType="doc"
          orpc={orpc}
        />
      </>
    ) : null,
    !hideActions,
  );

  // Default to read-only; reset to view mode when switching docs.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only on slug change
  useEffect(() => {
    setIsEditing(false);
    setDraft("");
    setError(null);
  }, [slug]);

  const createCr = useMutation(orpc.nodes.updateContent.mutationOptions());
  const uploadImage = useDocImageUpload(orpc);

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

  // Direct Save: one request. `nodes.updateContent` approves and merges inside the
  // same call when the actor may write, so this used to pay for two extra round
  // trips that re-approved an already-merged change request.
  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      await createCr.mutateAsync({
        nodeId: doc.node.id,
        content: { kind: "doc", body: draft },
        autoMerge: true,
      });
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
        content: { kind: "doc", body: draft },
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
    // Left padding is wider than the right: the Milkdown block-handle (drag/+
    // button, see doc-editor.css) renders to the left of the hovered block and
    // needs that room, or it gets clipped by this container's own overflow-auto.
    <div
      className="mx-auto flex h-full min-h-0 w-full min-w-0 max-w-5xl flex-col overflow-auto py-10 pr-6 pl-24"
      data-dashboard-scroll="doc-detail"
    >
      <div className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="truncate font-semibold text-3xl text-foreground tracking-tight">
            {doc.node.name}
          </h1>
          {doc.node.description ? (
            <p className="mt-1 text-muted-foreground text-sm">{doc.node.description}</p>
          ) : null}
        </div>
        {!hideActions && isEditing ? (
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
            <SplitSubmitButton
              changeRequestAction={{
                label: messages.nodeDetail.saveAsChangeRequest,
                loadingLabel: messages.nodeDetail.saving,
                onSubmit: saveAsChangeRequest,
                isLoading: busy === "changeRequest",
              }}
              disabled={busy !== null}
              dropdownPosition="below"
              hint={messages.common.mergeImmediatelyHint}
              immediateAction={{
                label: messages.nodeDetail.save,
                loadingLabel: messages.nodeDetail.saving,
                onSubmit: save,
                isLoading: busy === "save",
              }}
            />
          </div>
        ) : null}
      </div>
      {error ? <p className="mb-3 text-destructive text-sm">{error}</p> : null}
      {isEditing || doc.body.trim() ? (
        <DocEditor
          key={`${doc.node.id}:${isEditing}`}
          className="min-h-[60vh] flex-1"
          content={isEditing ? draft : doc.body}
          editable={isEditing}
          onChange={setDraft}
          onImageUpload={uploadImage}
        />
      ) : (
        <div className="flex-1 text-muted-foreground text-sm">{messages.nodeDetail.emptyDoc}</div>
      )}
    </div>
  );
}

registerNodeDetail("doc", DocDetailView);

function DocSidePanelPreview({ orpc, payload }: SidePanelTabProps) {
  const { nodeId } = payload as { nodeId: string };
  return <DocDetailView hideActions orpc={orpc} slug={nodeId} />;
}
registerSidePanelTab("doc-preview", DocSidePanelPreview);

export function FolderDetailView({
  orpc,
  slug,
  onNodeLoaded,
  hideActions,
}: NodeDetailProps & { hideActions?: boolean }) {
  const messages = useCoreI18n();
  const currentSearch = useSearch();
  const [location] = useLocation();
  const folderQuery = useQuery({
    ...orpc.nodes.get.queryOptions({ input: { nodeId: slug ?? "", type: "folder" } }),
    enabled: Boolean(slug),
  });
  const folder = asNodeDetail(folderQuery.isError ? undefined : folderQuery.data, "folder");
  useReportLoadedNode(folder?.node, onNodeLoaded);
  useRegisterTopbarNodeActions(
    folder ? (
      <>
        <NodeAgentPromptsButton
          orpc={orpc}
          nodeId={folder.node.id}
          nodeName={folder.node.name}
          nodeType="folder"
        />
        <NodePinButton
          payload={{ nodeId: folder.node.id }}
          tabId={nodeSidePanelTabId("folder", folder.node.id)}
          tabType="folder-preview"
          title={folder.node.name}
        />
        <NodeActionsMenu
          childCount={folder.children.length}
          nodeId={folder.node.id}
          nodeName={folder.node.name}
          nodeSlug={folder.node.slug}
          nodeType="folder"
          orpc={orpc}
        />
      </>
    ) : null,
    !hideActions,
  );

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
    <div
      className="mx-auto h-full min-h-0 w-full min-w-0 max-w-5xl overflow-auto px-6 py-8"
      data-dashboard-scroll="folder-detail"
    >
      <div className="mb-8 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-semibold text-2xl tracking-tight">{folder.node.name}</h1>
          {folder.node.description ? (
            <p className="mt-2 text-muted-foreground text-sm">{folder.node.description}</p>
          ) : null}
        </div>
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
          <div className="-mx-2 flex flex-col gap-1">
            {folder.children.map((child) => {
              const Icon = FOLDER_CHILD_ICONS[child.type] ?? FileText;
              const isActive = location === `/${child.type}/${child.slug}`;
              return (
                <Link
                  key={child.id}
                  className={cn(
                    "group flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-muted/50",
                    isActive && "bg-muted hover:bg-muted",
                  )}
                  href={mergeSearchIntoHref(`/${child.type}/${child.slug}`, currentSearch)}
                >
                  <Icon
                    className={cn(
                      "size-4 shrink-0 text-muted-foreground",
                      isActive && "text-foreground",
                    )}
                  />
                  <span
                    className={cn(
                      "flex-1 truncate text-sm",
                      isActive && "font-medium text-foreground",
                    )}
                  >
                    {child.name}
                  </span>
                  <span className="text-[11px] text-muted-foreground/70">{child.type}</span>
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
  form: Form,
  base: Table2,
  doc: FileText,
  file: File,
  skill: Sparkles,
  drive: HardDrive,
  airapp: AppWindow,
};

registerNodeDetail("folder", FolderDetailView);
const findNodeBySlug = (nodes: NodeVO[], type: string, slug: string): NodeVO | null => {
  for (const node of nodes) {
    if (node.type === type && node.slug === slug) return node;
    const match = findNodeBySlug(node.children, type, slug);
    if (match) return match;
  }
  return null;
};

function FormShareButton({
  form,
  node,
  orpc,
}: {
  form: FormVO;
  node: NodeVO;
  orpc: BusabaseQueryUtils;
}) {
  const messages = useCoreI18n();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const nodeShareQuery = useQuery(
    orpc.nodes.share.get.queryOptions({ input: { nodeId: node.id } }),
  );
  const updateForm = useMutation(orpc.forms.update.mutationOptions());
  const setNodeShare = useMutation(orpc.nodes.share.set.mutationOptions());
  const busy = updateForm.isPending || setNodeShare.isPending;

  const openShare = async () => {
    try {
      const creatingPublicForm = !form.share.isPublic;
      if (creatingPublicForm) {
        await updateForm.mutateAsync({
          nodeId: node.id,
          share: { ...form.share, isPublic: true, anonymousSubmit: true },
        });
      }
      if (creatingPublicForm || nodeShareQuery.data?.scope !== "public") {
        await setNodeShare.mutateAsync({ nodeId: node.id, scope: "public", capability: "submit" });
      }
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.forms.getByNode.queryOptions({ input: { nodeId: node.slug } }).queryKey,
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.nodes.share.get.queryOptions({ input: { nodeId: node.id } }).queryKey,
        }),
      ]);
      setOpen(true);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : messages.share.failed);
    }
  };

  return (
    <>
      <Button
        className="h-8 gap-1.5"
        disabled={busy}
        onClick={openShare}
        size="sm"
        variant="outline"
      >
        <Share2 className="size-3.5" />
        {messages.share.title}
      </Button>
      <NodeShareDialog
        nodeId={node.id}
        nodeName={node.name}
        nodeSlug={node.slug}
        nodeType="form"
        onOpenChange={setOpen}
        open={open}
        orpc={orpc}
      />
    </>
  );
}

function FormNodeDetailView({ nodes = [], onNodeLoaded, orpc, slug }: NodeDetailProps) {
  const isAnonymous = useIsAnonymousVisitor();
  const nodeQuery = useQuery({
    ...orpc.nodes.get.queryOptions({ input: { nodeId: slug ?? "", type: "form" } }),
    enabled: Boolean(slug && !isAnonymous),
    retry: false,
  });
  const nodeDetail = asNodeDetail(nodeQuery.isError ? undefined : nodeQuery.data, "form");
  const node = nodeDetail?.node ?? (slug ? findNodeBySlug(nodes, "form", slug) : null);
  const formQuery = useQuery({
    ...orpc.forms.getByNode.queryOptions({ input: { nodeId: slug ?? "" } }),
    enabled: Boolean(slug),
    retry: false,
  });
  const form = formQuery.isError ? null : (formQuery.data ?? null);
  useReportLoadedNode(node, onNodeLoaded);

  // Form used to register ONLY the Share button — no Agent prompts, no Pin, no
  // "•••" (so no Rename / Permissions / Delete either), which made it the one
  // node type whose header didn't match any other. It is also the type that
  // needs Agent prompts most: the page is agent-authored HTML and there is no
  // GUI form builder, so without this button there is no discoverable way to
  // change a form's layout at all.
  useRegisterTopbarNodeActions(
    node && !isAnonymous ? (
      <>
        <NodeAgentPromptsButton orpc={orpc} nodeId={node.id} nodeName={node.name} nodeType="form" />
        <NodePinButton
          payload={{ nodeId: node.id }}
          tabId={nodeSidePanelTabId("form", node.id)}
          tabType="form-preview"
          title={node.name}
        />
        {form ? <FormShareButton form={form} node={node} orpc={orpc} /> : null}
        <NodeActionsMenu
          nodeId={node.id}
          nodeName={node.name}
          nodeSlug={node.slug}
          nodeType="form"
          orpc={orpc}
        />
      </>
    ) : null,
  );

  return <FormDetailView orpc={orpc} slug={slug} />;
}

registerNodeDetail("form", FormNodeDetailView);

// Backs the Pin button the Form header now has; `getFormByNodeId` accepts an id
// or a slug, so the pinned payload's node id resolves the same form the page does.
function FormSidePanelPreview({ orpc, payload }: SidePanelTabProps) {
  const { nodeId } = payload as { nodeId: string };
  return <FormDetailView orpc={orpc} slug={nodeId} />;
}
registerSidePanelTab("form-preview", FormSidePanelPreview);

function FolderSidePanelPreview({ orpc, payload }: SidePanelTabProps) {
  const { nodeId } = payload as { nodeId: string };
  return <FolderDetailView hideActions orpc={orpc} slug={nodeId} />;
}
registerSidePanelTab("folder-preview", FolderSidePanelPreview);
