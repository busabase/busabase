import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  generateUploadPresignedUrl,
  createMultipartUploadMock,
  getUploadPartPresignedUrl,
  completeMultipartUploadMock,
  listMultipartPartsMock,
  abortMultipartUploadMock,
  getObjectMetadata,
  deleteObject,
} = vi.hoisted(() => ({
  generateUploadPresignedUrl: vi.fn(),
  createMultipartUploadMock: vi.fn(),
  getUploadPartPresignedUrl: vi.fn(),
  completeMultipartUploadMock: vi.fn(),
  listMultipartPartsMock: vi.fn(),
  abortMultipartUploadMock: vi.fn(),
  getObjectMetadata: vi.fn(),
  deleteObject: vi.fn(),
}));

vi.mock("openlib/nanoid", () => ({ generateNanoID: () => "test-id" }));
vi.mock("openlib/storage", () => ({
  extractFileExtension: (fileName: string) => fileName.split(".").at(-1) ?? "",
  storage: {
    generateUploadPresignedUrl,
    getPublicUrl: (storageKey: string) => `/api/attachment/${storageKey}`,
    createMultipartUpload: createMultipartUploadMock,
    getUploadPartPresignedUrl,
    completeMultipartUpload: completeMultipartUploadMock,
    listMultipartParts: listMultipartPartsMock,
    abortMultipartUpload: abortMultipartUploadMock,
    getObjectMetadata,
    deleteObject,
  },
}));

import { attachments } from "../schema/attachments";
import { getFileTooLargeErrorData } from "../utils/file-size";
import {
  type AttachmentObjectLifecycle,
  type AttachmentUploadPolicy,
  abortMultipartUpload,
  type ConfirmUploadInput,
  completeMultipartUpload,
  confirmUpload,
  createMultipartUpload,
  MAX_FILE_SIZE,
  requestUploadUrl,
  runWithAttachmentObjectLifecycle,
  runWithAttachmentUploadPolicy,
  runWithoutAttachmentUploadPolicy,
  signMultipartUploadParts,
} from "./upload-logic";

const MB = 1024 * 1024;
const GB = 1024 * MB;

const request = (sizeBytes: number, maxFileSize?: number) =>
  requestUploadUrl(
    {
      fileName: "archive.zip",
      mimeType: "application/zip",
      sizeBytes,
      context: "record",
    },
    "user-1",
    undefined,
    undefined,
    maxFileSize === undefined ? undefined : { maxFileSize },
  );

describe("requestUploadUrl size policy", () => {
  beforeEach(() => {
    generateUploadPresignedUrl.mockReset();
    generateUploadPresignedUrl.mockResolvedValue("https://storage.example/upload");
  });

  it("accepts files above the former 200MB limit and through 5GB", async () => {
    expect(MAX_FILE_SIZE).toBe(5 * GB);

    await expect(request(26 * MB)).resolves.toMatchObject({ expiresIn: 3600 });
    await expect(request(200 * MB + 1)).resolves.toMatchObject({ expiresIn: 3600 });
    await expect(request(5 * GB)).resolves.toMatchObject({ expiresIn: 3600 });
    expect(generateUploadPresignedUrl).toHaveBeenCalledTimes(3);
  });

  it("rejects files above 5GB before creating an upload URL, with a structured error", async () => {
    const rejection = await request(5 * GB + 1).catch((error: unknown) => error);
    expect(rejection).toMatchObject({
      code: "PAYLOAD_TOO_LARGE",
      message: "File size exceeds the maximum allowed size of 5 GB",
    });
    expect(getFileTooLargeErrorData(rejection)).toEqual({
      code: "FILE_TOO_LARGE",
      limit: 5 * GB,
      sizeBytes: 5 * GB + 1,
      fileName: "archive.zip",
    });
    expect(generateUploadPresignedUrl).not.toHaveBeenCalled();
  });

  it("keeps a smaller host-specific limit enforceable", async () => {
    await expect(request(2 * MB + 1, 2 * MB)).rejects.toThrow(
      "File size exceeds the maximum allowed size of 2 MB",
    );
    expect(generateUploadPresignedUrl).not.toHaveBeenCalled();
  });

  it("does not allow a host override to exceed the absolute 5GB ceiling", async () => {
    await expect(request(5 * GB + 1, 10 * GB)).rejects.toThrow(
      "File size exceeds the maximum allowed size of 5 GB",
    );
    expect(generateUploadPresignedUrl).not.toHaveBeenCalled();
  });
});

const input: ConfirmUploadInput = {
  storageKey: "attachments/user-1/general/object.txt",
  fileName: "object.txt",
  mimeType: "text/plain",
  sizeBytes: 3,
  spaceId: "space-1",
};
const hash = `sha256:${"a".repeat(64)}`;

function database(rows: { id: string; storageKey: string }[][] = []) {
  const limit = vi.fn(async () => rows.shift() ?? []);
  const query = {
    from: vi.fn(() => query),
    where: vi.fn(() => query),
    orderBy: vi.fn(() => query),
    limit,
  };
  const returning = vi.fn(async () => [{ id: "new-attachment" }]);
  return {
    select: vi.fn(() => query),
    insert: vi.fn(() => ({ values: vi.fn(() => ({ returning })) })),
  };
}

function policy(): AttachmentUploadPolicy {
  return {
    checkUpload: vi.fn(async () => {}),
    confirmUpload: vi.fn(async ({ db }, persist) => persist(db)),
  };
}

describe("object lifetime fences", () => {
  it("uses a fresh generation before issuing a presigned PUT", async () => {
    const db = database();
    const freshKey = "attachments/user-1/general/new-generation.txt";
    const lifecycle: AttachmentObjectLifecycle = {
      resolveUploadKey: async () => freshKey,
      register: async (database, _key, persist) => persist(database),
    };
    const result = await runWithAttachmentObjectLifecycle(lifecycle, () =>
      requestUploadUrl(input, "user-1", db, attachments),
    );
    expect(result.storageKey).toBe(freshKey);
    expect(generateUploadPresignedUrl).toHaveBeenLastCalledWith(freshKey, input.mimeType, 3600, {
      contentLength: 3,
    });
  });

  it("rejects a retired upload before any registration, even without billing", async () => {
    const db = database();
    const lifecycle: AttachmentObjectLifecycle = {
      resolveUploadKey: async (_db, key) => key,
      register: async () => {
        throw new Error("Retired upload");
      },
    };
    await expect(
      runWithAttachmentObjectLifecycle(lifecycle, () =>
        runWithoutAttachmentUploadPolicy(() => confirmUpload(input, "user-1", db, attachments)),
      ),
    ).rejects.toThrow("Retired upload");
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("persists using the locked transaction supplied by the lifecycle", async () => {
    const original = database();
    const locked = database();
    const lifecycle: AttachmentObjectLifecycle = {
      resolveUploadKey: async (_db, key) => key,
      register: async (_db, key, persist) => {
        expect(key).toBe(input.storageKey);
        return persist(locked);
      },
    };
    await runWithAttachmentObjectLifecycle(lifecycle, () =>
      confirmUpload(input, "user-1", original, attachments),
    );
    expect(original.insert).not.toHaveBeenCalled();
    expect(locked.insert).toHaveBeenCalledOnce();
  });
});

describe("request-scoped attachment policy", () => {
  beforeEach(() => {
    generateUploadPresignedUrl.mockReset();
    generateUploadPresignedUrl.mockResolvedValue("https://storage.example/upload");
  });

  it("mints distinct keys for the same owner and hash across spaces", async () => {
    const first = await requestUploadUrl({ ...input, contentHash: hash }, "user-1");
    const second = await requestUploadUrl(
      { ...input, spaceId: "space-2", contentHash: hash },
      "user-1",
    );
    const unscoped = await requestUploadUrl(
      { ...input, spaceId: undefined, contentHash: hash },
      "user-1",
    );
    expect(first.storageKey).toContain("/spaces/space-1/blobs/");
    expect(second.storageKey).toContain("/spaces/space-2/blobs/");
    expect(first.storageKey).not.toBe(second.storageKey);
    expect(unscoped.storageKey).toContain("attachments/user-1/blobs/");
  });

  it("checks host scope before reusing an existing hash", async () => {
    const db = database([[{ id: "existing", storageKey: input.storageKey }]]);
    const hostPolicy = policy();

    await expect(
      runWithAttachmentUploadPolicy(hostPolicy, () =>
        requestUploadUrl({ ...input, contentHash: hash }, "user-1", db, attachments),
      ),
    ).resolves.toMatchObject({ attachmentId: "existing", duplicate: true });
    expect(hostPolicy.checkUpload).toHaveBeenCalledOnce();
    expect(generateUploadPresignedUrl).not.toHaveBeenCalled();
  });

  it("rejects unauthorized scope before returning a deduplicated object", async () => {
    const db = database([[{ id: "existing", storageKey: input.storageKey }]]);
    const hostPolicy = policy();
    vi.mocked(hostPolicy.checkUpload).mockRejectedValue(new Error("Space access denied"));

    await expect(
      runWithAttachmentUploadPolicy(hostPolicy, () =>
        requestUploadUrl({ ...input, contentHash: hash }, "user-1", db, attachments),
      ),
    ).rejects.toThrow("Space access denied");
    expect(db.select).not.toHaveBeenCalled();
    expect(generateUploadPresignedUrl).not.toHaveBeenCalled();
  });

  it("passes context to quota checks and binds the declared upload size", async () => {
    const db = database();
    const hostPolicy = policy();
    await runWithAttachmentUploadPolicy(hostPolicy, () =>
      requestUploadUrl(input, "user-1", db, attachments),
    );
    expect(hostPolicy.checkUpload).toHaveBeenCalledWith({
      input,
      userId: "user-1",
      db,
      attachmentsTable: attachments,
    });
    expect(generateUploadPresignedUrl).toHaveBeenCalledWith(
      expect.any(String),
      input.mimeType,
      3600,
      { contentLength: 3 },
    );
  });

  it("fails closed for a policy without database wiring", async () => {
    await expect(
      runWithAttachmentUploadPolicy(policy(), () => requestUploadUrl(input, "user-1")),
    ).rejects.toThrow("requires a database");
    expect(generateUploadPresignedUrl).not.toHaveBeenCalled();
  });

  it("propagates policy rejection without issuing an upload URL", async () => {
    const hostPolicy = policy();
    const error = new Error("Quota exceeded");
    vi.mocked(hostPolicy.checkUpload).mockRejectedValue(error);
    await expect(
      runWithAttachmentUploadPolicy(hostPolicy, () =>
        requestUploadUrl(input, "user-1", database(), attachments),
      ),
    ).rejects.toBe(error);
    expect(generateUploadPresignedUrl).not.toHaveBeenCalled();
  });

  it("isolates interleaved hosts and restores the unscoped default", async () => {
    const seen: string[] = [];
    const db = database();
    let releaseFirst!: () => void;
    const firstPaused = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstPolicy = policy();
    const secondPolicy = policy();
    firstPolicy.checkUpload = async () => {
      seen.push("first");
    };
    secondPolicy.checkUpload = async () => {
      seen.push("second");
    };

    const first = runWithAttachmentUploadPolicy(firstPolicy, async () => {
      await firstPaused;
      await requestUploadUrl(input, "user-1", db, attachments);
    });
    await runWithAttachmentUploadPolicy(secondPolicy, async () => {
      releaseFirst();
      await Promise.resolve();
      await requestUploadUrl(input, "user-1", db, attachments);
    });
    await first;
    expect(seen.sort()).toEqual(["first", "second"]);
    // Hosts without an installed policy still need no database wiring.
    await expect(requestUploadUrl(input, "user-1")).resolves.toMatchObject({ duplicate: false });
    expect(seen).toHaveLength(2);
  });

  it("isolates a trusted space-less upload then restores the caller policy", async () => {
    const db = database();
    const hostPolicy = policy();
    vi.mocked(hostPolicy.checkUpload).mockRejectedValue(new Error("Active space quota"));
    await runWithAttachmentUploadPolicy(hostPolicy, async () => {
      await runWithoutAttachmentUploadPolicy(async () => {
        await Promise.resolve();
        await expect(requestUploadUrl(input, "user-1")).resolves.toMatchObject({
          duplicate: false,
        });
      });
      await expect(requestUploadUrl(input, "user-1", db, attachments)).rejects.toThrow(
        "Active space quota",
      );
    });
    expect(hostPolicy.checkUpload).toHaveBeenCalledOnce();
  });

  it("runs confirmation lookup and insertion on the transaction database", async () => {
    const db = database();
    const transaction = database();
    const hostPolicy = policy();
    hostPolicy.confirmUpload = vi.fn(async (args, persist) => {
      expect(args.db).toBe(db);
      return persist(transaction);
    });
    await expect(
      runWithAttachmentUploadPolicy(hostPolicy, () =>
        confirmUpload({ ...input, contentHash: hash }, "user-1", db, attachments),
      ),
    ).resolves.toMatchObject({ attachmentId: "new-attachment" });
    expect(db.select).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
    expect(transaction.select).toHaveBeenCalledTimes(2);
    expect(transaction.insert).toHaveBeenCalledOnce();
  });

  it("deduplicates confirm retries without a content hash", async () => {
    const db = database([[{ id: "existing", storageKey: input.storageKey }]]);
    await expect(confirmUpload(input, "user-1", db, attachments)).resolves.toMatchObject({
      attachmentId: "existing",
    });
    expect(db.insert).not.toHaveBeenCalled();
  });

  it.each([
    { storageKey: "asset-texts/pending/a.txt" },
    { storageKey: "attachments/user-2/general/a.txt" },
    { contentHash: "invalid" },
  ])("rejects invalid confirmation before invoking policy: %j", async (invalid) => {
    const hostPolicy = policy();
    await expect(
      runWithAttachmentUploadPolicy(hostPolicy, () =>
        confirmUpload({ ...input, ...invalid }, "user-1", database(), attachments),
      ),
    ).rejects.toThrow();
    expect(hostPolicy.confirmUpload).not.toHaveBeenCalled();
  });

  it("propagates confirmation policy rejection without persistence", async () => {
    const db = database();
    const hostPolicy = policy();
    const error = new Error("Object size mismatch");
    vi.mocked(hostPolicy.confirmUpload).mockRejectedValue(error);
    await expect(
      runWithAttachmentUploadPolicy(hostPolicy, () =>
        confirmUpload(input, "user-1", db, attachments),
      ),
    ).rejects.toBe(error);
    expect(db.select).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });
});

describe("multipart upload", () => {
  const big = {
    fileName: "video.mp4",
    mimeType: "video/mp4",
    sizeBytes: 300 * MB,
    context: "file-tree",
    spaceId: "space-1",
  };

  beforeEach(() => {
    for (const mock of [
      createMultipartUploadMock,
      getUploadPartPresignedUrl,
      completeMultipartUploadMock,
      listMultipartPartsMock,
      abortMultipartUploadMock,
      getObjectMetadata,
      deleteObject,
    ]) {
      mock.mockReset();
    }
    // A 300MB file is 10 parts of 32MB; the store reports all of them.
    listMultipartPartsMock.mockResolvedValue(
      Array.from({ length: 10 }, (_, index) => ({
        partNumber: index + 1,
        etag: `"store-etag-${index + 1}"`,
      })),
    );
    createMultipartUploadMock.mockResolvedValue("upload-1");
    getUploadPartPresignedUrl.mockImplementation(
      async (_key: string, _id: string, partNumber: number) => `https://bucket/part-${partNumber}`,
    );
    completeMultipartUploadMock.mockResolvedValue(undefined);
    abortMultipartUploadMock.mockResolvedValue(undefined);
  });

  it("mints the key server-side in the caller's attachment namespace and plans uniform parts", async () => {
    const created = await createMultipartUpload(big, "user-1");
    expect(created).toMatchObject({
      storageKey: "attachments/user-1/file-tree/test-id.mp4",
      uploadId: "upload-1",
      partSize: 32 * MB,
      partCount: 10,
      duplicate: false,
    });
    expect(createMultipartUploadMock).toHaveBeenCalledWith(created.storageKey, "video/mp4");
  });

  it("keeps a 5GB upload within S3's 10,000-part limit", async () => {
    const created = await createMultipartUpload({ ...big, sizeBytes: 5 * GB }, "user-1");
    expect(created.partCount).toBeLessThanOrEqual(10_000);
    expect(created.partSize * created.partCount).toBeGreaterThanOrEqual(5 * GB);
  });

  it("runs the same size ceiling and host policy as a single upload, before creating anything", async () => {
    await expect(
      createMultipartUpload({ ...big, sizeBytes: 5 * GB + 1 }, "user-1"),
    ).rejects.toThrow("maximum allowed size of 5 GB");
    const hostPolicy = policy();
    const refusal = new Error("Plan limit");
    vi.mocked(hostPolicy.checkUpload).mockRejectedValue(refusal);
    await expect(
      runWithAttachmentUploadPolicy(hostPolicy, () =>
        createMultipartUpload(big, "user-1", database(), attachments),
      ),
    ).rejects.toBe(refusal);
    expect(hostPolicy.checkUpload).toHaveBeenCalledOnce();
    expect(createMultipartUploadMock).not.toHaveBeenCalled();
  });

  it.each([
    "asset-texts/pending/a.txt",
    "attachments/user-2/file-tree/a.mp4",
    "attachments/user-1/../asset-texts/pending/a.txt",
  ])(
    "refuses to sign, complete or abort a key not issued to the caller: %s",
    async (storageKey) => {
      await expect(
        signMultipartUploadParts({ storageKey, uploadId: "upload-1", partNumbers: [1] }, "user-1"),
      ).rejects.toThrow(/issued to you/);
      await expect(
        completeMultipartUpload(
          { ...big, storageKey, uploadId: "upload-1" },
          "user-1",
          database(),
          attachments,
        ),
      ).rejects.toThrow(/issued to you/);
      await expect(
        abortMultipartUpload({ storageKey, uploadId: "upload-1" }, "user-1"),
      ).rejects.toThrow(/issued to you/);
      expect(getUploadPartPresignedUrl).not.toHaveBeenCalled();
      expect(completeMultipartUploadMock).not.toHaveBeenCalled();
      expect(abortMultipartUploadMock).not.toHaveBeenCalled();
    },
  );

  it("signs only valid part numbers, in bounded batches", async () => {
    const storageKey = "attachments/user-1/file-tree/test-id.mp4";
    await expect(
      signMultipartUploadParts({ storageKey, uploadId: "upload-1", partNumbers: [1, 2] }, "user-1"),
    ).resolves.toEqual({
      parts: [
        { partNumber: 1, uploadUrl: "https://bucket/part-1" },
        { partNumber: 2, uploadUrl: "https://bucket/part-2" },
      ],
      expiresIn: 3600,
    });
    await expect(
      signMultipartUploadParts({ storageKey, uploadId: "upload-1", partNumbers: [0] }, "user-1"),
    ).rejects.toThrow(/Part numbers/);
    await expect(
      signMultipartUploadParts(
        {
          storageKey,
          uploadId: "upload-1",
          partNumbers: Array.from({ length: 101 }, (_, index) => index + 1),
        },
        "user-1",
      ),
    ).rejects.toThrow(/at a time/);
  });

  it("re-measures the assembled object with HEAD and refuses a size mismatch without registering it", async () => {
    const storageKey = "attachments/user-1/file-tree/test-id.mp4";
    getObjectMetadata.mockResolvedValue({ key: storageKey, size: 300 * MB + 7 });
    const db = database([[]]);
    await expect(
      completeMultipartUpload(
        { ...big, storageKey, uploadId: "upload-1" },
        "user-1",
        db,
        attachments,
      ),
    ).rejects.toThrow(/does not match/);
    expect(completeMultipartUploadMock).toHaveBeenCalledOnce();
    expect(db.insert).not.toHaveBeenCalled();
    // Unreferenced → the stray object is removed.
    expect(deleteObject).toHaveBeenCalledWith(storageKey);
  });

  it("refuses an assembled object above the ceiling even if the client declared it so", async () => {
    const storageKey = "attachments/user-1/file-tree/test-id.mp4";
    await expect(
      completeMultipartUpload(
        {
          ...big,
          sizeBytes: 5 * GB + 1,
          storageKey,
          uploadId: "upload-1",
        },
        "user-1",
        database(),
        attachments,
      ),
    ).rejects.toThrow("maximum allowed size of 5 GB");
    expect(completeMultipartUploadMock).not.toHaveBeenCalled();
  });

  it("completes, then confirms through the host policy with the HEAD-verified size", async () => {
    const storageKey = "attachments/user-1/file-tree/test-id.mp4";
    getObjectMetadata.mockResolvedValue({ key: storageKey, size: 300 * MB });
    const db = database();
    const hostPolicy = policy();
    const result = await runWithAttachmentUploadPolicy(hostPolicy, () =>
      completeMultipartUpload(
        {
          ...big,
          storageKey,
          uploadId: "upload-1",
        },
        "user-1",
        db,
        attachments,
      ),
    );
    expect(result).toMatchObject({ success: true, attachmentId: "new-attachment", storageKey });
    expect(hostPolicy.confirmUpload).toHaveBeenCalledOnce();
    expect(vi.mocked(hostPolicy.confirmUpload).mock.calls[0]?.[0].input).toMatchObject({
      storageKey,
      sizeBytes: 300 * MB,
    });
    expect(vi.mocked(hostPolicy.confirmUpload).mock.calls[0]?.[0].input).not.toHaveProperty(
      "uploadId",
    );
  });

  it("removes the assembled object when the host policy refuses it at confirm (plan limit / quota)", async () => {
    // Declared within the plan at create, assembled bigger than the plan allows,
    // honestly re-declared at complete: the HEAD size matches, so only the host
    // policy can refuse — and the bytes must not stay readable by key.
    const storageKey = "attachments/user-1/file-tree/test-id.mp4";
    getObjectMetadata.mockResolvedValue({ key: storageKey, size: 300 * MB });
    const hostPolicy = policy();
    const refusal = new Error("Plan per-file limit");
    vi.mocked(hostPolicy.confirmUpload).mockRejectedValue(refusal);
    await expect(
      runWithAttachmentUploadPolicy(hostPolicy, () =>
        completeMultipartUpload(
          { ...big, storageKey, uploadId: "upload-1" },
          "user-1",
          database([[]]),
          attachments,
        ),
      ),
    ).rejects.toBe(refusal);
    expect(deleteObject).toHaveBeenCalledWith(storageKey);
  });

  it("never deletes a refused object whose key already backs a registered attachment", async () => {
    const storageKey = "attachments/user-1/file-tree/test-id.mp4";
    getObjectMetadata.mockResolvedValue({ key: storageKey, size: 300 * MB });
    const hostPolicy = policy();
    vi.mocked(hostPolicy.confirmUpload).mockRejectedValue(new Error("Quota"));
    await expect(
      runWithAttachmentUploadPolicy(hostPolicy, () =>
        completeMultipartUpload(
          { ...big, storageKey, uploadId: "upload-1" },
          "user-1",
          database([[{ id: "existing-attachment" }]]),
          attachments,
        ),
      ),
    ).rejects.toThrow("Quota");
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("completes with the ETags the store recorded, not anything the client reports", async () => {
    // The browser cannot read a part's ETag when the bucket's CORS hides it
    // (Busabase Cloud's production R2 bucket does), so completion lists the
    // parts server-side.
    const storageKey = "attachments/user-1/file-tree/test-id.mp4";
    getObjectMetadata.mockResolvedValue({ key: storageKey, size: 300 * MB });
    await completeMultipartUpload(
      { ...big, storageKey, uploadId: "upload-1" },
      "user-1",
      database(),
      attachments,
    );
    expect(listMultipartPartsMock).toHaveBeenCalledWith(storageKey, "upload-1");
    expect(completeMultipartUploadMock).toHaveBeenCalledWith(
      storageKey,
      "upload-1",
      Array.from({ length: 10 }, (_, index) => ({
        partNumber: index + 1,
        etag: `"store-etag-${index + 1}"`,
      })),
    );
  });

  it.each([
    ["a missing part", [1, 2, 3, 4, 5, 6, 7, 8, 9]],
    ["a gap", [1, 2, 3, 4, 5, 6, 7, 8, 9, 11]],
    ["an extra part", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]],
  ])("refuses to assemble when the stored parts have %s", async (_case, partNumbers) => {
    const storageKey = "attachments/user-1/file-tree/test-id.mp4";
    listMultipartPartsMock.mockResolvedValue(
      partNumbers.map((partNumber) => ({ partNumber, etag: `e${partNumber}` })),
    );
    await expect(
      completeMultipartUpload(
        { ...big, storageKey, uploadId: "upload-1" },
        "user-1",
        database(),
        attachments,
      ),
    ).rejects.toThrow(/incomplete/);
    expect(completeMultipartUploadMock).not.toHaveBeenCalled();
  });

  it("treats aborting an already-gone upload as a no-op", async () => {
    abortMultipartUploadMock.mockRejectedValue(new Error("NoSuchUpload"));
    await expect(
      abortMultipartUpload(
        { storageKey: "attachments/user-1/file-tree/test-id.mp4", uploadId: "upload-1" },
        "user-1",
      ),
    ).resolves.toEqual({ success: false });
  });
});
