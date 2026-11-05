import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getContextSpaceId } from "../src/context";
import { getDb } from "../src/db";
import { attachments } from "../src/db/schema";
import { busabaseAssets, busabaseAssetUsages } from "../src/domains/assets/schema/assets";
import { busabaseRouter } from "../src/router";

/**
 * `assets.list` used to return the space's entire library whenever the caller
 * omitted `limit`, which is what the Assets gallery did — one response, one row
 * per asset ever uploaded. The unpaged call is now bounded; these fixtures sit
 * above that bound so the bound, the paging walk, and the log line that names
 * the caller can all be checked against real rows.
 *
 * Usage rows are inserted directly: the real write path would spend minutes of
 * storage I/O producing rows this test only counts.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
/** Contract page ceiling — the largest page a caller may ask for. */
const PAGE_MAX = 200;
const TOTAL_ASSETS = 1_005;
/** The Drive's own entry file is an asset too, so the library is one row bigger. */
const EXPECTED_ROWS = TOTAL_ASSETS + 1;

describe("assets.list paging", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-assets-paging-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-assets-paging-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    // The assets have to be *visible*, and an asset with no usage is only
    // visible to a manager or to whoever staged it — so every fixture hangs off
    // one Drive, which is the shape the gallery sees in a real space.
    const drive = await client.fileTrees.create({
      type: "drive",
      autoMerge: true,
      mergeMode: "replace",
      slug: "asset-paging-drive",
      name: "Asset Paging Drive",
    } as never);
    if (!("node" in drive)) throw new Error("expected an immediate node (autoMerge: true)");

    const db = await getDb();
    const spaceId = getContextSpaceId();
    // One physical attachment stands in for every fixture asset; the list only
    // joins it for file metadata and never reads its bytes.
    await db.insert(attachments).values({
      id: "att-paging",
      storageKey: "attachments/test/paging.md",
      fileName: "paging.md",
      mimeType: "text/markdown",
      sizeBytes: 7,
      userId: "local-producer",
      spaceId,
    });
    for (let start = 0; start < TOTAL_ASSETS; start += 500) {
      const slice = Array.from(
        { length: Math.min(500, TOTAL_ASSETS - start) },
        (_, index) => start + index,
      );
      await db.insert(busabaseAssets).values(
        slice.map((index) => ({
          id: `asset-page-${String(index).padStart(4, "0")}`,
          spaceId,
          attachmentId: "att-paging",
          name: `page-${String(index).padStart(4, "0")}.md`,
          contentKind: "text" as const,
        })),
      );
      await db.insert(busabaseAssetUsages).values(
        slice.map((index) => ({
          id: `usage-page-${String(index).padStart(4, "0")}`,
          spaceId,
          assetId: `asset-page-${String(index).padStart(4, "0")}`,
          ownerType: "drive" as const,
          nodeId: drive.node.id,
          path: `files/page-${String(index).padStart(4, "0")}.md`,
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

  it("bounds an unpaged call and names the caller once per window", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const first = await client.assets.list();
      // Bounded, not empty: a caller that never pages still gets a usable first
      // slice, which is what keeps the gallery working after this change.
      expect(first).toHaveLength(1_000);
      expect(first[0]?.id).not.toBe(first.at(-1)?.id);

      const logged = warn.mock.calls.map((call) => String(call[0]));
      const unpaged = logged.filter((line) => line.includes("[assets.list] no limit given"));
      expect(unpaged).toHaveLength(1);
      expect(unpaged[0]).toContain(`space ${getContextSpaceId()}`);
      expect(unpaged[0]).toContain("returning at most 1000 assets");
      expect(unpaged[0]).toContain("Page with limit + cursor.");

      // A polling client must not turn this into a log flood: the second call
      // inside the same window counts, but does not print.
      await client.assets.list();
      const afterSecond = warn.mock.calls
        .map((call) => String(call[0]))
        .filter((line) => line.includes("[assets.list] no limit given"));
      expect(afterSecond).toHaveLength(1);
    } finally {
      // The module-level window map is shared by later cases; clear the spy but
      // leave the map, so the next case asserts on a fresh console only.
      warn.mockRestore();
    }
  });

  it("walks the whole library with limit + cursor, and does not log", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 20; page += 1) {
        const rows: Awaited<ReturnType<typeof client.assets.list>> = await client.assets.list({
          limit: PAGE_MAX,
          ...(cursor ? { cursor } : {}),
        } as never);
        seen.push(...rows.map((row) => row.id));
        if (rows.length < PAGE_MAX) break;
        cursor = rows.at(-1)?.id;
        expect(cursor).toBeDefined();
      }
      expect(seen).toHaveLength(EXPECTED_ROWS);
      expect(new Set(seen).size).toBe(EXPECTED_ROWS);
      expect(
        warn.mock.calls
          .map((call) => String(call[0]))
          .filter((line) => line.includes("[assets.list] no limit given")),
      ).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });

  it("rejects an unknown cursor instead of silently restarting", async () => {
    await expect(
      client.assets.list({ limit: PAGE_MAX, cursor: "asset-does-not-exist" } as never),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
