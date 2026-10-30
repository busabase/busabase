import { beforeEach, describe, expect, it, vi } from "vitest";

const { generateUploadPresignedUrl } = vi.hoisted(() => ({
  generateUploadPresignedUrl: vi.fn(),
}));

vi.mock("openlib/nanoid", () => ({ generateNanoID: () => "test-id" }));
vi.mock("openlib/storage", () => ({
  extractFileExtension: (fileName: string) => fileName.split(".").at(-1) ?? "",
  storage: {
    generateUploadPresignedUrl,
    getPublicUrl: (storageKey: string) => `/api/attachment/${storageKey}`,
  },
}));

import { attachments } from "../schema/attachments";
import {
  type AttachmentObjectLifecycle,
  type AttachmentUploadPolicy,
  type ConfirmUploadInput,
  confirmUpload,
  MAX_FILE_SIZE,
  requestUploadUrl,
  runWithAttachmentObjectLifecycle,
  runWithAttachmentUploadPolicy,
  runWithoutAttachmentUploadPolicy,
} from "./upload-logic";

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

  it("accepts files above the former 25MB limit and through 200MB", async () => {
    expect(MAX_FILE_SIZE).toBe(200 * 1024 * 1024);

    await expect(request(26 * 1024 * 1024)).resolves.toMatchObject({ expiresIn: 3600 });
    await expect(request(200 * 1024 * 1024)).resolves.toMatchObject({ expiresIn: 3600 });
    expect(generateUploadPresignedUrl).toHaveBeenCalledTimes(2);
  });

  it("rejects files above 200MB before creating an upload URL", async () => {
    await expect(request(200 * 1024 * 1024 + 1)).rejects.toThrow(
      "File size exceeds the maximum allowed size of 200MB",
    );
    expect(generateUploadPresignedUrl).not.toHaveBeenCalled();
  });

  it("keeps a smaller host-specific limit enforceable", async () => {
    await expect(request(2 * 1024 * 1024 + 1, 2 * 1024 * 1024)).rejects.toThrow(
      "File size exceeds the maximum allowed size of 2MB",
    );
    expect(generateUploadPresignedUrl).not.toHaveBeenCalled();
  });

  it("does not allow a host override to exceed the absolute 200MB ceiling", async () => {
    await expect(request(200 * 1024 * 1024 + 1, 300 * 1024 * 1024)).rejects.toThrow(
      "File size exceeds the maximum allowed size of 200MB",
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
