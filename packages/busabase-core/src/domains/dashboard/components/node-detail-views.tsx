import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { FormVO, NodeVO } from "busabase-contract/types";
import { CodeBlock } from "kui/ai-elements/code-block";
import { Button } from "kui/button";
import { cn } from "kui/utils";
import {
  AppWindow,
  File,
  FileText,
  Folder,
  Form,
  HardDrive,
  Info,
  Share2,
  Sparkles,
  Table2,
} from "lucide-react";
import { SPALink as Link } from "openlib/ui/dashboard";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useLocation, useSearch } from "wouter";
import { fmt, useCoreI18n } from "../../../i18n";
import { AirAppDetailView } from "../../airapp/components/AirAppDetailView";
import { AirAppSidePanelPreview } from "../../airapp/components/RunPanel";
import { DocEditor } from "../../doc/components";
import { useDocImageUpload } from "../../doc/hooks/use-doc-image-upload";
import { FormDetailView } from "../../form/components/form-detail-view";
import { mergeSearchIntoHref } from "../helpers/link-search";
import { asNodeDetail } from "../helpers/node-detail";
import { useRegisterTopbarNodeActions } from "../hooks/use-register-topbar-node-actions";
import { useReportLoadedNode } from "../hooks/use-report-loaded-node";
import { type NodeDetailProps, registerNodeDetail } from "../node-detail-registry";
import { registerSidePanelTab, type SidePanelTabProps } from "../side-panel-registry";
import { useIsAnonymousVisitor } from "../visitor-context";
import { AssetMediaPreview, isPreviewableAssetMime } from "./assets";
import {
  buildFileTree,
  collectFolderPaths,
  DriveFileTree,
  FILE_TREE_LANGUAGE_BY_EXTENSION,
  guessFileTreeLanguage,
  renderFileTree,
  type SkillTreeNode,
} from "./file-tree-browser";
import { NodeActionsMenu } from "./node-actions-menu";
import { NodeAgentPromptsButton } from "./node-agent-prompts-button";
import { NodePinButton, nodeSidePanelTabId } from "./node-pin-button";
import { NodeSettingsDialog } from "./node-settings-dialog";
import { NodeShareDialog } from "./node-share-button";
import { EmptyState } from "./primitives";
import { FileContentSkeleton, NodeDetailSkeleton } from "./skeletons";
import { SplitSubmitButton } from "./split-submit-button";

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
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<null | "save" | "changeRequest">(null);
  const [fileActionError, setFileActionError] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  const fileTreeQuery = useQuery({
    ...orpc.nodes.get.queryOptions({ input: { nodeId: slug ?? "", type: nodeType } }),
    enabled: Boolean(slug),
  });
  // `nodes.get` is one route for every node type, so narrow to this view's branch.
  const fileTree = asNodeDetail(fileTreeQuery.data, nodeType);
  useReportLoadedNode(fileTree?.node, onNodeLoaded);
  // `enabled: !hideActions` keeps the side-panel preview instance of this
  // same component (rendered with `hideActions`) from ever touching the
  // shared topbar slot that the real page's instance owns.
  useRegisterTopbarNodeActions(
    fileTree ? (
      <>
        <NodeAgentPromptsButton
          metadata={fileTree.node.metadata}
          nodeId={fileTree.node.id}
          nodeName={fileTree.node.name}
          nodeType={nodeType}
        />
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
  }, [slug]);

  const fileQuery = useQuery({
    ...orpc.fileTrees.readFile.queryOptions({
      input: { nodeId: fileTree?.node.id ?? "", filePath: openPath ?? "", type: nodeType },
    }),
    enabled: Boolean(fileTree && openPath),
  });
  const createCr = useMutation(orpc.fileTrees.createChangeRequest.mutationOptions());
  const reviewCr = useMutation(orpc.changeRequests.review.mutationOptions());
  const mergeCr = useMutation(orpc.changeRequests.merge.mutationOptions());

  const tree = useMemo(() => buildFileTree(fileTree?.files ?? []), [fileTree?.files]);
  const expandedFolders = useMemo(() => new Set(collectFolderPaths(tree)), [tree]);
  const filePaths = useMemo(
    () => new Set((fileTree?.files ?? []).map((file) => file.path)),
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
      const changeRequest = await createCr.mutateAsync({
        nodeId: fileTree.node.id,
        type: nodeType,
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
      await reviewCr.mutateAsync({ changeRequestIds: [changeRequest.id], verdict: "approved" });
      await mergeCr.mutateAsync({ changeRequestIds: [changeRequest.id] });
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

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      {/* Single compact toolbar (identity + info trigger, actions) replaces the
          old stacked title-block / properties chrome, giving the file browser
          maximum vertical space — mirrors AirAppDetailView's header pattern.
          Description/properties moved into `NodeSettingsDialog`'s Info tab. */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-border/60 border-b px-3 md:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <span title={nodeTypeLabel}>
            <NodeIcon className="size-4 shrink-0 text-muted-foreground" />
          </span>
          <h1 className="truncate font-medium text-foreground text-sm">{fileTree.node.name}</h1>
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
              nodeId={fileTree.node.id}
              nodeName={fileTree.node.name}
              nodeSlug={fileTree.node.slug}
              nodeType={nodeType}
              onOpenChange={setInfoOpen}
              open={infoOpen}
              orpc={orpc}
            />
          )}
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="min-h-[220px] border-border/60 border-b bg-muted/20 lg:min-h-0 lg:border-r lg:border-b-0">
          <div className="flex h-full min-h-0 flex-col">
            <div className="flex min-h-11 items-center justify-between gap-3 border-border/50 border-b px-4">
              <div className="font-medium text-muted-foreground text-xs uppercase">
                {messages.nodeDetail.files}
              </div>
              <div className="rounded-md border border-border/70 bg-card px-1.5 py-0.5 font-mono text-muted-foreground text-[11px]">
                {fileCount}
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
                  defaultExpanded={expandedFolders}
                  key={fileTree.node.id}
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
            {openPath &&
            fileQuery.data &&
            !fileQuery.isError &&
            fileQuery.data.encoding === "utf8" ? (
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
            ) : fileQuery.data && fileQuery.data.encoding !== "utf8" ? (
              <div className="p-5 text-muted-foreground text-sm">
                {fileQuery.data.assetUrl && isPreviewableAssetMime(fileQuery.data.mimeType) ? (
                  <div className="mb-4 grid max-h-[55vh] place-items-center overflow-hidden rounded-md border bg-muted">
                    <AssetMediaPreview
                      mediaClassName="max-h-[55vh] w-full object-contain"
                      mimeType={fileQuery.data.mimeType}
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
            ) : isEditing ? (
              <textarea
                aria-label={openPath}
                className="min-h-[calc(100vh-15rem)] w-full resize-none border-0 bg-background p-4 font-mono text-sm leading-6 outline-none placeholder:text-muted-foreground"
                onChange={(event) => setDraft(event.target.value)}
                spellCheck={false}
                value={draft}
              />
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
      </div>
    </div>
  );
}

export function SkillDetailView({
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
        notFoundTitle: messages.nodeDetail.skillNotFoundTitle,
        notFoundBody: messages.nodeDetail.skillNotFoundBody,
        selectBody: messages.nodeDetail.selectSkillBody,
        skeletonVariant: "skill",
      }}
      nodeType="skill"
      onNodeLoaded={onNodeLoaded}
      orpc={orpc}
      slug={slug}
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
  const detail = asNodeDetail(fileQuery.data, "file");
  useReportLoadedNode(detail?.node, onNodeLoaded);
  useRegisterTopbarNodeActions(
    detail ? (
      <>
        <NodeAgentPromptsButton
          metadata={detail.node.metadata}
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
  const doc = asNodeDetail(docQuery.data, "doc");
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
          metadata={doc.node.metadata}
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
  const reviewCr = useMutation(orpc.changeRequests.review.mutationOptions());
  const mergeCr = useMutation(orpc.changeRequests.merge.mutationOptions());
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

  // Direct Save: propose + approve + merge in one go (mirrors a Base "Save & Merge").
  const save = async () => {
    setBusy("save");
    setError(null);
    try {
      const changeRequest = await createCr.mutateAsync({
        nodeId: doc.node.id,
        content: { kind: "doc", body: draft },
      });
      await reviewCr.mutateAsync({
        changeRequestIds: [changeRequest.id],
        verdict: "approved",
      });
      await mergeCr.mutateAsync({ changeRequestIds: [changeRequest.id] });
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
  const folder = asNodeDetail(folderQuery.data, "folder");
  useReportLoadedNode(folder?.node, onNodeLoaded);
  useRegisterTopbarNodeActions(
    folder ? (
      <>
        <NodeAgentPromptsButton
          metadata={folder.node.metadata}
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
  const nodeDetail = asNodeDetail(nodeQuery.data, "form");
  const node = nodeDetail?.node ?? (slug ? findNodeBySlug(nodes, "form", slug) : null);
  const formQuery = useQuery({
    ...orpc.forms.getByNode.queryOptions({ input: { nodeId: slug ?? "" } }),
    enabled: Boolean(slug),
    retry: false,
  });
  const form = formQuery.data ?? null;
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
        <NodeAgentPromptsButton
          metadata={node.metadata}
          nodeId={node.id}
          nodeName={node.name}
          nodeType="form"
        />
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
