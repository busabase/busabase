import { describe, expect, it, vi } from "vitest";
import { completeAttachmentUpload } from "./attachment-upload";

const input = {
  fileName: "brief.pdf",
  mimeType: "application/pdf",
  sizeBytes: 42,
  context: "record-field",
};

describe("completeAttachmentUpload", () => {
  it("skips byte upload and confirmation for a duplicate", async () => {
    const uploadBytes = vi.fn();
    const confirmUpload = vi.fn();
    const result = await completeAttachmentUpload(input, {
      createUploadUrl: vi.fn().mockResolvedValue({
        uploadUrl: "",
        storageKey: "existing",
        publicUrl: "https://cdn.example/brief.pdf",
        expiresIn: 0,
        duplicate: true,
        attachmentId: "attachment-1",
        assetId: "asset-1",
      }),
      uploadBytes,
      confirmUpload,
    });

    expect(uploadBytes).not.toHaveBeenCalled();
    expect(confirmUpload).not.toHaveBeenCalled();
    expect(result).toMatchObject({ id: "asset-1", attachmentId: "attachment-1", size: 42 });
  });

  it("uploads bytes before confirming and maps the shared attachment ref", async () => {
    const calls: string[] = [];
    const result = await completeAttachmentUpload(input, {
      createUploadUrl: vi.fn().mockResolvedValue({
        uploadUrl: "https://upload.example/brief.pdf",
        storageKey: "storage-1",
        publicUrl: "https://cdn.example/brief.pdf",
        expiresIn: 60,
      }),
      uploadBytes: vi.fn().mockImplementation(async () => {
        calls.push("upload");
      }),
      confirmUpload: vi.fn().mockImplementation(async (confirmInput) => {
        calls.push("confirm");
        expect(confirmInput).toMatchObject({
          storageKey: "storage-1",
          fileName: "brief.pdf",
          context: "record-field",
        });
        return {
          success: true,
          attachmentId: "attachment-2",
          assetId: "asset-2",
          storageKey: "storage-1",
          publicUrl: "https://cdn.example/brief.pdf",
        };
      }),
    });

    expect(calls).toEqual(["upload", "confirm"]);
    expect(result).toMatchObject({
      id: "asset-2",
      fileName: "brief.pdf",
      mimeType: "application/pdf",
    });
  });

  describe("large files (multipart adapter)", () => {
    const big = { ...input, fileName: "video.mp4", mimeType: "video/mp4", sizeBytes: 101 };
    const created = {
      storageKey: "attachments/u/record-field/v.mp4",
      publicUrl: "https://cdn.example/v.mp4",
      uploadId: "up-1",
      partSize: 64,
      partCount: 2,
      expiresIn: 3600,
      duplicate: false,
    };
    const confirmed = {
      success: true,
      attachmentId: "attachment-3",
      assetId: "asset-3",
      storageKey: created.storageKey,
      publicUrl: created.publicUrl,
    };

    it("keeps files at or below the threshold on the single-PUT path", async () => {
      const multipartCreate = vi.fn();
      await completeAttachmentUpload(
        { ...big, sizeBytes: 100 },
        {
          createUploadUrl: vi.fn().mockResolvedValue({
            uploadUrl: "https://upload.example/v",
            storageKey: "s",
            publicUrl: "p",
            expiresIn: 60,
          }),
          uploadBytes: vi.fn(),
          confirmUpload: vi.fn().mockResolvedValue(confirmed),
          multipart: {
            thresholdBytes: 100,
            create: multipartCreate,
            uploadParts: vi.fn(),
            complete: vi.fn(),
            abort: vi.fn(),
          },
        },
      );
      expect(multipartCreate).not.toHaveBeenCalled();
    });

    it("creates, uploads parts, then completes with the confirm fields", async () => {
      const createUploadUrl = vi.fn();
      const complete = vi.fn().mockResolvedValue(confirmed);
      const result = await completeAttachmentUpload(
        { ...big, metadata: { source: "test" } },
        {
          createUploadUrl,
          uploadBytes: vi.fn(),
          confirmUpload: vi.fn(),
          multipart: {
            thresholdBytes: 100,
            create: vi.fn().mockResolvedValue(created),
            uploadParts: vi.fn().mockResolvedValue(undefined),
            complete,
            abort: vi.fn(),
          },
        },
      );
      expect(createUploadUrl).not.toHaveBeenCalled();
      expect(complete).toHaveBeenCalledWith({
        storageKey: created.storageKey,
        fileName: "video.mp4",
        mimeType: "video/mp4",
        sizeBytes: 101,
        spaceId: undefined,
        context: "record-field",
        contentHash: undefined,
        metadata: { source: "test" },
        uploadId: "up-1",
      });
      expect(result).toMatchObject({ id: "asset-3", size: 101 });
    });

    it("aborts the server-side upload when a part fails, and surfaces the part error", async () => {
      const abort = vi.fn().mockResolvedValue({ success: true });
      const complete = vi.fn();
      const failure = new Error("Upload failed (500)");
      await expect(
        completeAttachmentUpload(big, {
          createUploadUrl: vi.fn(),
          uploadBytes: vi.fn(),
          confirmUpload: vi.fn(),
          multipart: {
            thresholdBytes: 100,
            create: vi.fn().mockResolvedValue(created),
            uploadParts: vi.fn().mockRejectedValue(failure),
            complete,
            abort,
          },
        }),
      ).rejects.toBe(failure);
      expect(abort).toHaveBeenCalledWith({
        storageKey: created.storageKey,
        uploadId: "up-1",
        spaceId: undefined,
      });
      expect(complete).not.toHaveBeenCalled();
    });

    it("skips the transfer entirely for a duplicate", async () => {
      const uploadParts = vi.fn();
      const result = await completeAttachmentUpload(big, {
        createUploadUrl: vi.fn(),
        uploadBytes: vi.fn(),
        confirmUpload: vi.fn(),
        multipart: {
          thresholdBytes: 100,
          create: vi.fn().mockResolvedValue({
            ...created,
            uploadId: "",
            duplicate: true,
            attachmentId: "attachment-9",
            assetId: "asset-9",
          }),
          uploadParts,
          complete: vi.fn(),
          abort: vi.fn(),
        },
      });
      expect(uploadParts).not.toHaveBeenCalled();
      expect(result).toMatchObject({ id: "asset-9" });
    });
  });
});
