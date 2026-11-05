import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getContextSpaceId } from "../src/context";
import { getDb } from "../src/db";
import { attachments } from "../src/db/schema";
import { busabaseAssets, busabaseAssetUsages } from "../src/domains/assets/schema/assets";
import { busabaseRouter } from "../src/router";

/**
 * A folder's subfolders are capped per response. Without a cursor for them, a
 * Drive whose root holds more than the cap (1,000 here) made the rest of the
 * tree unreachable: the files were in the database, but no request could name
 * the folders that lead to them.
 *
 * Usage rows are inserted directly — the real write path would spend minutes of
 * storage I/O producing rows this test only counts.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
/** `FILE_TREE_ENTRIES_FOLDER_MAX` — the most subfolders one response names. */
const FOLDER_MAX = 1_000;
const TOTAL_FOLDERS = 1_005;

describe("fileTrees.listEntries — subfolder cursor", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let nodeId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-folder-cursor-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-folder-cursor-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const drive = await client.fileTrees.create({
      type: "drive",
      autoMerge: true,
      mergeMode: "replace",
      slug: "folder-cursor-drive",
      name: "Folder Cursor Drive",
      files: [{ path: "root-file.md", content: "# root\n" }],
    } as never);
    if (!("node" in drive)) throw new Error("expected an immediate node (autoMerge: true)");
    nodeId = drive.node.id;

    const db = await getDb();
    const spaceId = getContextSpaceId();
    // One physical attachment stands in for every fixture asset.
    await db.insert(attachments).values({
      id: "att-folder-cursor",
      storageKey: "attachments/test/folder-cursor.md",
      fileName: "folder-cursor.md",
      mimeType: "text/markdown",
      sizeBytes: 7,
      userId: "local-producer",
      spaceId,
    });
    for (let start = 0; start < TOTAL_FOLDERS; start += 250) {
      const slice = Array.from(
        { length: Math.min(250, TOTAL_FOLDERS - start) },
        (_, index) => start + index,
      );
      const ids = slice.map((index) => String(index).padStart(4, "0"));
      await db.insert(busabaseAssets).values(
        ids.map((id) => ({
          id: `asset-folder-${id}`,
          spaceId,
          attachmentId: "att-folder-cursor",
          name: `${id}.md`,
          contentKind: "text" as const,
        })),
      );
      await db.insert(busabaseAssetUsages).values(
        ids.map((id) => ({
          id: `usage-folder-${id}`,
          spaceId,
          assetId: `asset-folder-${id}`,
          ownerType: "drive" as const,
          nodeId,
          path: `dir-${id}/one.md`,
        })),
      );
    }
  });

  afterAll(async () => {
    process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("names the cap, says it is truncated, and hands back a subfolder cursor", async () => {
    const first = await client.fileTrees.listEntries({ nodeId, type: "drive" });
    expect(first.folders).toHaveLength(FOLDER_MAX);
    expect(first.foldersTruncated).toBe(true);
    expect(first.foldersNextCursor).toBe(first.folders.at(-1)?.name ?? null);
    expect(first.foldersNextCursor).not.toBeNull();
    // Files are unaffected by the folder cap: the root's own file still arrives.
    expect(first.files.map((file) => file.path)).toEqual(["root-file.md"]);
    expect(first.nextCursor).toBeNull();
  });

  it("reaches every subfolder by following the cursor", async () => {
    const seen: string[] = [];
    let foldersAfter: string | undefined;
    for (let page = 0; page < 5; page += 1) {
      const read = await client.fileTrees.listEntries({
        nodeId,
        type: "drive",
        ...(foldersAfter === undefined ? {} : { foldersAfter }),
      } as never);
      seen.push(...read.folders.map((folder) => folder.path));
      // A cursor page carries subfolders only — the files already arrived with
      // the uncursored first page.
      if (foldersAfter !== undefined) expect(read.files).toEqual([]);
      if (read.foldersNextCursor === null) break;
      foldersAfter = read.foldersNextCursor;
    }
    expect(seen).toHaveLength(TOTAL_FOLDERS);
    expect(new Set(seen).size).toBe(TOTAL_FOLDERS);
  });

  it("keeps a hidden folder readable once its cursor page names it", async () => {
    // `dir-1004` sorts past the cap, so the first page cannot name it. The
    // cursor page is the only browser path that reaches it.
    const first = await client.fileTrees.listEntries({ nodeId, type: "drive" });
    expect(first.folders.map((folder) => folder.name)).not.toContain("dir-1004");

    const next = await client.fileTrees.listEntries({
      nodeId,
      type: "drive",
      foldersAfter: first.foldersNextCursor ?? "",
    } as never);
    expect(next.folders.map((folder) => folder.name)).toContain("dir-1004");

    const deep = await client.fileTrees.listEntries({
      nodeId,
      type: "drive",
      folder: "dir-1004",
    });
    expect(deep.files.map((file) => file.path)).toEqual(["dir-1004/one.md"]);
  });
});
