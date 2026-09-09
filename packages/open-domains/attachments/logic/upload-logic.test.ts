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

import { MAX_FILE_SIZE, requestUploadUrl } from "./upload-logic";

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
