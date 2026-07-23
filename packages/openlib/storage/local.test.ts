import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalStorage } from "./local";

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
