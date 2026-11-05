import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalMultipartPartRoute } from "./dev-routes";
import { LocalStorage } from "./local";

/**
 * Local-storage multipart: the part relay (`<upload_url>/part`) has no session
 * check in front of it on self-hosted Busabase, so these tests pin down why it
 * is still not an arbitrary-key write: it only accepts parts for an upload the
 * server created, for the key recorded at creation, within a size cap.
 */
describe("LocalStorage multipart + part relay", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  const setup = async (maxPartBytes = 1024) => {
    const root = await mkdtemp(path.join(tmpdir(), "openlib-multipart-"));
    roots.push(root);
    const storage = new LocalStorage({
      provider: "local",
      bucketName: "local",
      localRoot: root,
      localUploadUrl: "/api/storage/upload",
    });
    const { PUT } = createLocalMultipartPartRoute({
      gateProduction: false,
      resolveStorage: () => storage,
      maxPartBytes,
    });
    return { root, storage, PUT };
  };

  const put = (PUT: (req: Request) => Promise<Response>, url: string, body: string) =>
    PUT(new Request(new URL(url, "http://localhost"), { method: "PUT", body }));

  it("uploads parts through the relay URL and assembles them in order at the server's key", async () => {
    const { root, storage, PUT } = await setup();
    const key = "attachments/user-1/file-tree/big.bin";
    const uploadId = await storage.createMultipartUpload(key, "application/octet-stream");
    expect(uploadId).toMatch(/^[0-9a-f]{32}$/);

    const url2 = await storage.getUploadPartPresignedUrl(key, uploadId, 2);
    const url1 = await storage.getUploadPartPresignedUrl(key, uploadId, 1);
    expect(url1.startsWith("/api/storage/upload/part?")).toBe(true);

    const second = await put(PUT, url2, "world");
    const first = await put(PUT, url1, "hello ");
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers.get("ETag")).toMatch(/^"[0-9a-f]{32}"$/);

    await storage.completeMultipartUpload(key, uploadId, [
      { partNumber: 2, etag: second.headers.get("ETag") ?? "" },
      { partNumber: 1, etag: first.headers.get("ETag") ?? "" },
    ]);
    expect(await readFile(path.join(root, key), "utf8")).toBe("hello world");
    await expect(storage.getObjectMetadata(key)).resolves.toMatchObject({ size: 11 });
    // Temp parts are cleaned up.
    expect(await readdir(path.join(root, ".tmp", "multipart"))).toEqual([]);
  });

  it("rejects a forged or unknown uploadId without writing anything", async () => {
    const { root, PUT } = await setup();
    const forged = "0".repeat(32);
    const response = await put(
      PUT,
      `/api/storage/upload/part?uploadId=${forged}&partNumber=1&key=attachments/x/y.bin`,
      "evil",
    );
    expect(response.status).toBe(404);
    const traversal = await put(
      PUT,
      "/api/storage/upload/part?uploadId=../../etc&partNumber=1&key=attachments/x/y.bin",
      "evil",
    );
    expect(traversal.status).toBe(404);
    await expect(readdir(path.join(root, "attachments"))).rejects.toThrow();
  });

  it("rejects a valid uploadId paired with a different key", async () => {
    const { storage, PUT } = await setup();
    const uploadId = await storage.createMultipartUpload("attachments/user-1/a.bin", "x");
    const response = await put(
      PUT,
      `/api/storage/upload/part?uploadId=${uploadId}&partNumber=1&key=${encodeURIComponent("attachments/user-2/victim.bin")}`,
      "evil",
    );
    expect(response.status).toBe(404);
  });

  it("rejects traversal keys, bad part numbers and oversized parts", async () => {
    const { storage, PUT } = await setup(4);
    const key = "attachments/user-1/a.bin";
    const uploadId = await storage.createMultipartUpload(key, "x");
    const traversal = await put(
      PUT,
      `/api/storage/upload/part?uploadId=${uploadId}&partNumber=1&key=${encodeURIComponent("../../etc/passwd")}`,
      "x",
    );
    expect(traversal.status).toBe(400);
    const badPart = await put(
      PUT,
      `/api/storage/upload/part?uploadId=${uploadId}&partNumber=0&key=${encodeURIComponent(key)}`,
      "x",
    );
    expect(badPart.status).toBe(400);
    const tooLarge = await put(
      PUT,
      `/api/storage/upload/part?uploadId=${uploadId}&partNumber=1&key=${encodeURIComponent(key)}`,
      "12345",
    );
    expect(tooLarge.status).toBe(413);
  });

  it("refuses to complete a missing part or a mismatched key, and abort discards the parts", async () => {
    const { root, storage, PUT } = await setup();
    const key = "attachments/user-1/a.bin";
    const uploadId = await storage.createMultipartUpload(key, "x");
    await put(PUT, await storage.getUploadPartPresignedUrl(key, uploadId, 1), "abc");
    await expect(
      storage.completeMultipartUpload(key, uploadId, [
        { partNumber: 1, etag: "a" },
        { partNumber: 2, etag: "b" },
      ]),
    ).rejects.toThrow(/Part 2 missing/);
    await expect(
      storage.completeMultipartUpload("attachments/user-1/other.bin", uploadId, [
        { partNumber: 1, etag: "a" },
      ]),
    ).rejects.toThrow(/does not belong/);
    await storage.abortMultipartUpload(key, uploadId);
    expect(await readdir(path.join(root, ".tmp", "multipart"))).toEqual([]);
  });

  it("is a 404 in production when mounted under /api/dev (default gate)", async () => {
    const { storage } = await setup();
    const { PUT } = createLocalMultipartPartRoute({ resolveStorage: () => storage });
    const previous = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "production";
    try {
      const response = await PUT(
        new Request("http://localhost/api/dev/upload/part?uploadId=x&partNumber=1&key=a", {
          method: "PUT",
          body: "x",
        }),
      );
      expect(response.status).toBe(404);
    } finally {
      (process.env as Record<string, string>).NODE_ENV = previous ?? "test";
    }
  });

  it("lists the finished parts for completion, without needing client ETags", async () => {
    const { root, storage, PUT } = await setup();
    const key = "attachments/user-1/file-tree/listed.bin";
    const uploadId = await storage.createMultipartUpload(key, "application/octet-stream");
    for (const [partNumber, body] of [
      [2, "BB"],
      [1, "AAA"],
    ] as const) {
      const url = await storage.getUploadPartPresignedUrl(key, uploadId, partNumber);
      expect((await put(PUT, url, body)).status).toBe(200);
    }
    const parts = await storage.listMultipartParts(key, uploadId);
    expect(parts.map((part) => part.partNumber)).toEqual([1, 2]);
    // Completing with the store's own list assembles the object.
    await storage.completeMultipartUpload(key, uploadId, parts);
    expect(await readFile(path.join(root, key), "utf8")).toBe("AAABB");
  });

  it("refuses to list the parts of an upload under another key", async () => {
    const { storage } = await setup();
    const uploadId = await storage.createMultipartUpload("attachments/user-1/a.bin", "x/y");
    await expect(storage.listMultipartParts("attachments/user-2/b.bin", uploadId)).rejects.toThrow(
      /does not belong/,
    );
  });
});
