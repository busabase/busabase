import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalStorage } from "./local";
import { parseStorageUrl } from "./s3";

describe("LocalStorage object metadata", () => {
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  it("returns file size without reading the object body", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openlib-storage-metadata-"));
    roots.push(root);
    const storage = new LocalStorage({ provider: "local", bucketName: "local", localRoot: root });

    await storage.uploadFileToKey(Buffer.from("hello"), "uploads/report.txt", "text/plain");

    await expect(storage.getObjectMetadata("uploads/report.txt")).resolves.toMatchObject({
      key: "uploads/report.txt",
      size: 5,
    });
    await expect(storage.getObjectMetadata("uploads/missing.txt")).resolves.toBeNull();
  });
});

/**
 * Local storage has no browser-direct PUT target, so `generateUploadPresignedUrl`
 * hands back the host app's upload relay. WHERE that relay is mounted is
 * configuration, not a constant: an app that serves local disk from a production
 * build mounts it on a real route (busabase: `/api/storage/upload`), while apps
 * that only use local storage in dev keep the dev-gated default. Pinning the
 * default is what keeps those other 10 apps unchanged.
 */
describe("LocalStorage upload relay URL", () => {
  const make = (localUploadUrl?: string) =>
    new LocalStorage({ provider: "local", bucketName: "local", localUploadUrl });

  it("defaults to the dev relay path", async () => {
    await expect(make().generateUploadPresignedUrl("a/b.png", "image/png")).resolves.toBe(
      "/api/dev/upload?key=a%2Fb.png",
    );
  });

  it("uses the configured relay path", async () => {
    await expect(
      make("/api/storage/upload").generateUploadPresignedUrl("a/b.png", "image/png"),
    ).resolves.toBe("/api/storage/upload?key=a%2Fb.png");
  });

  it("reads base_url and upload_url off STORAGE_URL, each with its own default", () => {
    expect(parseStorageUrl("local:///data/storage")).toMatchObject({
      localBaseUrl: "/uploads",
      localUploadUrl: "/api/dev/upload",
    });
    expect(
      parseStorageUrl("local:///data/storage?base_url=/api/storage&upload_url=/api/storage/upload"),
    ).toMatchObject({
      localBaseUrl: "/api/storage",
      localUploadUrl: "/api/storage/upload",
    });
  });
});
