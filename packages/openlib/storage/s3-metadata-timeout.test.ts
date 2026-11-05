import { createServer, type Server, type Socket } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createStorage } from "./factory";

/**
 * The HEAD calls run inside database transactions that hold row locks, so a
 * socket that accepts a connection and then says nothing used to park a pooled
 * connection — and every lock it held — for as long as the backend stayed
 * silent. The AWS SDK's node handler has no response timeout by default, so
 * this test holds a real socket open that never answers and checks the
 * per-call deadline actually ends the request.
 */
const METADATA_TIMEOUT_MS = 800;

describe("S3 metadata deadline", () => {
  let server: Server;
  let sockets: Socket[] = [];
  let endpoint: string;

  beforeAll(async () => {
    server = createServer((socket) => {
      // Accept the connection and never answer: a stalled storage backend.
      sockets.push(socket);
      socket.on("error", () => {});
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("expected a TCP address");
    endpoint = `http://127.0.0.1:${address.port}`;
  });

  afterEach(() => {
    // Destroy politely-accepted sockets so a disabled-deadline test cannot leak.
    for (const socket of sockets) socket.destroy();
    sockets = [];
    delete process.env.OPENLIB_STORAGE_METADATA_TIMEOUT_MS;
    delete process.env.OPENLIB_STORAGE_DELETE_TIMEOUT_MS;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  const createS3Storage = () =>
    createStorage({
      provider: "s3",
      endpoint,
      bucketName: "test-bucket",
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      forcePathStyle: true,
      region: "us-east-1",
    });

  it("fails a stalled HEAD instead of waiting forever", async () => {
    process.env.OPENLIB_STORAGE_METADATA_TIMEOUT_MS = String(METADATA_TIMEOUT_MS);
    const storage = createS3Storage();

    const startedAt = Date.now();
    await expect(storage.getObjectMetadata("some/key.bin")).rejects.toThrow(
      new RegExp(`timed out after ${METADATA_TIMEOUT_MS}ms`),
    );
    const elapsedMs = Date.now() - startedAt;

    expect(elapsedMs).toBeGreaterThanOrEqual(METADATA_TIMEOUT_MS - 100);
    expect(elapsedMs).toBeLessThan(METADATA_TIMEOUT_MS + 5_000);
  });

  it("reports a stalled existence check as missing and says so", async () => {
    process.env.OPENLIB_STORAGE_METADATA_TIMEOUT_MS = String(METADATA_TIMEOUT_MS);
    const storage = createS3Storage();

    const startedAt = Date.now();
    await expect(storage.objectExists("some/key.bin")).resolves.toBe(false);
    expect(Date.now() - startedAt).toBeLessThan(METADATA_TIMEOUT_MS + 5_000);
  });

  it("fails a stalled delete instead of waiting forever", async () => {
    process.env.OPENLIB_STORAGE_DELETE_TIMEOUT_MS = String(METADATA_TIMEOUT_MS);
    const storage = createS3Storage();

    const startedAt = Date.now();
    await expect(storage.deleteObject("some/key.bin")).rejects.toThrow(
      new RegExp(`delete timed out after ${METADATA_TIMEOUT_MS}ms`),
    );
    expect(Date.now() - startedAt).toBeLessThan(METADATA_TIMEOUT_MS + 5_000);
  });

  it("still waits when the deadline is explicitly disabled", async () => {
    process.env.OPENLIB_STORAGE_METADATA_TIMEOUT_MS = "0";
    const storage = createS3Storage();

    const outcome = await Promise.race([
      storage
        .getObjectMetadata("some/key.bin")
        .then(() => "settled" as const)
        .catch(() => "settled" as const),
      new Promise<"waiting">((resolve) => setTimeout(() => resolve("waiting"), 2_500)),
    ]);

    expect(outcome).toBe("waiting");
  });
});
