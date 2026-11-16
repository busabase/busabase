import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { fileTreeFileSchema } from "busabase-contract/domains/filetree/contract";
import type { FileTreeFileVO } from "busabase-contract/types";
import { eq } from "drizzle-orm";
import { LocalStorage, resetStorage } from "openlib/storage";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { closeDb, getDb } from "../src/db";
import { attachments, busabaseAssets } from "../src/db/schema";
import { busabaseRouter } from "../src/router";

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const digest = (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`;
const sourceFiles = [
  { path: "SKILL.md", content: "# File hash comparison\n" },
  ...Array.from({ length: 73 }, (_, i) => ({
    path: `src/file-${String(i).padStart(2, "0")}.ts`,
    content: `export const value${i} = ${i};\n`,
  })),
  { path: "\u{1f4c1}/\u4e2d\u6587.md", content: "# Unicode path\n" },
];

describe("file-tree content hashes — real database and storage", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let nodeId: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-file-hashes-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-file-hashes-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    const created = await client.fileTrees.create({
      type: "skill",
      slug: "file-hash-comparison",
      name: "File hash comparison",
      autoMerge: true,
      mergeMode: "replace",
      files: sourceFiles,
    });
    if (!("node" in created)) throw new Error("Expected a materialized Skill");
    nodeId = created.node.id;
  }, 60_000);

  afterEach(() => vi.restoreAllMocks());
  afterAll(async () => {
    await closeDb();
    resetStorage();
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("compares 75 source files and finds 12 changes with only four listing pages and no content reads", async () => {
    const read = vi
      .spyOn(LocalStorage.prototype, "getObject")
      .mockRejectedValue(new Error("Listing must not fetch Blob content"));
    const remote: FileTreeFileVO[] = [];
    let after: string | undefined;
    let listingRequests = 0;
    for (;;) {
      const page = await client.fileTrees.listFiles({ nodeId, type: "skill", limit: 20, after });
      listingRequests += 1;
      remote.push(...page);
      if (page.length < 20) break;
      after = page.at(-1)?.path;
    }
    expect(listingRequests).toBe(4);
    expect(remote).toHaveLength(75);
    expect(new Set(remote.map((file) => file.path)).size).toBe(75);
    const baseline = new Map(remote.map((file) => [file.path, file.contentHash]));
    for (const file of sourceFiles) expect(baseline.get(file.path)).toBe(digest(file.content));
    const local = sourceFiles.map((file, i) =>
      i < 12 ? { ...file, content: `${file.content}// changed\n` } : file,
    );
    const changed = local.filter((file) => digest(file.content) !== baseline.get(file.path));
    expect(changed.map((file) => file.path)).toEqual(
      sourceFiles.slice(0, 12).map((file) => file.path),
    );
    expect(read).not.toHaveBeenCalled();
  });

  it("returns the same stored hashes in node detail and folder pages, including Unicode paths", async () => {
    const read = vi
      .spyOn(LocalStorage.prototype, "getObject")
      .mockRejectedValue(new Error("Listing must not fetch Blob content"));
    const detail = await client.nodes.get({ nodeId, type: "skill" });
    if (!("files" in detail)) throw new Error("Expected file-tree detail");
    expect(detail.files).toHaveLength(75);
    const entries = await client.fileTrees.listEntries({
      nodeId,
      type: "skill",
      folder: "\u{1f4c1}",
    });
    expect(entries.files).toMatchObject([
      { path: "\u{1f4c1}/\u4e2d\u6587.md", contentHash: digest("# Unicode path\n") },
    ]);
    for (const file of entries.files) {
      expect(detail.files.find((item) => item.path === file.path)?.contentHash).toBe(
        file.contentHash,
      );
    }
    expect(read).not.toHaveBeenCalled();
  });

  it("reports a missing historical hash as null without trying to repair it by reading bytes", async () => {
    const db = await getDb();
    const files = await client.fileTrees.listFiles({ nodeId, type: "skill", limit: 100 });
    const target = files.find((file) => file.path === "src/file-72.ts");
    if (!target) throw new Error("Missing historical fixture");
    const [asset] = await db
      .select({ attachmentId: busabaseAssets.attachmentId })
      .from(busabaseAssets)
      .where(eq(busabaseAssets.id, target.assetId));
    if (!asset?.attachmentId) throw new Error("Missing attachment fixture");
    await db
      .update(attachments)
      .set({ contentHash: null })
      .where(eq(attachments.id, asset.attachmentId));
    try {
      const read = vi
        .spyOn(LocalStorage.prototype, "getObject")
        .mockRejectedValue(new Error("Listing must not fetch Blob content"));
      const listed = await client.fileTrees.listFiles({ nodeId, type: "skill", limit: 100 });
      expect(listed.find((file) => file.path === target.path)?.contentHash).toBeNull();
      expect(read).not.toHaveBeenCalled();
    } finally {
      await db
        .update(attachments)
        .set({ contentHash: target.contentHash })
        .where(eq(attachments.id, asset.attachmentId));
    }
  });

  it("continues to accept older list responses with no contentHash", () => {
    const legacy = {
      path: "README.md",
      name: "README.md",
      size: 1,
      updatedAt: null,
      mimeType: "text/markdown",
      assetId: "legacy-asset",
      displayName: null,
    };
    expect(fileTreeFileSchema.parse(legacy)).not.toHaveProperty("contentHash");
    expect(fileTreeFileSchema.parse({ ...legacy, contentHash: null }).contentHash).toBeNull();
  });

  it("normalizes legacy bare hashes across list/read surfaces and accepts update/delete baselines", async () => {
    const files = [
      { path: "docs/update.txt", content: "original update\n" },
      { path: "docs/delete.txt", content: "original delete\n" },
    ];
    const created = await client.fileTrees.create({
      type: "drive",
      slug: "legacy-hash-format",
      name: "Legacy hash format",
      autoMerge: true,
      mergeMode: "replace",
      files,
    });
    if (!("node" in created)) throw new Error("Expected a materialized Drive");
    const driveId = created.node.id;
    const db = await getDb();
    const original = await client.fileTrees.listFiles({
      nodeId: driveId,
      type: "drive",
      limit: 10,
    });
    for (const file of original) {
      const [asset] = await db
        .select({ attachmentId: busabaseAssets.attachmentId })
        .from(busabaseAssets)
        .where(eq(busabaseAssets.id, file.assetId));
      if (!asset?.attachmentId || !file.contentHash) throw new Error("Missing attachment");
      await db
        .update(attachments)
        .set({ contentHash: file.contentHash.replace(/^sha256:/, "") })
        .where(eq(attachments.id, asset.attachmentId));
    }

    const read = vi
      .spyOn(LocalStorage.prototype, "getObject")
      .mockRejectedValue(new Error("Listing must not fetch Blob content"));
    const first = await client.fileTrees.listFiles({
      nodeId: driveId,
      type: "drive",
      limit: 1,
    });
    const second = await client.fileTrees.listFiles({
      nodeId: driveId,
      type: "drive",
      limit: 1,
      after: first[0]?.path,
    });
    const listed = [...first, ...second];
    const detail = await client.nodes.get({ nodeId: driveId, type: "drive" });
    if (!("files" in detail)) throw new Error("Expected file-tree detail");
    const entries = await client.fileTrees.listEntries({
      nodeId: driveId,
      type: "drive",
      folder: "docs",
    });
    for (const file of files) {
      for (const inventory of [listed, detail.files, entries.files]) {
        expect(inventory.find((item) => item.path === file.path)?.contentHash).toBe(
          digest(file.content),
        );
      }
    }
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
    for (const file of files) {
      const body = await client.fileTrees.readFile({
        nodeId: driveId,
        type: "drive",
        filePath: file.path,
      });
      expect(body.contentHash).toBe(digest(file.content));
      expect(body.content).toBe(file.content);
    }

    const changed = await client.fileTrees.createChangeRequest({
      nodeId: driveId,
      type: "drive",
      autoMerge: true,
      operations: [
        {
          kind: "update",
          path: "docs/update.txt",
          content: "updated\n",
          baseContentHash: digest("original update\n"),
        },
        {
          kind: "delete",
          path: "docs/delete.txt",
          baseContentHash: digest("original delete\n"),
        },
      ],
    });
    expect(changed.status).toBe("merged");
    const remaining = await client.fileTrees.listFiles({
      nodeId: driveId,
      type: "drive",
      limit: 10,
    });
    expect(remaining.map((file) => file.path)).toEqual(["docs/update.txt"]);
    expect(remaining[0]?.contentHash).toBe(digest("updated\n"));
    expect(
      (
        await client.fileTrees.readFile({
          nodeId: driveId,
          type: "drive",
          filePath: "docs/update.txt",
        })
      ).content,
    ).toBe("updated\n");
  });

  it("uses a normalized legacy listing hash as a baseline and refuses it after another edit", async () => {
    const db = await getDb();
    const initial = await client.fileTrees.listFiles({ nodeId, type: "skill", limit: 100 });
    const target = initial.find((file) => file.path === "src/file-00.ts");
    if (!target?.contentHash) throw new Error("Missing concurrency fixture");
    const [asset] = await db
      .select({ attachmentId: busabaseAssets.attachmentId })
      .from(busabaseAssets)
      .where(eq(busabaseAssets.id, target.assetId));
    if (!asset?.attachmentId) throw new Error("Missing concurrency attachment");
    await db
      .update(attachments)
      .set({ contentHash: target.contentHash.replace(/^sha256:/, "") })
      .where(eq(attachments.id, asset.attachmentId));
    const listed = await client.fileTrees.listFiles({ nodeId, type: "skill", limit: 100 });
    const original = listed.find((file) => file.path === "src/file-00.ts");
    if (!original?.contentHash) throw new Error("Missing concurrency baseline");
    const pending = await client.fileTrees.createChangeRequest({
      nodeId,
      type: "skill",
      autoMerge: false,
      operations: [
        {
          kind: "update",
          path: original.path,
          content: "export const proposed = true;\n",
          baseContentHash: original.contentHash,
        },
      ],
    });
    const updated = await client.fileTrees.createChangeRequest({
      nodeId,
      type: "skill",
      autoMerge: true,
      operations: [
        {
          kind: "update",
          path: original.path,
          content: "export const concurrent = true;\n",
          baseContentHash: original.contentHash,
        },
      ],
    });
    expect(updated.status).toBe("merged");
    await client.changeRequests.review({ changeRequestIds: [pending.id], verdict: "approved" });
    const result = await client.changeRequests.merge({ changeRequestIds: [pending.id] });
    expect(result.results[0]).toMatchObject({
      ok: false,
      error: expect.stringContaining("file changed before merge"),
    });
    const actual = await client.fileTrees.readFile({
      nodeId,
      type: "skill",
      filePath: original.path,
    });
    expect(actual.content).toBe("export const concurrent = true;\n");
  });

  it("keeps a proposal-only actor in_review and does not change the file", async () => {
    const before = await client.fileTrees.readFile({
      nodeId,
      type: "skill",
      filePath: "src/file-01.ts",
    });
    const proposed = await runWithBusabaseContext(
      {
        spaceId: LOCAL_SPACE_ID,
        actorId: "proposal-only-agent",
        permissionLevel: "changeRequest",
        permissionLevelIsCeiling: true,
        isSpaceManager: false,
      },
      () =>
        client.fileTrees.createChangeRequest({
          nodeId,
          type: "skill",
          operations: [
            {
              kind: "update",
              path: "src/file-01.ts",
              content: "proposal\n",
              baseContentHash: before.contentHash,
            },
          ],
        }),
    );
    expect(proposed.status).toBe("in_review");
    const after = await client.fileTrees.readFile({
      nodeId,
      type: "skill",
      filePath: "src/file-01.ts",
    });
    expect(after.contentHash).toBe(before.contentHash);
  });
});
