"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { hasApiKeyLevel } from "busabase-contract/access-control/api-key-level";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import type { AirAppVO } from "busabase-contract/types";
import { CodeBlock } from "kui/ai-elements/code-block";
import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useCoreI18n, useCoreLocale } from "../../../i18n";
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
import {
  FullscreenPreviewSurface,
  PreviewFullscreenButton,
  type PreviewFullscreenState,
  usePreviewFullscreen,
} from "../../dashboard/components/preview-fullscreen";
import { FileContentSkeleton } from "../../dashboard/components/skeletons";
import { useWorkspacePermissionLevel } from "../../dashboard/components/split-submit-button";
import { fileTreeParentPath } from "../../dashboard/helpers/file-tree-files";
import { useIsAnonymousVisitor } from "../../dashboard/visitor-context";

/**
 * A source file remains mounted while it fills the viewport. That preserves
 * selection and scroll position when someone enters or leaves focused reading.
 */
export function AirAppFileViewer({
  children,
  fullscreenState,
  openPath,
}: {
  children: ReactNode;
  fullscreenState: PreviewFullscreenState;
  openPath: string | null;
}) {
  const messages = useCoreI18n();

  return (
    <FullscreenPreviewSurface
      aria-label={openPath ?? messages.nodeDetail.selectFile}
      bodyClassName="min-h-0 min-w-0 flex flex-1 flex-col"
      className="min-w-0 flex-1"
      data-airapp-files-fullscreen={fullscreenState.fullscreen ? "true" : "false"}
      exitLabel={messages.airapp.exitFullscreen}
      fullscreenState={fullscreenState}
      toolbar={
        <div className="flex min-h-11 min-w-0 items-center justify-between gap-3 border-border/60 border-b px-4 py-2">
          <div className="min-w-0 truncate font-mono text-muted-foreground text-xs">
            {openPath ?? messages.nodeDetail.selectFile}
          </div>
          <PreviewFullscreenButton
            available={Boolean(openPath)}
            fullscreenState={fullscreenState}
            label={messages.airapp.enterFullscreen}
          />
        </div>
      }
    >
      <div
        className="min-h-0 min-w-0 flex-1 overflow-auto overscroll-contain"
        data-airapp-file-content
      >
        {children}
      </div>
    </FullscreenPreviewSurface>
  );
}

/** The same file browser is available from detail and pinned Site previews. */
export function AirAppFilesPanel({ orpc, airapp }: { orpc: BusabaseQueryUtils; airapp: AirAppVO }) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const queryClient = useQueryClient();
  const uploadTasks = useFileUploadTasks();
  const isAnonymous = useIsAnonymousVisitor();
  const permissionLevel = useWorkspacePermissionLevel();
  const canUploadFiles = !isAnonymous && hasApiKeyLevel(permissionLevel, "changeRequest");
  const [openPath, setOpenPath] = useState<string | null>(null);
  const filesFullscreenState = usePreviewFullscreen();
  const fileCount = airapp.files.length;
  const nodeId = airapp.node.id;

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the file selection when the owning app changes.
  useEffect(() => {
    setOpenPath(null);
  }, [nodeId]);

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

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
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

      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <AirAppFileViewer fullscreenState={filesFullscreenState} openPath={openPath}>
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
              className="min-h-[calc(100vh-15rem)] min-w-0 !rounded-none !border-0 !bg-transparent [&>div>pre]:min-w-full [&>div>pre]:w-max"
              code={fileQuery.data?.content ?? ""}
              language={guessFileTreeLanguage(openPath)}
              showLineNumbers
            />
          )}
        </AirAppFileViewer>
      </main>
    </div>
  );
}
