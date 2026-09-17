export type FileUploadTaskMode = "changeRequest" | "immediate";

export type FileUploadTaskStatus =
  | "queued"
  | "uploading"
  | "submitting"
  | "succeeded"
  | "failed"
  | "cancelled";

export type FileUploadTaskFileStatus =
  | "queued"
  | "hashing"
  | "uploading"
  | "confirming"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface FileUploadAsset {
  assetId: string;
  displayName: string;
  mimeType: string;
}

export interface FileUploadTaskFile {
  id: string;
  name: string;
  path: string;
  size: number;
  progress: number;
  status: FileUploadTaskFileStatus;
  error: string | null;
}

export interface FileUploadTask {
  id: string;
  nodeId: string;
  nodeName: string;
  nodeType: "drive" | "skill";
  folder: string;
  mode: FileUploadTaskMode;
  status: FileUploadTaskStatus;
  files: FileUploadTaskFile[];
  error: string | null;
  changeRequestId: string | null;
  merged: boolean;
  retryable: boolean;
  createdAt: number;
}

export interface RuntimeFileUpload {
  id: string;
  file: File;
  path: string;
  asset: FileUploadAsset | null;
}

export interface RuntimeFileUploadBatch {
  files: RuntimeFileUpload[];
}

export interface FileUploadOperation {
  assetId: string;
  displayName: string;
  kind: "create";
  mimeType: string;
  path: string;
}

interface ExecuteFileUploadBatchOptions<TSubmission> {
  batch: RuntimeFileUploadBatch;
  signal: AbortSignal;
  uploadFile: (
    file: File,
    options: {
      signal: AbortSignal;
      onPhase: (phase: "hashing" | "uploading" | "confirming") => void;
      onProgress: (progress: number) => void;
    },
  ) => Promise<FileUploadAsset>;
  submit: (operations: FileUploadOperation[]) => Promise<TSubmission>;
  onFileState: (
    fileId: string,
    state: Partial<Pick<FileUploadTaskFile, "error" | "progress" | "status">>,
  ) => void;
  onSubmitting: () => void;
}

export const createFileUploadAbortError = (): Error => {
  if (typeof DOMException !== "undefined") {
    return new DOMException("Upload cancelled", "AbortError");
  }
  const error = new Error("Upload cancelled");
  error.name = "AbortError";
  return error;
};

export const isFileUploadAbortError = (error: unknown): boolean =>
  error instanceof Error && error.name === "AbortError";

export const throwIfFileUploadAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw createFileUploadAbortError();
};

/**
 * Uploads only files that do not already have a confirmed Asset, then submits
 * one operation batch. The runtime batch deliberately keeps successful Asset
 * references after an error or cancellation, so Retry never spends those
 * uploads again and still creates exactly one Change Request for the batch.
 */
export async function executeFileUploadBatch<TSubmission>({
  batch,
  signal,
  uploadFile,
  submit,
  onFileState,
  onSubmitting,
}: ExecuteFileUploadBatchOptions<TSubmission>): Promise<TSubmission> {
  for (const item of batch.files) {
    throwIfFileUploadAborted(signal);
    if (item.asset) {
      onFileState(item.id, { error: null, progress: 100, status: "succeeded" });
      continue;
    }

    onFileState(item.id, { error: null, progress: 0, status: "hashing" });
    try {
      const asset = await uploadFile(item.file, {
        signal,
        onPhase: (status) => onFileState(item.id, { status }),
        onProgress: (progress) => onFileState(item.id, { progress }),
      });
      throwIfFileUploadAborted(signal);
      item.asset = asset;
      onFileState(item.id, { error: null, progress: 100, status: "succeeded" });
    } catch (error) {
      onFileState(item.id, {
        status: isFileUploadAbortError(error) ? "cancelled" : "failed",
      });
      throw error;
    }
  }

  throwIfFileUploadAborted(signal);
  onSubmitting();
  return submit(
    batch.files.map((item) => {
      if (!item.asset) throw new Error(`Missing uploaded Asset for ${item.path}`);
      return {
        assetId: item.asset.assetId,
        displayName: item.asset.displayName,
        kind: "create",
        mimeType: item.asset.mimeType,
        path: item.path,
      };
    }),
  );
}

export const getFileUploadBatchProgress = (task: FileUploadTask): number => {
  if (task.status === "succeeded") return 100;
  if (task.status === "submitting") return 95;
  const totalBytes = task.files.reduce((total, file) => total + Math.max(file.size, 1), 0);
  if (totalBytes === 0) return 0;
  const uploadedBytes = task.files.reduce(
    (total, file) => total + Math.max(file.size, 1) * (file.progress / 100),
    0,
  );
  // Reserve the final 5% for the single Change Request submission.
  return Math.round((uploadedBytes / totalBytes) * 95);
};

export const getFileUploadFolderSegments = (folder: string): string[] => {
  const segments = folder.split("/").filter(Boolean);
  return segments.map((_, index) => segments.slice(0, index + 1).join("/"));
};

export const canRetryFileUploadTask = (task: FileUploadTask): boolean =>
  task.retryable && (task.status === "failed" || task.status === "cancelled");
