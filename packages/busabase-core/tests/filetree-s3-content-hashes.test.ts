import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { isLocalStorageProvider, resetStorage, S3Storage, storage } from "openlib/storage";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, getDb } from "../src/db";
import { attachments, busabaseAssets } from "../src/db/schema";
import { busabaseRouter } from "../src/router";

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const digest = (bytes: Buffer | string) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

// Use an isolated bucket on a local S3-compatible service. The URL must include
// auto_create=true and force_path_style=true, with task-only credentials.
const s3Url = process.env.BUSABASE_TEST_S3_URL;
describe.skipIf(!s3Url)("file-tree hashes with real S3 HTTP and database", () => {
  const client = createRouterClient(busabaseRouter);
  const previousDatabaseUrl = process.env.PG_DATABASE_URL;
  const previousStorageUrl = process.env.STORAGE_URL;
  let originalCwd = "";
  let dataDir = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-s3-hashes-db-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = s3Url;
    resetStorage();
    expect(isLocalStorageProvider()).toBe(false);
  }, 60_000);

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    await closeDb();
    resetStorage();
    if (previousDatabaseUrl === undefined) delete process.env.PG_DATABASE_URL;
    else process.env.PG_DATABASE_URL = previousDatabaseUrl;
    if (previousStorageUrl === undefined) delete process.env.STORAGE_URL;
    else process.env.STORAGE_URL = previousStorageUrl;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  const upload = async (fileName: string, bytes: Buffer, contentHash: string) => {
    const input = {
      fileName,
      mimeType: "application/octet-stream",
      sizeBytes: bytes.length,
      contentHash,
    };
    const requested = await client.assets.createUploadUrl(input);
    if (!requested.uploadUrl) throw new Error("Expected a presigned upload URL");
    const response = await fetch(requested.uploadUrl, {
      method: "PUT",
      headers: {
        "content-type": input.mimeType,
        "content-length": String(bytes.length),
        "content-disposition": `attachment; filename="${fileName}"`,
      },
      body: bytes,
    });
    expect(response.status, await response.text()).toBe(200);
    const confirmed = await client.assets.confirm({
      ...input,
      storageKey: requested.storageKey,
    });
    if (!confirmed.assetId) throw new Error("Expected an uploaded Asset");
    expect(await storage.getObject(requested.storageKey)).toEqual(bytes);
    expect((await storage.getObjectMetadata(requested.storageKey))?.size).toBe(bytes.length);
    return { assetId: confirmed.assetId, storageKey: requested.storageKey };
  };

  it("lists recorded direct-upload hashes without claiming the S3 bytes were verified", async () => {
    const goodBytes = Buffer.from("correct S3 upload bytes");
    const wrongBytes = Buffer.from("different S3 upload bytes");
    const claimedHash = digest(Buffer.alloc(wrongBytes.length, 7));
    expect(claimedHash).not.toBe(digest(wrongBytes));
    const good = await upload("correct.bin", goodBytes, digest(goodBytes));
    // A cloud caller can declare a well-formed but wrong hash. Confirmation
    // currently persists it: normalization must not silently imply verification.
    const wrong = await upload("declared.bin", wrongBytes, claimedHash.slice(7));
    const drive = await client.fileTrees.create({
      type: "drive",
      autoMerge: true,
      slug: "s3-recorded-hashes",
      name: "S3 recorded hashes",
      files: [
        { path: "correct.bin", assetId: good.assetId },
        { path: "declared.bin", assetId: wrong.assetId },
      ],
    });
    if (!("node" in drive)) throw new Error("Expected a materialized Drive");

    const db = await getDb();
    const [recorded] = await db
      .select({ contentHash: attachments.contentHash })
      .from(busabaseAssets)
      .innerJoin(attachments, eq(busabaseAssets.attachmentId, attachments.id))
      .where(eq(busabaseAssets.id, wrong.assetId));
    expect(recorded?.contentHash).toBe(claimedHash.slice(7));

    const get = vi.spyOn(S3Storage.prototype, "getObject");
    const range = vi.spyOn(S3Storage.prototype, "getObjectRange");
    const files = await client.fileTrees.listFiles({
      nodeId: drive.node.id,
      type: "drive",
      limit: 100,
    });
    expect(files.find((file) => file.path === "correct.bin")?.contentHash).toBe(digest(goodBytes));
    expect(files.find((file) => file.path === "declared.bin")?.contentHash).toBe(claimedHash);
    expect(get).not.toHaveBeenCalled();
    expect(range).not.toHaveBeenCalled();

    const deleted = await client.fileTrees.createChangeRequest({
      nodeId: drive.node.id,
      type: "drive",
      autoMerge: true,
      operations: [{ kind: "delete", path: "declared.bin", baseContentHash: claimedHash }],
    });
    expect(deleted.status).toBe("merged");
    // A successful concurrency check compares the recorded baseline, rather
    // than certifying that the hash describes the object's actual bytes.
    expect(get).not.toHaveBeenCalled();
    expect(range).not.toHaveBeenCalled();
  });

  it("computes hashes from server-received file contents even with S3 storage", async () => {
    const content = "# Server received these bytes\n";
    const created = await client.fileTrees.create({
      type: "skill",
      autoMerge: true,
      slug: "s3-server-computed-hash",
      name: "S3 server computed hash",
      files: [{ path: "SKILL.md", content }],
    });
    if (!("node" in created)) throw new Error("Expected a materialized Skill");
    const files = await client.fileTrees.listFiles({
      nodeId: created.node.id,
      type: "skill",
      limit: 100,
    });
    expect(files[0]?.contentHash).toBe(digest(content));
    const read = await client.fileTrees.readFile({
      nodeId: created.node.id,
      type: "skill",
      filePath: "SKILL.md",
    });
    expect(read.content).toBe(content);
    expect(read.contentHash).toBe(digest(content));
  });
});
