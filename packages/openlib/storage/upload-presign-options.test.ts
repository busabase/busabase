import { describe, expect, it } from "vitest";
import { LocalStorage } from "./local";
import { S3Storage } from "./s3";

/**
 * `generateUploadPresignedUrl(key, mime, expiresIn, options)` — the optional
 * `{ contentLength, contentDisposition }` bind the upload to exactly what the
 * server agreed to. Signing is offline (no request leaves the process), so the
 * real AWS presigner runs here; only the bucket bootstrap calls are skipped.
 */
const makeS3 = () => {
  const storage = new S3Storage({
    provider: "s3",
    bucketName: "bucket",
    endpoint: "http://127.0.0.1:9",
    accessKeyId: "test",
    secretAccessKey: "test",
    region: "us-east-1",
    forcePathStyle: true,
    autoCreateBucket: false,
  });
  // `ensureCorsConfigured` talks to the endpoint; nothing in this test is about CORS.
  (storage as unknown as { corsConfigured: boolean }).corsConfigured = true;
  return storage;
};

const signedHeaders = (url: string) =>
  (new URL(url).searchParams.get("X-Amz-SignedHeaders") ?? "").split(";").sort();

describe("S3Storage.generateUploadPresignedUrl options", () => {
  it("keeps the old signature when no options are passed", async () => {
    const url = await makeS3().generateUploadPresignedUrl("a/b.png", "image/png", 600);
    expect(signedHeaders(url)).toEqual(["host"]);
    expect(new URL(url).searchParams.get("X-Amz-Expires")).toBe("600");
  });

  it("signs content-length, content-disposition and content-type when bound", async () => {
    const url = await makeS3().generateUploadPresignedUrl("a/b.png", "image/png", 600, {
      contentLength: 1234,
      contentDisposition: "attachment",
    });
    expect(signedHeaders(url)).toEqual([
      "content-disposition",
      "content-length",
      "content-type",
      "host",
    ]);
  });

  it("signs only what was asked for", async () => {
    const url = await makeS3().generateUploadPresignedUrl("a/b.png", "image/png", 600, {
      contentLength: 10,
    });
    expect(signedHeaders(url)).toEqual(["content-length", "content-type", "host"]);
  });
});

describe("LocalStorage.generateUploadPresignedUrl options", () => {
  it("accepts and ignores the options (the relay has nothing to sign)", async () => {
    const storage = new LocalStorage({ provider: "local", bucketName: "local" });
    await expect(
      storage.generateUploadPresignedUrl("a/b.png", "image/png", 600, {
        contentLength: 5,
        contentDisposition: "attachment",
      }),
    ).resolves.toBe("/api/dev/upload?key=a%2Fb.png");
  });
});
