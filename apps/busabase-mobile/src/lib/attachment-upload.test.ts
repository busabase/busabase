import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { UploadOptions } from "expo-file-system";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { type PickedFile, uploadAttachment } from "./attachment-upload";

const native = vi.hoisted(() => ({
  platform: "android",
  files: [] as string[],
  tasks: [] as Array<{ file: { uri: string }; url: string; options: UploadOptions }>,
  uploadAsync: vi.fn(),
  release: vi.fn(),
}));

vi.mock("react-native", () => ({
  Platform: {
    get OS() {
      return native.platform;
    },
  },
}));

// The native bridge is only available in Android/iOS. Its actual byte transfer
// is exercised by the native acceptance CI; here we enforce its transport and
// confirmation contract. Web tests below use a real HTTP server and FormData.
vi.mock("expo-file-system", () => ({
  File: class {
    constructor(readonly uri: string) {
      native.files.push(uri);
    }
  },
  UploadType: { BINARY_CONTENT: 0, MULTIPART: 1 },
  UploadTask: class {
    constructor(file: { uri: string }, url: string, options: UploadOptions) {
      native.tasks.push({ file, url, options });
    }
    uploadAsync = native.uploadAsync;
    release = native.release;
  },
}));

const picked: PickedFile = {
  uri: "file:///cache/picker-random-name.txt",
  name: "Customer contract.txt",
  mimeType: "text/plain",
  size: 58,
};

function client(uploadUrl = "/api/storage/upload") {
  const confirmed = {
    success: true,
    assetId: "ast_native",
    attachmentId: "att_native",
    storageKey: "record-field/native-proof.txt",
    publicUrl: "/api/assets/ast_native/raw",
  };
  const assets = {
    createUploadUrl: vi.fn().mockResolvedValue({
      uploadUrl,
      storageKey: confirmed.storageKey,
      publicUrl: confirmed.publicUrl,
      expiresIn: 3600,
    }),
    confirm: vi.fn().mockResolvedValue(confirmed),
  };
  return { assets, api: { assets } as unknown as Parameters<typeof uploadAttachment>[0] };
}

beforeEach(() => {
  native.platform = "android";
  native.files.length = 0;
  native.tasks.length = 0;
  native.uploadAsync.mockReset().mockResolvedValue({ status: 201, body: "", headers: {} });
  native.release.mockReset();
});

describe("native file upload", () => {
  it("streams the selected URI as multipart and confirms the original filename only after transfer", async () => {
    const { api, assets } = client();
    const transfer = Promise.withResolvers<{ status: number }>();
    native.uploadAsync.mockReturnValueOnce(transfer.promise);
    const result = uploadAttachment(api, "http://localhost:15519/", picked, {
      authorization: "Bearer fixture-token",
      "x-busabase-space": "org_fixture",
    });
    await vi.waitFor(() => expect(native.uploadAsync).toHaveBeenCalledOnce());
    expect(assets.confirm).not.toHaveBeenCalled();
    expect(native.tasks).toEqual([
      {
        file: { uri: picked.uri },
        url: "http://localhost:15519/api/storage/upload",
        options: {
          httpMethod: "POST",
          uploadType: 1,
          fieldName: "file",
          mimeType: picked.mimeType,
          parameters: { storageKey: "record-field/native-proof.txt" },
          headers: { authorization: "Bearer fixture-token", "x-busabase-space": "org_fixture" },
        },
      },
    ]);
    transfer.resolve({ status: 201 });
    expect(await result).toMatchObject({
      assetId: "ast_native",
      fileName: picked.name,
      mimeType: picked.mimeType,
      size: picked.size,
    });
    expect(assets.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: picked.name,
        mimeType: picked.mimeType,
        sizeBytes: picked.size,
        storageKey: "record-field/native-proof.txt",
        context: "record-field",
      }),
    );
    expect(native.release).toHaveBeenCalledOnce();
  });

  it("uploads a presigned URL as binary without forwarding the account's authorization", async () => {
    const target = "https://storage.example.test/object?signature=fixture";
    const { api, assets } = client(target);
    await uploadAttachment(api, "https://busabase.example.test", picked, {
      authorization: "Bearer private-account-token",
    });
    expect(native.tasks[0]).toEqual({
      file: { uri: picked.uri },
      url: target,
      options: {
        httpMethod: "PUT",
        uploadType: 0,
        headers: { "content-type": picked.mimeType },
      },
    });
    expect(assets.confirm).toHaveBeenCalledOnce();
  });

  it.each([
    { status: 400, uploadUrl: "/api/storage/upload" },
    { status: 503, uploadUrl: "https://storage.example.test/signed" },
  ])("does not confirm a rejected native transfer ($status)", async ({ status, uploadUrl }) => {
    const { api, assets } = client(uploadUrl);
    native.uploadAsync.mockResolvedValueOnce({ status });
    await expect(uploadAttachment(api, "http://localhost:15519", picked)).rejects.toThrow(
      `Upload failed (${status})`,
    );
    expect(assets.confirm).not.toHaveBeenCalled();
    expect(native.release).toHaveBeenCalledOnce();
  });

  it("does not confirm when the native file cannot be read", async () => {
    const { api, assets } = client();
    native.uploadAsync.mockRejectedValueOnce(new Error("File does not exist"));
    await expect(uploadAttachment(api, "http://localhost:15519", picked)).rejects.toThrow(
      "File does not exist",
    );
    expect(assets.confirm).not.toHaveBeenCalled();
    expect(native.release).toHaveBeenCalledOnce();
  });

  it("keeps a deduplicated asset without opening or transmitting the selected file", async () => {
    const { api, assets } = client();
    assets.createUploadUrl.mockResolvedValueOnce({
      uploadUrl: "",
      storageKey: "already-there",
      publicUrl: "/existing",
      duplicate: true,
      attachmentId: "att_existing",
      assetId: "ast_existing",
      expiresIn: 0,
    });
    expect(await uploadAttachment(api, "http://localhost:15519", picked)).toMatchObject({
      assetId: "ast_existing",
      fileName: picked.name,
    });
    expect(native.files).toEqual([]);
    expect(native.uploadAsync).not.toHaveBeenCalled();
    expect(assets.confirm).not.toHaveBeenCalled();
  });
});

async function withUploadServer(
  run: (
    origin: string,
    received: Array<{ method?: string; headers: Headers; bytes: Uint8Array }>,
  ) => Promise<void>,
  status = 201,
) {
  const received: Array<{ method?: string; headers: Headers; bytes: Uint8Array }> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const headers = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    received.push({
      method: request.method,
      headers,
      bytes: new Uint8Array(Buffer.concat(chunks)),
    });
    response.writeHead(status).end();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await run(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, received);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

describe("web upload over real HTTP", () => {
  it("serializes actual file bytes, filename, storage key and authentication as multipart", async () => {
    native.platform = "web";
    const bytes = new Uint8Array([0, 255, 42, 13, 10, 123, 125]);
    const uri = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    try {
      await withUploadServer(async (origin, received) => {
        const { api, assets } = client();
        await uploadAttachment(
          api,
          origin,
          {
            uri,
            name: "合同.pdf",
            mimeType: "application/pdf",
            size: bytes.length,
          },
          { authorization: "Bearer web-fixture" },
        );
        expect(received).toHaveLength(1);
        const request = received[0];
        expect(request.method).toBe("POST");
        expect(request.headers.get("authorization")).toBe("Bearer web-fixture");
        const body = Buffer.from(request.bytes);
        const boundary = request.headers.get("content-type")?.match(/boundary=(.+)$/)?.[1];
        if (!boundary) throw new Error("Missing multipart boundary");
        expect(body.toString("utf8")).toContain(
          'Content-Disposition: form-data; name="storageKey"\r\n\r\nrecord-field/native-proof.txt',
        );
        const headerStart = body.indexOf('name="file"; filename="合同.pdf"');
        expect(headerStart).toBeGreaterThan(0);
        const fileStart = body.indexOf("\r\n\r\n", headerStart) + 4;
        expect(body.subarray(headerStart, fileStart).toString()).toContain(
          "Content-Type: application/pdf",
        );
        expect(body.subarray(fileStart, fileStart + bytes.length)).toEqual(Buffer.from(bytes));
        expect(
          body
            .subarray(fileStart + bytes.length, fileStart + bytes.length + boundary.length + 4)
            .toString(),
        ).toBe(`\r\n--${boundary}`);
        expect(assets.confirm).toHaveBeenCalledOnce();
        expect(native.uploadAsync).not.toHaveBeenCalled();
      });
    } finally {
      URL.revokeObjectURL(uri);
    }
  });

  it("keeps presigned PUT bytes raw and does not leak account headers", async () => {
    native.platform = "web";
    const bytes = new Uint8Array([19, 0, 255, 128]);
    const uri = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
    try {
      await withUploadServer(async (origin, received) => {
        const { api } = client(`${origin}/signed?signature=fixture`);
        await uploadAttachment(
          api,
          "https://account.example.test",
          {
            uri,
            name: "photo.png",
            mimeType: "image/png",
            size: bytes.length,
          },
          { authorization: "Bearer private-account-token" },
        );
        expect(received[0].method).toBe("PUT");
        expect(received[0].headers.get("authorization")).toBeNull();
        expect(received[0].headers.get("content-type")).toBe("image/png");
        expect(received[0].bytes).toEqual(bytes);
      });
    } finally {
      URL.revokeObjectURL(uri);
    }
  });

  it("does not confirm an HTTP upload failure", async () => {
    native.platform = "web";
    const uri = URL.createObjectURL(new Blob(["not accepted"]));
    try {
      await withUploadServer(async (origin) => {
        const { api, assets } = client();
        await expect(uploadAttachment(api, origin, { ...picked, uri })).rejects.toThrow(
          "Upload failed (503)",
        );
        expect(assets.confirm).not.toHaveBeenCalled();
      }, 503);
    } finally {
      URL.revokeObjectURL(uri);
    }
  });
});
