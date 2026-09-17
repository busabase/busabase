"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { BusabaseQueryUtils } from "busabase-contract/api-client/react-query";
import { Button } from "kui/button";
import { Progress } from "kui/progress";
import {
  Ban,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  FileText,
  Loader2,
  RotateCcw,
  UploadCloud,
  X,
} from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { useLocation, useSearch } from "wouter";
import { fmt, useCoreI18n, useCoreLocale } from "../../../i18n";
import { presentCoreError } from "../../../i18n/localize-error";
import { fileTreeUploadPath, inferFileTreeMimeType } from "../helpers/file-tree-files";
import {
  canRetryFileUploadTask,
  executeFileUploadBatch,
  type FileUploadTask,
  type FileUploadTaskFile,
  type FileUploadTaskMode,
  getFileUploadBatchProgress,
  isFileUploadAbortError,
  type RuntimeFileUploadBatch,
} from "../helpers/file-upload-task";
import { mergeSearchIntoHref } from "../helpers/link-search";
import { useFileTreeAssetUpload } from "../hooks/use-file-tree-asset-upload";

interface EnqueueFileUploadInput {
  files: File[];
  folder: string;
  mode: FileUploadTaskMode;
  nodeId: string;
  nodeName: string;
  nodeType: "drive" | "skill";
}

interface FileUploadTaskContextValue {
  enqueue: (input: EnqueueFileUploadInput) => string;
  lastCompleted: {
    taskId: string;
    nodeId: string;
    folder: string;
    firstPath: string | null;
    merged: boolean;
  } | null;
}

interface RuntimeUploadTask {
  batch: RuntimeFileUploadBatch;
  controller: AbortController;
  generation: number;
  input: EnqueueFileUploadInput;
}

const FileUploadTaskContext = createContext<FileUploadTaskContextValue | null>(null);

let nextUploadTaskId = 0;

const createUploadTaskId = () => {
  nextUploadTaskId += 1;
  return `file-upload-${Date.now()}-${nextUploadTaskId}`;
};

const isActiveTask = (task: FileUploadTask) =>
  task.status === "queued" || task.status === "uploading" || task.status === "submitting";

export const MERGED_UPLOAD_AUTO_DISMISS_DELAY_MS = 3_000;

export function useAutoDismissMergedUploadTasks(
  tasks: FileUploadTask[],
  onDismiss: (taskId: string) => void,
  delayMs = MERGED_UPLOAD_AUTO_DISMISS_DELAY_MS,
): void {
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const eligibleIds = new Set(
      tasks.filter((task) => task.status === "succeeded" && task.merged).map((task) => task.id),
    );

    for (const [taskId, timer] of timers.current) {
      if (!eligibleIds.has(taskId)) {
        clearTimeout(timer);
        timers.current.delete(taskId);
      }
    }

    for (const taskId of eligibleIds) {
      if (timers.current.has(taskId)) continue;
      timers.current.set(
        taskId,
        setTimeout(() => {
          timers.current.delete(taskId);
          onDismiss(taskId);
        }, delayMs),
      );
    }
  }, [delayMs, onDismiss, tasks]);

  useEffect(
    () => () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
      timers.current.clear();
    },
    [],
  );
}

export function useFileUploadTasks(): FileUploadTaskContextValue {
  const value = useContext(FileUploadTaskContext);
  if (!value) throw new Error("useFileUploadTasks must be used inside FileUploadTaskProvider");
  return value;
}

export function FileUploadTaskProvider({
  children,
  orpc,
}: {
  children: ReactNode;
  orpc: BusabaseQueryUtils;
}) {
  const messages = useCoreI18n();
  const locale = useCoreLocale();
  const queryClient = useQueryClient();
  const uploadAsset = useFileTreeAssetUpload(orpc);
  const createCr = useMutation(orpc.fileTrees.createChangeRequest.mutationOptions());
  const [tasks, setTasks] = useState<FileUploadTask[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [lastCompleted, setLastCompleted] =
    useState<FileUploadTaskContextValue["lastCompleted"]>(null);
  const runtimeTasks = useRef(new Map<string, RuntimeUploadTask>());
  const [, rawSetLocation] = useLocation();
  const currentSearch = useSearch();

  const updateTask = useCallback(
    (taskId: string, update: (task: FileUploadTask) => FileUploadTask) => {
      setTasks((current) => current.map((task) => (task.id === taskId ? update(task) : task)));
    },
    [],
  );

  const updateFile = useCallback(
    (
      taskId: string,
      fileId: string,
      state: Partial<Pick<FileUploadTaskFile, "error" | "progress" | "status">>,
    ) => {
      updateTask(taskId, (task) => ({
        ...task,
        files: task.files.map((file) => (file.id === fileId ? { ...file, ...state } : file)),
      }));
    },
    [updateTask],
  );

  const runTask = useCallback(
    async (taskId: string, generation: number) => {
      const runtime = runtimeTasks.current.get(taskId);
      if (!runtime || runtime.generation !== generation) return;
      const isCurrent = () =>
        runtimeTasks.current.get(taskId)?.generation === generation &&
        !runtime.controller.signal.aborted;
      let submissionStarted = false;

      updateTask(taskId, (task) => ({
        ...task,
        error: null,
        status: "uploading",
        files: task.files.map((file, index) => ({
          ...file,
          error: null,
          progress: runtime.batch.files[index]?.asset ? 100 : 0,
          status: runtime.batch.files[index]?.asset ? "succeeded" : "queued",
        })),
      }));

      try {
        const changeRequest = await executeFileUploadBatch({
          batch: runtime.batch,
          signal: runtime.controller.signal,
          uploadFile: async (file, options) => {
            const result = await uploadAsset(file, options);
            if (!result.assetId) throw new Error(messages.nodeDetail.fileUploadMissingAsset);
            return {
              assetId: result.assetId,
              displayName: file.name,
              mimeType: inferFileTreeMimeType(file.name, file.type),
            };
          },
          submit: (operations) =>
            createCr.mutateAsync({
              autoMerge: runtime.input.mode === "immediate",
              message:
                operations.length === 1
                  ? `Upload ${operations[0]?.path}`
                  : `Upload ${operations.length} files`,
              nodeId: runtime.input.nodeId,
              operations,
              submittedBy: "web-editor",
              type: runtime.input.nodeType,
            }),
          onFileState: (fileId, state) => {
            if (isCurrent()) updateFile(taskId, fileId, state);
          },
          onSubmitting: () => {
            if (isCurrent()) {
              submissionStarted = true;
              updateTask(taskId, (task) => ({
                ...task,
                retryable: false,
                status: "submitting",
              }));
            }
          },
        });
        if (!isCurrent()) return;

        const merged = changeRequest.status === "merged";
        updateTask(taskId, (task) => ({
          ...task,
          changeRequestId: changeRequest.id,
          error: null,
          merged,
          status: "succeeded",
        }));
        setLastCompleted({
          firstPath: runtime.batch.files[0]?.path ?? null,
          folder: runtime.input.folder,
          merged,
          nodeId: runtime.input.nodeId,
          taskId,
        });
        // The task row now has everything needed for display/review. Drop the
        // original File objects immediately so a completed multi-gigabyte batch
        // is not retained for the rest of the workspace session.
        runtimeTasks.current.delete(taskId);
        toast.success(
          merged
            ? messages.nodeDetail.filesUploaded.replace(
                "{count}",
                String(runtime.input.files.length),
              )
            : messages.nodeDetail.uploadTaskReviewReady,
        );

        // Cache refresh is best effort after the server has accepted the one
        // Change Request. A transient refetch failure must not turn a completed
        // task into "Retry", which could submit the same operations twice.
        const invalidations = [
          queryClient.invalidateQueries({ queryKey: orpc.assets.list.key() }),
          queryClient.invalidateQueries({ queryKey: orpc.changeRequests.list.key() }),
          queryClient.invalidateQueries({ queryKey: orpc.changeRequests.counts.key() }),
        ];
        if (merged) {
          invalidations.push(
            queryClient.invalidateQueries({
              queryKey: orpc.nodes.get.queryOptions({
                input: { nodeId: runtime.input.nodeId, type: runtime.input.nodeType },
              }).queryKey,
            }),
          );
        }
        await Promise.allSettled(invalidations);
      } catch (caught) {
        if (runtimeTasks.current.get(taskId)?.generation !== generation) return;
        const cancelled = isFileUploadAbortError(caught) || runtime.controller.signal.aborted;
        const error = cancelled
          ? null
          : submissionStarted
            ? messages.nodeDetail.uploadTaskSubmissionUncertain
            : presentCoreError(messages, locale, caught, messages.nodeDetail.fileUploadFailed);
        updateTask(taskId, (task) => ({
          ...task,
          error,
          retryable: !submissionStarted,
          status: cancelled ? "cancelled" : "failed",
          files: task.files.map((file) =>
            file.status === "failed" || file.status === "cancelled"
              ? { ...file, error }
              : file.status === "queued" ||
                  file.status === "hashing" ||
                  file.status === "uploading" ||
                  file.status === "confirming"
                ? { ...file, error: null, status: cancelled ? "cancelled" : file.status }
                : file,
          ),
        }));
        if (!cancelled) toast.error(error ?? messages.nodeDetail.fileUploadFailed);
      }
    },
    [createCr, locale, messages, orpc, queryClient, updateFile, updateTask, uploadAsset],
  );

  const enqueue = useCallback(
    (input: EnqueueFileUploadInput) => {
      const taskId = createUploadTaskId();
      const runtime: RuntimeUploadTask = {
        batch: {
          files: input.files.map((file, index) => ({
            asset: null,
            file,
            id: `${taskId}-file-${index}`,
            path: fileTreeUploadPath(input.folder, file.name),
          })),
        },
        controller: new AbortController(),
        generation: 1,
        input,
      };
      runtimeTasks.current.set(taskId, runtime);
      setTasks((current) => [
        {
          changeRequestId: null,
          createdAt: Date.now(),
          error: null,
          files: runtime.batch.files.map((item) => ({
            error: null,
            id: item.id,
            name: item.file.name,
            path: item.path,
            progress: 0,
            size: item.file.size,
            status: "queued",
          })),
          folder: input.folder,
          id: taskId,
          merged: false,
          mode: input.mode,
          nodeId: input.nodeId,
          nodeName: input.nodeName,
          nodeType: input.nodeType,
          retryable: true,
          status: "queued",
        },
        ...current,
      ]);
      setExpanded(true);
      void runTask(taskId, runtime.generation);
      return taskId;
    },
    [runTask],
  );

  const cancelTask = useCallback(
    (taskId: string) => {
      const runtime = runtimeTasks.current.get(taskId);
      if (!runtime) return;
      runtime.generation += 1;
      runtime.controller.abort();
      updateTask(taskId, (task) => ({
        ...task,
        error: null,
        status: "cancelled",
        files: task.files.map((file) =>
          file.status === "succeeded"
            ? file
            : { ...file, error: null, status: "cancelled" as const },
        ),
      }));
    },
    [updateTask],
  );

  const retryTask = useCallback(
    (taskId: string) => {
      const runtime = runtimeTasks.current.get(taskId);
      if (!runtime) return;
      runtime.generation += 1;
      runtime.controller = new AbortController();
      void runTask(taskId, runtime.generation);
    },
    [runTask],
  );

  const dismissTask = useCallback((taskId: string) => {
    setTasks((current) => current.filter((task) => task.id !== taskId));
    runtimeTasks.current.delete(taskId);
  }, []);

  useAutoDismissMergedUploadTasks(tasks, dismissTask);

  const reviewTask = useCallback(
    (taskId: string) => {
      const task = tasks.find((candidate) => candidate.id === taskId);
      if (!task?.changeRequestId) return;
      rawSetLocation(mergeSearchIntoHref(`/inbox/${task.changeRequestId}`, currentSearch));
    },
    [currentSearch, rawSetLocation, tasks],
  );

  useEffect(
    () => () => {
      for (const runtime of runtimeTasks.current.values()) runtime.controller.abort();
      runtimeTasks.current.clear();
    },
    [],
  );

  const value = useMemo(() => ({ enqueue, lastCompleted }), [enqueue, lastCompleted]);

  return (
    <FileUploadTaskContext.Provider value={value}>
      {children}
      <FileUploadTaskPanel
        expanded={expanded}
        onCancel={cancelTask}
        onDismiss={dismissTask}
        onExpandedChange={setExpanded}
        onRetry={retryTask}
        onReview={reviewTask}
        tasks={tasks}
      />
    </FileUploadTaskContext.Provider>
  );
}

export function FileUploadTaskPanel({
  expanded,
  onCancel,
  onDismiss,
  onExpandedChange,
  onRetry,
  onReview,
  tasks,
}: {
  expanded: boolean;
  onCancel: (taskId: string) => void;
  onDismiss: (taskId: string) => void;
  onExpandedChange: (expanded: boolean) => void;
  onRetry: (taskId: string) => void;
  onReview: (taskId: string) => void;
  tasks: FileUploadTask[];
}) {
  const messages = useCoreI18n();
  if (tasks.length === 0) return null;
  const activeCount = tasks.filter(isActiveTask).length;

  const taskStatus = (task: FileUploadTask): string => {
    switch (task.status) {
      case "queued":
        return messages.nodeDetail.uploadTaskQueued;
      case "uploading":
        return messages.nodeDetail.uploadTaskUploading;
      case "submitting":
        return messages.nodeDetail.uploadTaskSubmitting;
      case "succeeded":
        return task.merged
          ? messages.nodeDetail.uploadTaskCompleted
          : messages.nodeDetail.uploadTaskReviewReady;
      case "failed":
        return messages.nodeDetail.uploadTaskFailed;
      case "cancelled":
        return messages.nodeDetail.uploadTaskCancelled;
    }
  };

  const fileStatus = (file: FileUploadTaskFile): string => {
    switch (file.status) {
      case "queued":
        return messages.nodeDetail.uploadTaskFileQueued;
      case "hashing":
        return messages.nodeDetail.uploadTaskFileHashing;
      case "uploading":
        return `${messages.nodeDetail.uploadTaskFileUploading} ${file.progress}%`;
      case "confirming":
        return messages.nodeDetail.uploadTaskFileConfirming;
      case "succeeded":
        return messages.nodeDetail.uploadTaskFileCompleted;
      case "failed":
        return messages.nodeDetail.uploadTaskFileFailed;
      case "cancelled":
        return messages.nodeDetail.uploadTaskFileCancelled;
    }
  };

  return (
    <aside
      aria-label={messages.nodeDetail.uploadTasks}
      className="fixed right-4 bottom-4 z-50 w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-border bg-popover text-popover-foreground shadow-lg sm:w-96"
      data-file-upload-task-panel
    >
      <div className="flex min-h-11 items-center gap-2 px-3">
        <UploadCloud aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 font-medium text-sm">
          {messages.nodeDetail.uploadTasks}
          {activeCount > 0 ? (
            <span className="ml-2 text-muted-foreground tabular-nums">{activeCount}</span>
          ) : null}
        </div>
        <Button
          aria-label={
            expanded
              ? messages.nodeDetail.collapseUploadTasks
              : messages.nodeDetail.expandUploadTasks
          }
          className="size-8 text-muted-foreground"
          onClick={() => onExpandedChange(!expanded)}
          size="icon-sm"
          title={
            expanded
              ? messages.nodeDetail.collapseUploadTasks
              : messages.nodeDetail.expandUploadTasks
          }
          type="button"
          variant="ghost"
        >
          {expanded ? (
            <ChevronDown aria-hidden className="size-4" />
          ) : (
            <ChevronUp aria-hidden className="size-4" />
          )}
        </Button>
      </div>
      {expanded ? (
        <div className="max-h-[min(65dvh,32rem)] overflow-y-auto border-border/60 border-t">
          {tasks.map((task) => {
            const progress = getFileUploadBatchProgress(task);
            const completed = task.files.filter((file) => file.status === "succeeded").length;
            return (
              <section
                className="border-border/60 border-b px-3 py-3 last:border-b-0"
                data-file-upload-task={task.status}
                key={task.id}
              >
                <div className="flex items-start gap-2">
                  {task.status === "uploading" || task.status === "submitting" ? (
                    <Loader2
                      aria-hidden
                      className="mt-0.5 size-4 shrink-0 animate-spin text-muted-foreground"
                    />
                  ) : task.status === "succeeded" ? (
                    <CheckCircle2
                      aria-hidden
                      className="mt-0.5 size-4 shrink-0 text-accepted-strong"
                    />
                  ) : task.status === "failed" ? (
                    <CircleAlert
                      aria-hidden
                      className="mt-0.5 size-4 shrink-0 text-rejected-strong"
                    />
                  ) : task.status === "cancelled" ? (
                    <Ban aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <UploadCloud
                      aria-hidden
                      className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-sm">{task.nodeName}</div>
                    <div
                      aria-atomic="true"
                      aria-live="polite"
                      className="text-muted-foreground text-xs"
                    >
                      {taskStatus(task)}
                    </div>
                  </div>
                  {!isActiveTask(task) ? (
                    <Button
                      aria-label={messages.nodeDetail.dismissUploadTask}
                      className="size-7 shrink-0 text-muted-foreground"
                      onClick={() => onDismiss(task.id)}
                      size="icon-sm"
                      title={messages.nodeDetail.dismissUploadTask}
                      type="button"
                      variant="ghost"
                    >
                      <X aria-hidden className="size-3.5" />
                    </Button>
                  ) : null}
                </div>

                <div className="mt-2 space-y-1">
                  <Progress
                    aria-label={fmt(messages.nodeDetail.uploadTaskBatchProgress, {
                      progress,
                    })}
                    className="h-1.5"
                    value={progress}
                  />
                  <div className="flex justify-between gap-3 text-muted-foreground text-xs tabular-nums">
                    <span>
                      {fmt(messages.nodeDetail.uploadTaskFilesProgress, {
                        completed,
                        count: task.files.length,
                      })}
                    </span>
                    <span>{progress}%</span>
                  </div>
                </div>

                <ul className="mt-2 divide-y divide-border/40 border-border/50 border-y">
                  {task.files.map((file) => (
                    <li className="flex min-h-10 items-center gap-2 py-1.5" key={file.id}>
                      <FileText aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs">{file.name}</div>
                        <div className="text-muted-foreground text-[11px]">{fileStatus(file)}</div>
                        {file.status === "uploading" ? (
                          <Progress
                            aria-label={fmt(messages.nodeDetail.uploadTaskFileProgress, {
                              name: file.name,
                              progress: file.progress,
                            })}
                            className="mt-1 h-1"
                            value={file.progress}
                          />
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>

                {task.error ? (
                  <p className="mt-2 text-rejected-strong text-xs dark:text-rejected-soft">
                    {task.error}
                  </p>
                ) : null}

                <div className="mt-2 flex justify-end gap-2">
                  {task.status === "queued" || task.status === "uploading" ? (
                    <Button
                      className="h-8"
                      onClick={() => onCancel(task.id)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <Ban aria-hidden className="size-3.5" />
                      {messages.nodeDetail.cancelUploadTask}
                    </Button>
                  ) : null}
                  {canRetryFileUploadTask(task) ? (
                    <Button
                      className="h-8"
                      onClick={() => onRetry(task.id)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <RotateCcw aria-hidden className="size-3.5" />
                      {messages.nodeDetail.retryUploadTask}
                    </Button>
                  ) : null}
                  {task.status === "succeeded" && !task.merged && task.changeRequestId ? (
                    <Button
                      className="h-8"
                      onClick={() => onReview(task.id)}
                      size="sm"
                      type="button"
                    >
                      {messages.nodeDetail.reviewUploadTask}
                    </Button>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>
      ) : null}
    </aside>
  );
}
