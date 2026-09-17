import { describe, expect, it, vi } from "vitest";
import {
  canRetryFileUploadTask,
  createFileUploadAbortError,
  executeFileUploadBatch,
  type FileUploadAsset,
  type FileUploadTask,
  getFileUploadBatchProgress,
  getFileUploadFolderSegments,
  type RuntimeFileUploadBatch,
} from "./file-upload-task";

const fakeFile = (name: string, size: number): File =>
  ({ lastModified: 1, name, size, type: "text/plain" }) as File;

const assetFor = (file: File): FileUploadAsset => ({
  assetId: `asset-${file.name}`,
  displayName: file.name,
  mimeType: file.type,
});

describe("executeFileUploadBatch", () => {
  it("retries only unfinished files and submits one complete operation batch", async () => {
    const batch: RuntimeFileUploadBatch = {
      files: [
        { asset: null, file: fakeFile("first.txt", 10), id: "first", path: "docs/first.txt" },
        { asset: null, file: fakeFile("second.txt", 20), id: "second", path: "docs/second.txt" },
      ],
    };
    let secondAttempts = 0;
    const uploadFile = vi.fn(async (file: File) => {
      if (file.name === "second.txt" && secondAttempts++ === 0) {
        throw new Error("temporary failure");
      }
      return assetFor(file);
    });
    const submit = vi.fn().mockResolvedValue({ id: "cr-1" });
    const onFileState = vi.fn();

    await expect(
      executeFileUploadBatch({
        batch,
        signal: new AbortController().signal,
        uploadFile,
        submit,
        onFileState,
        onSubmitting: vi.fn(),
      }),
    ).rejects.toThrow("temporary failure");

    expect(batch.files[0]?.asset?.assetId).toBe("asset-first.txt");
    expect(batch.files[1]?.asset).toBeNull();
    expect(submit).not.toHaveBeenCalled();

    await executeFileUploadBatch({
      batch,
      signal: new AbortController().signal,
      uploadFile,
      submit,
      onFileState,
      onSubmitting: vi.fn(),
    });

    expect(uploadFile.mock.calls.map(([file]) => file.name)).toEqual([
      "first.txt",
      "second.txt",
      "second.txt",
    ]);
    expect(submit).toHaveBeenCalledTimes(1);
    expect(submit).toHaveBeenCalledWith([
      {
        assetId: "asset-first.txt",
        displayName: "first.txt",
        kind: "create",
        mimeType: "text/plain",
        path: "docs/first.txt",
      },
      {
        assetId: "asset-second.txt",
        displayName: "second.txt",
        kind: "create",
        mimeType: "text/plain",
        path: "docs/second.txt",
      },
    ]);
  });

  it("stops before submission when the active upload is cancelled", async () => {
    const controller = new AbortController();
    const submit = vi.fn();
    const uploadFile = vi.fn(
      async (_file: File, { signal }: { signal: AbortSignal }) =>
        new Promise<FileUploadAsset>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(createFileUploadAbortError()), {
            once: true,
          });
        }),
    );
    const promise = executeFileUploadBatch({
      batch: {
        files: [
          { asset: null, file: fakeFile("cancel.txt", 10), id: "cancel", path: "cancel.txt" },
        ],
      },
      signal: controller.signal,
      uploadFile,
      submit,
      onFileState: vi.fn(),
      onSubmitting: vi.fn(),
    });

    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(submit).not.toHaveBeenCalled();
  });
});

describe("getFileUploadBatchProgress", () => {
  const task = (overrides: Partial<FileUploadTask> = {}): FileUploadTask => ({
    changeRequestId: null,
    createdAt: 1,
    error: null,
    files: [
      {
        error: null,
        id: "small",
        name: "small.txt",
        path: "small.txt",
        progress: 100,
        size: 10,
        status: "succeeded",
      },
      {
        error: null,
        id: "large",
        name: "large.txt",
        path: "large.txt",
        progress: 50,
        size: 90,
        status: "uploading",
      },
    ],
    folder: "",
    id: "task",
    merged: false,
    mode: "immediate",
    nodeId: "drive",
    nodeName: "Drive",
    nodeType: "drive",
    retryable: true,
    status: "uploading",
    ...overrides,
  });

  it("weights byte progress and reserves completion for CR submission", () => {
    expect(getFileUploadBatchProgress(task())).toBe(52);
    expect(getFileUploadBatchProgress(task({ status: "submitting" }))).toBe(95);
    expect(getFileUploadBatchProgress(task({ status: "succeeded" }))).toBe(100);
  });
});

describe("canRetryFileUploadTask", () => {
  const failed = (): FileUploadTask => ({
    changeRequestId: null,
    createdAt: 1,
    error: "failed",
    files: [],
    folder: "",
    id: "task",
    merged: false,
    mode: "immediate",
    nodeId: "drive",
    nodeName: "Drive",
    nodeType: "drive",
    retryable: true,
    status: "failed",
  });

  it("allows retry only before Change Request submission has started", () => {
    expect(canRetryFileUploadTask(failed())).toBe(true);
    expect(canRetryFileUploadTask({ ...failed(), retryable: false })).toBe(false);
    expect(canRetryFileUploadTask({ ...failed(), status: "succeeded" })).toBe(false);
  });
});

describe("getFileUploadFolderSegments", () => {
  it("expands every parent when a background upload completes in a nested folder", () => {
    expect(getFileUploadFolderSegments("campaigns/launch/images")).toEqual([
      "campaigns",
      "campaigns/launch",
      "campaigns/launch/images",
    ]);
    expect(getFileUploadFolderSegments("")).toEqual([]);
  });
});
