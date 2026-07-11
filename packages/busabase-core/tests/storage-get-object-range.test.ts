import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `IStorage.getObjectRange` coverage for both implementations. Lives in
 * busabase-core's test harness (openlib has no wired-up test runner —
 * `packages/openlib/storage/factory.test.ts` exists but nothing executes it;
 * see the Drive Grep Retrieval PR report) but the classes are plain,
 * dependency-injectable exports safely testable from any package.
 */

const sendMock = vi.fn();

vi.mock("@aws-sdk/client-s3", () => {
  class GetObjectCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  class S3Client {
    send = sendMock;
  }
  class PutObjectCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  }
  return { GetObjectCommand, PutObjectCommand, S3Client };
});

describe("LocalStorage.getObjectRange", () => {
  let dir = "";

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "busabase-range-test-"));
  });

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("returns the exact inclusive byte window via fs.createReadStream", async () => {
    const { LocalStorage } = await import("openlib/storage");
    const storage = new LocalStorage({ localRoot: dir, bucketName: "local" });
    const content = Buffer.from("0123456789ABCDEFGHIJ");
    await storage.uploadFileToKey(content, "sample.txt", "text/plain");

    const range = await storage.getObjectRange("sample.txt", 2, 5);
    // HTTP Range / Node's `end` option are both inclusive: bytes 2,3,4,5.
    expect(range.toString("utf8")).toBe("2345");
    expect(range.equals(content.subarray(2, 6))).toBe(true);
  });

  it("returns the whole tail when the range extends past EOF", async () => {
    const { LocalStorage } = await import("openlib/storage");
    const storage = new LocalStorage({ localRoot: dir, bucketName: "local" });
    const content = Buffer.from("short");
    await storage.uploadFileToKey(content, "tail.txt", "text/plain");

    const range = await storage.getObjectRange("tail.txt", 2, 1000);
    expect(range.toString("utf8")).toBe("ort");
  });

  it("throws for a key that does not exist", async () => {
    const { LocalStorage } = await import("openlib/storage");
    const storage = new LocalStorage({ localRoot: dir, bucketName: "local" });
    await expect(storage.getObjectRange("missing.txt", 0, 10)).rejects.toThrow();
  });
});

describe("S3Storage.getObjectRange", () => {
  beforeEach(() => {
    sendMock.mockReset();
  });

  it("sends the correct Range header and returns the concatenated body", async () => {
    sendMock.mockResolvedValue({
      Body: (async function* () {
        yield Buffer.from("hel");
        yield Buffer.from("lo");
      })(),
    });

    const { S3Storage } = await import("openlib/storage");
    const storage = new S3Storage({
      provider: "s3",
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      bucketName: "test-bucket",
      region: "us-east-1",
    });

    const result = await storage.getObjectRange("some/key.txt", 10, 19);

    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0]?.[0] as { input: Record<string, unknown> };
    expect(command.input).toMatchObject({
      Bucket: "test-bucket",
      Key: "some/key.txt",
      Range: "bytes=10-19",
    });
    expect(result.toString("utf8")).toBe("hello");
  });

  it("throws when the object has no body", async () => {
    sendMock.mockResolvedValue({ Body: undefined });
    const { S3Storage } = await import("openlib/storage");
    const storage = new S3Storage({
      provider: "s3",
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      bucketName: "test-bucket",
      region: "us-east-1",
    });
    await expect(storage.getObjectRange("missing.txt", 0, 10)).rejects.toThrow(/not found/);
  });

  it("returns an empty Buffer (not a throw) for a 416 Range Not Satisfiable response", async () => {
    // Regression: `readObjectInChunks`'s EOF probe issues one more
    // `getObjectRange` call past the end of the object whenever its size is
    // an exact multiple of the chunk size (or the object is 0 bytes) — S3/R2
    // answer a range starting at/past EOF with 416 `InvalidRange`, which the
    // AWS SDK surfaces as a thrown error. `LocalStorage.getObjectRange` has
    // no such failure mode (`fs.createReadStream` past EOF just yields
    // nothing), so the two providers used to silently disagree: only S3/R2
    // would throw. `S3Storage.getObjectRange` must normalize this one
    // specific error into an empty Buffer to match.
    const rangeNotSatisfiable = Object.assign(new Error("The requested range is not satisfiable"), {
      name: "InvalidRange",
      $metadata: { httpStatusCode: 416 },
    });
    sendMock.mockRejectedValue(rangeNotSatisfiable);

    const { S3Storage } = await import("openlib/storage");
    const storage = new S3Storage({
      provider: "s3",
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      bucketName: "test-bucket",
      region: "us-east-1",
    });

    const chunkSize = 8 * 1024 * 1024;
    const result = await storage.getObjectRange(
      "exact-multiple-of-chunk-size.bin",
      chunkSize,
      chunkSize * 2 - 1,
    );
    expect(result).toBeInstanceOf(Buffer);
    expect(result.length).toBe(0);
  });

  it("still rethrows a non-416 error unchanged", async () => {
    const otherError = Object.assign(new Error("access denied"), {
      name: "AccessDenied",
      $metadata: { httpStatusCode: 403 },
    });
    sendMock.mockRejectedValue(otherError);

    const { S3Storage } = await import("openlib/storage");
    const storage = new S3Storage({
      provider: "s3",
      accessKeyId: "test-key",
      secretAccessKey: "test-secret",
      bucketName: "test-bucket",
      region: "us-east-1",
    });

    await expect(storage.getObjectRange("some/key.txt", 0, 10)).rejects.toThrow(/access denied/);
  });
});
