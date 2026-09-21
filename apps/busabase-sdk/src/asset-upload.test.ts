import { describe, expect, it, vi } from "vitest";
import { hashBytes, uploadAsset } from "./asset-upload.js";

const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const client = (overrides: Record<string, unknown> = {}) => ({
  assets: {
    createUploadUrl: vi.fn(async () => ({
      uploadUrl: "https://upload.example/put",
      storageKey: "key-1",
      publicUrl: "https://cdn.example/a.png",
      expiresIn: 600,
    })),
    confirm: vi.fn(async () => ({
      success: true,
      attachmentId: "att-1",
      assetId: "ast-1",
      storageKey: "key-1",
      publicUrl: "https://cdn.example/a.png",
    })),
    ...overrides,
  },
});

describe("uploadAsset", () => {
  it("hides the three-step flow and returns every id a caller might reference", async () => {
    const bb = client();
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      void init;
      return new Response(null, { status: 200 });
    });

    const asset = await uploadAsset(
      bb as never,
      BYTES,
      { fileName: "a.png", mimeType: "image/png" },
      fetchImpl as never,
    );

    expect(asset).toMatchObject({
      assetId: "ast-1",
      attachmentId: "att-1",
      url: "https://cdn.example/a.png",
      fileName: "a.png",
      mimeType: "image/png",
      size: 8,
    });
    // assetId is what a file tree references, attachmentId what a record cell
    // does — a caller that only got one of them would be stuck.
    expect(asset.contentHash).toBe(await hashBytes(BYTES));
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ method: "PUT" });
  });

  it("skips the PUT and the confirm when the library already holds these bytes", async () => {
    const bb = client({
      createUploadUrl: vi.fn(async () => ({
        uploadUrl: "",
        storageKey: "",
        publicUrl: "https://cdn.example/a.png",
        expiresIn: 0,
        duplicate: true,
        attachmentId: "att-existing",
        assetId: "ast-existing",
      })),
    });
    const fetchImpl = vi.fn();

    const asset = await uploadAsset(
      bb as never,
      BYTES,
      { fileName: "a.png", mimeType: "image/png" },
      fetchImpl as never,
    );

    expect(asset.assetId).toBe("ast-existing");
    // `uploadUrl` is empty in a duplicate response, so a PUT here would not be
    // a slower success — it would be an error.
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(bb.assets.confirm).not.toHaveBeenCalled();
  });

  it("names the file in its error when the presigned upload fails", async () => {
    const fetchImpl = vi.fn(async () => new Response("denied", { status: 403 }));
    await expect(
      uploadAsset(
        client() as never,
        BYTES,
        { fileName: "a.png", mimeType: "image/png" },
        fetchImpl as never,
      ),
    ).rejects.toThrow(/a\.png failed \(403/);
  });

  it("refuses an empty file rather than letting the server reject it anonymously", async () => {
    const bb = client();
    await expect(
      uploadAsset(bb as never, new Uint8Array(), { fileName: "a.png", mimeType: "image/png" }),
    ).rejects.toThrow(/a\.png is empty/);
    expect(bb.assets.createUploadUrl).not.toHaveBeenCalled();
  });

  it("passes the content hash so the server can deduplicate", async () => {
    const bb = client();
    await uploadAsset(
      bb as never,
      BYTES,
      { fileName: "a.png", mimeType: "image/png", context: "skills" },
      (async () => new Response(null, { status: 200 })) as never,
    );
    expect(bb.assets.createUploadUrl).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: "a.png",
        sizeBytes: 8,
        context: "skills",
        contentHash: await hashBytes(BYTES),
      }),
    );
  });
});
