"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { hasApiKeyLevel } from "busabase-contract/access-control/api-key-level";
import { CodeBlock } from "kui/ai-elements/code-block";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "kui/tabs";
import { Files, MonitorPlay, Terminal } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { presentCoreError } from "../../../i18n/localize-error";
import { AssetMediaPreview, isPreviewableAssetMime } from "../../dashboard/components/assets";
import {
  buildFileTree,
  collectFolderPaths,
  DriveFileTree,
  guessFileTreeLanguage,
  renderFileTree,
} from "../../dashboard/components/file-tree-browser";
import { FileTreeUploadControl } from "../../dashboard/components/file-tree-file-actions";
import { useFileUploadTasks } from "../../dashboard/components/file-upload-tasks";
import { NodeActionsMenu } from "../../dashboard/components/node-actions-menu";
import { NodeAgentPromptsButton } from "../../dashboard/components/node-agent-prompts-button";
import {
  PREVIEW_DETAIL_TAB_LIST_CLASS,
  PREVIEW_DETAIL_TAB_TRIGGER_CLASS,
} from "../../dashboard/components/preview-fullscreen";
import { EmptyState } from "../../dashboard/components/primitives";
import { FileContentSkeleton, NodeDetailSkeleton } from "../../dashboard/components/skeletons";
import { useWorkspacePermissionLevel } from "../../dashboard/components/split-submit-button";
import { fileTreeParentPath } from "../../dashboard/helpers/file-tree-files";
import { asNodeDetail } from "../../dashboard/helpers/node-detail";
import { useRegisterTopbarNodeActions } from "../../dashboard/hooks/use-register-topbar-node-actions";
import { useRegisterTopbarNodeInfo } from "../../dashboard/hooks/use-register-topbar-node-info";
import { useReportLoadedNode } from "../../dashboard/hooks/use-report-loaded-node";
import type { NodeDetailProps } from "../../dashboard/node-detail-registry";
import { useIsAnonymousVisitor } from "../../dashboard/visitor-context";
import { disposeDeletedAirAppSession } from "../store/airapp-session-cleanup";
import { useAirAppKeepAliveActive, useAirAppKeepAliveScope } from "./AirAppKeepAliveHost";
import {
  AirAppRunControls,
  AirAppRunLogs,
  AirAppRunPreview,
  useAirAppFullscreen,
  useAirAppRunner,
} from "./RunPanel";

/** Keeps forceMount'd inactive tab panels out of the layout flow without
 *  unmounting them — unmounting the "App" tab would dispose the live Nodepod
 *  runner every time the user switched to Files or Logs. */
const TAB_CONTENT_CLASS =
  "mt-0 flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden data-[state=inactive]:pointer-events-none";

/**
 * AirApp node detail: a single compact toolbar (identity + tab switcher + run
 * controls) over a tabbed layout, so the AirApp content — especially the live
 * preview — gets maximum vertical space. "App" (default) is the live run
 * preview iframe, since the primary thing a user wants when opening an AirApp
 * is to see it working; the Run button lives in the toolbar. "Files" is the
 * file-tree browser with reviewable uploads. "Logs" is the streaming install/start console.
 * All three tabs stay mounted (forceMount + CSS hide) so switching away from
 * "App" never tears down the running dev server. HEAD-only: previewing a
 * pending (unmerged) ChangeRequest's file snapshot is out of scope for V1
 * (see the airapp changelog's Follow-up Tasks).
 */
export function AirAppDetailView({ orpc, slug, onNodeLoaded }: NodeDetailProps) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const queryClient = useQueryClient();
  const uploadTasks = useFileUploadTasks();
  const isAnonymous = useIsAnonymousVisitor();
  const permissionLevel = useWorkspacePermissionLevel();
  const canUploadFiles = !isAnonymous && hasApiKeyLevel(permissionLevel, "changeRequest");
  const keepAliveScopeKey = useAirAppKeepAliveScope();
  const isKeepAliveActive = useAirAppKeepAliveActive();
  const [openPath, setOpenPath] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState("app");
  const fullscreenState = useAirAppFullscreen({ syncWithUrl: isKeepAliveActive });

  const airappQuery = useQuery({
    ...orpc.nodes.get.queryOptions({ input: { nodeId: slug ?? "", type: "airapp" } }),
    enabled: Boolean(slug),
  });
  // `nodes.get` is one route for every node type, so narrow to the AirApp branch.
  const airapp = asNodeDetail(airappQuery.isError ? undefined : airappQuery.data, "airapp");
  useReportLoadedNode(airapp?.node, onNodeLoaded);

  // Reset the open file when switching airapp nodes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only on slug change
  useEffect(() => {
    setOpenPath(null);
  }, [slug]);

  const fileQuery = useQuery({
    ...orpc.fileTrees.readFile.queryOptions({
      input: { nodeId: airapp?.node.id ?? "", filePath: openPath ?? "", type: "airapp" },
    }),
    enabled: Boolean(airapp && openPath),
  });

  const tree = useMemo(() => buildFileTree(airapp?.files ?? []), [airapp?.files]);
  const expandedFolders = useMemo(() => new Set(collectFolderPaths(tree)), [tree]);
  const filePaths = useMemo(
    () => new Set((airapp?.files ?? []).map((file) => file.path)),
    [airapp?.files],
  );

  const uploadFiles = async (
    files: File[],
    folder: string,
    mode: "changeRequest" | "immediate",
    replacePaths: string[],
  ) => {
    if (!airapp || !canUploadFiles) return;
    const existingFiles = await Promise.all(
      replacePaths.map((filePath) =>
        queryClient.fetchQuery(
          orpc.fileTrees.readFile.queryOptions({
            input: { nodeId: airapp.node.id, filePath, type: "airapp" },
          }),
        ),
      ),
    );
    const replace = new Map(
      replacePaths.map((path, index) => [path, existingFiles[index]?.contentHash || null] as const),
    );
    uploadTasks.enqueue({
      files,
      folder,
      mode,
      nodeId: airapp.node.id,
      nodeName: airapp.node.name,
      nodeType: "airapp",
      ...(replace.size > 0 ? { replace } : {}),
    });
  };

  useEffect(() => {
    if (!airapp || openPath) {
      return;
    }
    const entryFile =
      airapp.files.find((file) => file.path === airapp.entryFile) ?? airapp.files[0];
    if (entryFile) {
      setOpenPath(entryFile.path);
    }
  }, [airapp, openPath]);

  const selectFile = useCallback(
    (path: string) => {
      // FileTreeFolder also fires onSelect; only react to real files.
      if (filePaths.has(path)) {
        setOpenPath(path);
      }
    },
    [filePaths],
  );

  // Always called (before the early-return below) so hook order stays stable
  // across renders; the hook itself is a no-op while `airapp` is null.
  const runner = useAirAppRunner({ orpc, airapp });

  // `enabled: isKeepAliveActive` matters here specifically because
  // `AirAppKeepAliveHost` keeps every visited AirApp's detail view mounted
  // (CSS-hidden) after the user navigates away, so a backgrounded instance
  // must stop re-registering its actions once it's no longer the visible
  // one, or it would keep clobbering whatever page the user is actually on.
  useRegisterTopbarNodeActions(
    airapp ? (
      <>
        <AirAppRunControls airapp={airapp} fullscreenState={fullscreenState} runner={runner} />
        <NodeAgentPromptsButton
          orpc={orpc}
          nodeId={airapp.node.id}
          nodeName={airapp.node.name}
          nodeType="airapp"
        />
        <NodeActionsMenu
          nodeId={airapp.node.id}
          nodeName={airapp.node.name}
          nodeSlug={airapp.node.slug}
          nodeType="airapp"
          onDeleted={() =>
            disposeDeletedAirAppSession({
              keepAliveScopeKey,
              nodeId: airapp.node.id,
              routeSlug: slug ?? airapp.node.slug,
            })
          }
          orpc={orpc}
        />
      </>
    ) : null,
    isKeepAliveActive,
  );
  useRegisterTopbarNodeInfo(
    airapp
      ? {
          description: airapp.node.description,
          nodeId: airapp.node.id,
          nodeName: airapp.node.name,
          nodeSlug: airapp.node.slug,
          nodeType: "airapp",
          orpc,
        }
      : null,
    isKeepAliveActive,
  );

  if (!airapp) {
    return airappQuery.isLoading ? (
      <NodeDetailSkeleton variant="skill" />
    ) : (
      <EmptyState
        title={messages.nodeDetail.airappNotFoundTitle}
        body={
          slug
            ? fmt(messages.nodeDetail.airappNotFoundBody, { slug })
            : messages.nodeDetail.selectAirappBody
        }
      />
    );
  }

  const fileCount = airapp.files.length;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-background">
      {/* Node identity (name, description, Info dialog) lives in the shared
          topbar; this header carries only the local view switcher. */}
      {/* Controlled so entering fullscreen can force the "App" panel active:
          inactive panels are CSS-hidden, and the preview iframe we grow to
          fill the viewport lives inside that panel. */}
      <Tabs
        className="flex min-h-0 flex-1 flex-col"
        onValueChange={setSelectedTab}
        value={fullscreenState.fullscreen ? "app" : selectedTab}
      >
        <header className="shrink-0 border-border/60 border-b px-4 py-2 md:px-6">
          <TabsList className={PREVIEW_DETAIL_TAB_LIST_CLASS}>
            <TabsTrigger className={PREVIEW_DETAIL_TAB_TRIGGER_CLASS} value="app">
              <MonitorPlay className="size-3.5" />
              {messages.airapp.tabPreview}
            </TabsTrigger>
            <TabsTrigger className={PREVIEW_DETAIL_TAB_TRIGGER_CLASS} value="files">
              <Files className="size-3.5" />
              {messages.airapp.tabFiles}
            </TabsTrigger>
            <TabsTrigger className={PREVIEW_DETAIL_TAB_TRIGGER_CLASS} value="logs">
              <Terminal className="size-3.5" />
              {messages.airapp.tabLogs}
            </TabsTrigger>
          </TabsList>
        </header>

        <TabsContent className={TAB_CONTENT_CLASS} forceMount value="app">
          <AirAppRunPreview
            airapp={airapp}
            fullscreenState={fullscreenState}
            runner={runner}
            showToolbar={false}
          />
        </TabsContent>

        <TabsContent className={TAB_CONTENT_CLASS} forceMount value="files">
          <div className="flex min-h-0 flex-1 flex-col md:flex-row">
            <aside className="min-h-[220px] shrink-0 border-border/60 border-b bg-muted/20 md:min-h-0 md:w-[260px] md:border-r md:border-b-0">
              <div className="flex h-full min-h-0 flex-col">
                <div className="flex min-h-11 items-center justify-between gap-3 border-border/50 border-b px-4">
                  <div className="font-medium text-muted-foreground text-xs uppercase">
                    {messages.nodeDetail.files}
                  </div>
                  <div className="flex items-center gap-1">
                    {canUploadFiles ? (
                      <FileTreeUploadControl
                        availableFolders={collectFolderPaths(tree)}
                        defaultAction="changeRequest"
                        defaultFolder={openPath ? fileTreeParentPath(openPath) : ""}
                        existingPaths={filePaths}
                        labels={{
                          root: messages.airapp.filesRoot,
                          duplicateUploadNames: messages.airapp.duplicateUploadNames,
                          invalidFilePath: messages.airapp.invalidFilePath,
                          invalidUploadFileName: messages.airapp.invalidUploadFileName,
                        }}
                        onSubmit={uploadFiles}
                      />
                    ) : null}
                    <div className="rounded-md border border-border/70 bg-card px-1.5 py-0.5 font-mono text-muted-foreground text-[11px]">
                      {fileCount}
                    </div>
                  </div>
                </div>
                {canUploadFiles ? (
                  <p className="border-border/50 border-b px-4 py-2 text-muted-foreground text-xs">
                    {messages.airapp.filesUploadHint}
                  </p>
                ) : null}
                <div className="min-h-0 flex-1 overflow-auto p-2">
                  {airapp.files.length === 0 ? (
                    <div className="px-2 py-3 text-muted-foreground text-sm">
                      {messages.nodeDetail.noFilesYet}
                    </div>
                  ) : (
                    <DriveFileTree
                      className="rounded-none border-0 bg-transparent font-sans text-[13px]"
                      defaultExpanded={expandedFolders}
                      key={airapp.node.id}
                      onSelect={selectFile}
                      selectedPath={openPath ?? undefined}
                    >
                      {renderFileTree(tree)}
                    </DriveFileTree>
                  )}
                </div>
              </div>
            </aside>

            <main className="flex min-h-0 flex-1 flex-col">
              <div className="flex min-h-11 items-center border-border/60 border-b px-4 py-2">
                <div className="min-w-0 truncate font-mono text-muted-foreground text-xs">
                  {openPath ?? messages.nodeDetail.selectFile}
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto">
                {!openPath ? (
                  <div className="grid h-full min-h-[320px] place-items-center p-8 text-center text-muted-foreground text-sm">
                    {messages.nodeDetail.selectFile}
                  </div>
                ) : fileQuery.isLoading ? (
                  <FileContentSkeleton />
                ) : fileQuery.isError ? (
                  <div className="border-border/60 border-b bg-destructive/5 p-4 text-destructive text-sm">
                    {presentCoreError(
                      messages,
                      locale,
                      fileQuery.error,
                      messages.nodeDetail.couldNotReadFile,
                    )}
                  </div>
                ) : fileQuery.data &&
                  fileQuery.data.encoding !== "utf8" &&
                  fileQuery.data.assetUrl &&
                  isPreviewableAssetMime(fileQuery.data.mimeType) ? (
                  <div className="grid h-full min-h-[320px] place-items-center overflow-hidden p-4">
                    <AssetMediaPreview
                      mediaClassName="max-h-[65vh] w-full object-contain"
                      mimeType={fileQuery.data.mimeType}
                      name={fileQuery.data.displayName ?? openPath}
                      url={fileQuery.data.assetUrl}
                    />
                  </div>
                ) : fileQuery.data && fileQuery.data.encoding !== "utf8" ? (
                  <div className="p-5 text-muted-foreground text-sm">
                    {messages.nodeDetail.assetFilePreview}
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
          </div>
        </TabsContent>

        <TabsContent className={TAB_CONTENT_CLASS} forceMount value="logs">
          <AirAppRunLogs runner={runner} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
