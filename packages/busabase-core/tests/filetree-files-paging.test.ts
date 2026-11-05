import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "../src/db";
import { busabaseAssetUsages } from "../src/domains/assets/schema/assets";
import { getFileTreeNode, resolveFileTreeKind } from "../src/domains/filetree/handlers";
import { busabaseRouter } from "../src/router";

/**
 * A file-tree node's detail used to embed EVERY file it holds, with no limit.
 *
 * That is fine for a Skill and fatal for a Drive: production has a 46k-file
 * Drive, and the dashboard re-reads the open node whenever the live stream
 * reconnects. The response is the problem, not the query — the filter is an
 * indexed few milliseconds, but the payload materialises every row plus two
 * joined lookups each.
 *
 * So `nodes.get` now embeds a bounded page and reports `fileCount` /
 * `filesTruncated`, and `fileTrees.listFiles` pages with `limit` + a path
 * cursor (`after`), keeping `offset` for older callers.
 * Driven through the real router against a real PGlite database, because the
 * thing worth pinning is what the surface actually returns.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

/**
 * The order the server returns: by path, with the `README.md` a new Drive is
 * seeded with, and a subfolder so paging has to cross a folder boundary.
 */
const SEEDED_PATHS = ["README.md", "a.md", "b.md", "c.md", "dir/d.md", "dir/e.md", "z.md"];

describe("fileTrees.listFiles — pages, and a bounded node detail", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let nodeId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-files-paging-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-files-paging-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const drive = await client.fileTrees.create({
      type: "drive",
      autoMerge: true,
      slug: "paging-drive",
      name: "Paging Drive",
      files: SEEDED_PATHS.filter((filePath) => filePath !== "README.md").map((filePath) => ({
        path: filePath,
        content: `# ${filePath}\n`,
      })),
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

  it("counts the node honestly instead of inferring a total from the payload", async () => {
    const detail = await client.nodes.get({ nodeId, type: "drive" });
    if (!("files" in detail)) throw new Error("expected a file-tree detail");
    expect(detail.files.map((file) => file.path)).toEqual(SEEDED_PATHS);
    // A node under the inline limit is complete, and says so — not truncated.
    expect(detail.fileCount).toBe(SEEDED_PATHS.length);
    expect(detail.filesTruncated).toBe(false);
  });

  it("embeds a bounded page and reports the real total when the node is too big", async () => {
    const config = await resolveFileTreeKind(nodeId, "drive");
    // The production cap is 1,000; three exercises the same branch without
    // seeding thousands of files.
    const detail = await getFileTreeNode(config, nodeId, { inlineFileLimit: 3 });
    if (!("files" in detail)) throw new Error("expected a file-tree detail");
    expect(detail.files.map((file) => file.path)).toEqual(SEEDED_PATHS.slice(0, 3));
    expect(detail.filesTruncated).toBe(true);
    // The count comes from the table, not from the rows that were sent — the
    // whole point is that a client can still tell the user "7 files".
    expect(detail.fileCount).toBe(SEEDED_PATHS.length);
    // And the rest stays reachable: capping the inline list must not make a
    // file unreachable.
    const rest = await client.fileTrees.listFiles({
      nodeId,
      type: "drive",
      limit: 100,
      after: detail.files.at(-1)?.path,
    });
    expect(rest.map((file) => file.path)).toEqual(SEEDED_PATHS.slice(3));
  });

  it("pages by path cursor, and the pages tile the whole list exactly once", async () => {
    const collected: string[] = [];
    const pageSize = 2;
    let after: string | undefined;
    for (;;) {
      const page = await client.fileTrees.listFiles({
        nodeId,
        type: "drive",
        limit: pageSize,
        after,
      });
      collected.push(...page.map((file) => file.path));
      after = page.at(-1)?.path;
      if (page.length < pageSize) break;
    }
    // Crosses the `dir/` boundary: the cursor is a plain path comparison, the
    // same order the server sorts by.
    expect(collected).toEqual(SEEDED_PATHS);
  });

  it("still honours offset for older callers, and lets the cursor win", async () => {
    const byOffset = await client.fileTrees.listFiles({
      nodeId,
      type: "drive",
      limit: 2,
      offset: 2,
    });
    expect(byOffset.map((file) => file.path)).toEqual(SEEDED_PATHS.slice(2, 4));
    const both = await client.fileTrees.listFiles({
      nodeId,
      type: "drive",
      limit: 2,
      offset: 5,
      after: "README.md",
    });
    expect(both.map((file) => file.path)).toEqual(["a.md", "b.md"]);
  });

  it("does not count a whole-node usage as a file", async () => {
    // An empty `path` is how a Doc body / Base field references an asset. The
    // list always hid these rows; the count must agree with the list.
    const db = await getDb();
    const [usage] = await db
      .select()
      .from(busabaseAssetUsages)
      .where(eq(busabaseAssetUsages.nodeId, nodeId))
      .limit(1);
    if (!usage) throw new Error("expected a seeded usage");
    await db.insert(busabaseAssetUsages).values({ ...usage, id: "usage-whole-node", path: "" });
    const config = await resolveFileTreeKind(nodeId, "drive");
    const detail = await getFileTreeNode(config, nodeId, { inlineFileLimit: 3 });
    expect(detail.fileCount).toBe(SEEDED_PATHS.length);
    const all = await client.fileTrees.listFiles({ nodeId, type: "drive" });
    expect(all.map((file) => file.path)).toEqual(SEEDED_PATHS);
  });

  it("returns nothing past the end rather than wrapping around", async () => {
    expect(
      await client.fileTrees.listFiles({ nodeId, type: "drive", limit: 2, offset: 99 }),
    ).toEqual([]);
  });

  it("still returns a small node's whole list when no limit is asked for", async () => {
    // Existing REST/mobile callers ask for no page. Below the 5,000 page ceiling that
    // is still a complete answer; above it, they get the first page (see
    // `filetree-files-cap.test.ts`), which is the only way to stop an unpaged
    // caller from pulling a whole 46k-file Drive out of the database.
    const all = await client.fileTrees.listFiles({ nodeId, type: "drive" });
    expect(all.map((file) => file.path)).toEqual(SEEDED_PATHS);
  });
});
