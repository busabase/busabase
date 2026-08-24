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
});
