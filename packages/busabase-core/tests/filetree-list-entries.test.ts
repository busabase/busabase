import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * `fileTrees.listEntries` reads one folder: its direct subfolders and a page of
 * its direct files. It is how a 46k-file Drive is browsed without listing every
 * file, so what matters is that each folder sees exactly its own children and
 * that look-alike names (`docs-old`, `docs.md`) never leak into `docs/`.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

const PATHS = [
  "a.md",
  "docs.md",
  "docs-old/x.md",
  "docs/guide.md",
  "docs/intro.md",
  "docs/api/one.md",
  "docs/api/two.md",
  "docs/api/deep/three.md",
  "docs/zh/readme.md",
  "100%_done/file.md",
  // Non-BMP names: JS `length` counts these as two code units each, Postgres
  // `char_length` as one. The folder prefix used to be sliced with the former,
  // which emptied the folder (see the emoji case below).
  "📁/a.md",
  "📁/sub/b.md",
  "🐱/c.md",
];

describe("fileTrees.listEntries — one folder at a time", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let nodeId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-entries-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-entries-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    const drive = await client.fileTrees.create({
      type: "drive",
      autoMerge: true,
      mergeMode: "replace",
      slug: "entries-drive",
      name: "Entries Drive",
      files: PATHS.map((filePath) => ({ path: filePath, content: `# ${filePath}\n` })),
    } as never);
    if (!("node" in drive)) throw new Error("expected an immediate node (autoMerge: true)");
    nodeId = drive.node.id;
  });

  afterAll(async () => {
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
    process.chdir(originalCwd);
  });

  const entries = (input: { folder?: string; limit?: number; after?: string } = {}) =>
    client.fileTrees.listEntries({ nodeId, type: "drive", ...input });

  it("lists the root's direct folders and files only", async () => {
    const root = await entries();
    expect(root.folder).toBe("");
    expect(root.folders.map((folder) => folder.path).sort()).toEqual(
      ["100%_done", "docs", "docs-old", "🐱", "📁"].sort(),
    );
    expect(root.files.map((file) => file.path)).toEqual(["a.md", "docs.md"]);
    expect(root.foldersTruncated).toBe(false);
    expect(root.foldersNextCursor).toBeNull();
    expect(root.nextCursor).toBeNull();
  });

  it("lists a nested folder without its look-alike siblings", async () => {
    const docs = await entries({ folder: "docs" });
    expect(docs.folders).toEqual([
      { name: "api", path: "docs/api" },
      { name: "zh", path: "docs/zh" },
    ]);
    // Not `docs.md` or `docs-old/x.md`, and not the files under docs/api.
    expect(docs.files.map((file) => file.path)).toEqual(["docs/guide.md", "docs/intro.md"]);

    const api = await entries({ folder: "docs/api/" });
    expect(api.folder).toBe("docs/api");
    expect(api.folders.map((folder) => folder.path)).toEqual(["docs/api/deep"]);
    expect(api.files.map((file) => file.path)).toEqual(["docs/api/one.md", "docs/api/two.md"]);
  });

  it("treats LIKE metacharacters in a folder name literally", async () => {
    const odd = await entries({ folder: "100%_done" });
    expect(odd.files.map((file) => file.path)).toEqual(["100%_done/file.md"]);
  });

  it("pages a folder's files with the cursor, listing subfolders only once", async () => {
    const first = await entries({ folder: "docs", limit: 1 });
    expect(first.files.map((file) => file.path)).toEqual(["docs/guide.md"]);
    expect(first.folders).toHaveLength(2);
    expect(first.nextCursor).toBe("docs/guide.md");

    const second = await entries({ folder: "docs", limit: 1, after: first.nextCursor ?? "" });
    expect(second.files.map((file) => file.path)).toEqual(["docs/intro.md"]);
    expect(second.folders).toEqual([]);
    expect(second.nextCursor).toBeNull();
  });

  it("lists a folder whose name is outside the Basic Multilingual Plane", async () => {
    // `📁/` is 3 UTF-16 code units but 2 characters. Counting code units sliced
    // `📁/a.md` down to `📁/a`, so the prefix never matched and the folder
    // looked empty — for a legal name, in a Drive too big to list in one go.
    const emoji = await entries({ folder: "📁" });
    expect(emoji.folder).toBe("📁");
    expect(emoji.folders).toEqual([{ name: "sub", path: "📁/sub" }]);
    expect(emoji.files.map((file) => file.path)).toEqual(["📁/a.md"]);

    const nested = await entries({ folder: "📁/sub" });
    expect(nested.folders).toEqual([]);
    expect(nested.files.map((file) => file.path)).toEqual(["📁/sub/b.md"]);
    // …and the same name at the root is not confused with its look-alikes.
    expect((await entries({ folder: "🐱" })).files.map((file) => file.path)).toEqual(["🐱/c.md"]);
  });

  it("returns an empty folder for a path that has no files", async () => {
    const missing = await entries({ folder: "nope" });
    expect(missing).toMatchObject({ folders: [], files: [], nextCursor: null });
  });

  it("refuses a folder path that escapes the node", async () => {
    await expect(entries({ folder: "../etc" })).rejects.toThrow(/Invalid file path/);
    await expect(entries({ folder: "/docs" })).rejects.toThrow(/do not start with/);
  });
});
