import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { storage } from "openlib/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "../src/db";
import { busabaseAssetUsages } from "../src/domains/assets/schema/assets";
import { busabaseRouter } from "../src/router";

/**
 * `search`'s files source applies its query in JS, AFTER a recency-capped SQL
 * window (`MAX_ASSET_USAGE_SCAN_ROWS`, `ORDER BY updated_at DESC`) — so a file
 * that falls outside the newest N asset usages is invisible to search no
 * matter how exactly its name matches.
 *
 * That is a SILENT false negative: the response is a clean empty result set,
 * indistinguishable from "this workspace really has no such file". It is the
 * same failure class #6202 fixed for grep coverage, in a different place, and
 * it is the leading explanation for that PR's production finding that
 * `?sources=files` returned 0 rows for a Drive holding ~889 PDFs.
 *
 * This test pins the mechanism (not the production incident): mount one file
 * whose name carries a unique marker, then push it out of the window with
 * newer usages for an unrelated asset, and assert search can still find it.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const HASH = (byte: string) => `sha256:${byte.repeat(64)}`;

/** Must exceed `MAX_ASSET_USAGE_SCAN_ROWS` (1000) so the target row is evicted from the window. */
const FILLER_USAGES = 1200;
const MARKER = "ZHIHUIMARKER";

describe("search — files source vs the recency window", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  const uploadAsset = async (fileName: string, body: string, hashByte: string) => {
    const sizeBytes = Buffer.byteLength(body, "utf8");
    const contentHash = HASH(hashByte);
    const req = await client.assets.createUploadUrl({
      fileName,
      mimeType: "text/plain",
      sizeBytes,
      contentHash,
    });
    await storage.uploadFileToKey(Buffer.from(body, "utf8"), req.storageKey, "text/plain");
    const confirmed = await client.assets.confirm({
      storageKey: req.storageKey,
      fileName,
      mimeType: "text/plain",
      sizeBytes,
      contentHash,
    });
    if (!confirmed.assetId) throw new Error("Expected an assetId");
    return confirmed.assetId;
  };

  const mountAsFileNode = async (assetId: string, slug: string, name: string) => {
    const cr = await client.nodes.createChangeRequest({
      operations: [
        { kind: "create", nodeType: "file", slug, name, description: "", metadata: { assetId } },
      ],
    });
    await client.changeRequests.review({ changeRequestIds: [cr.id], verdict: "approved" });
    await client.changeRequests.merge({ changeRequestIds: [cr.id] });
    const db = await getDb();
    // Filtered by the asset THIS call just mounted — an unfiltered
    // `LIMIT 1` (no ORDER BY) returns whichever row the engine happens to
    // scan first, which by the second call in this file is the FIRST usage
    // ever inserted (the earlier call's row), not this one. That silently
    // makes every later filler clone (which spreads `...usage`) share the
    // wrong `nodeId`, corrupting node-identity search results in the tests
    // built on top of this helper.
    const [usage] = await db
      .select()
      .from(busabaseAssetUsages)
      .where(eq(busabaseAssetUsages.assetId, assetId))
      .limit(1);
    return usage;
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-search-window-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-search-window-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    // The file the user is looking for. Its NAME carries the marker, so this
    // needs no content scan at all — pure metadata matching.
    const targetAssetId = await uploadAsset(`${MARKER}-manual.txt`, "irrelevant body", "a");
    await mountAsFileNode(targetAssetId, "target-manual", "Target manual");

    // An unrelated asset whose name does NOT match, mounted many times with a
    // NEWER updatedAt — the shape of a workspace that kept accumulating
    // attachments after a Drive was bulk-uploaded.
    const fillerAssetId = await uploadAsset("unrelated.txt", "unrelated body", "b");
    const fillerUsage = await mountAsFileNode(fillerAssetId, "filler-file", "Filler file");
    if (!fillerUsage) throw new Error("Expected a filler usage row to clone");

    const db = await getDb();
    const newer = new Date(Date.now() + 60_000);
    const rows = Array.from({ length: FILLER_USAGES }, (_, i) => ({
      ...fillerUsage,
      id: `usage_filler_${i}`,
      assetId: fillerAssetId,
      path: `filler/${i}.txt`,
      createdAt: newer,
      updatedAt: newer,
    }));
    for (let i = 0; i < rows.length; i += 200) {
      await db.insert(busabaseAssetUsages).values(rows.slice(i, i + 200));
    }
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  // Control: the filler's own name IS inside the window, so it matches. This
  // proves the upload → mount → search pipeline works in this fixture, and
  // isolates the failure below to WHERE the row sits in the recency window
  // rather than to anything about how the file was mounted.
  it("finds a file whose usages sit INSIDE the recency window", async () => {
    const result = await client.search({ query: "unrelated", sources: ["files"] });
    expect(result.results.length).toBeGreaterThan(0);
  });

  it("finds a file by an exact filename marker even when newer usages fill the recency window", async () => {
    const result = await client.search({ query: MARKER, sources: ["files"] });
    expect(result.results.length).toBeGreaterThan(0);
  });
});
