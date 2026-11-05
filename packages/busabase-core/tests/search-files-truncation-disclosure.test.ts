import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { storage } from "openlib/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "../src/db";
import { busabaseAssetTextSearch, busabaseAssetTexts } from "../src/db/schema";
import { busabaseAssetUsages } from "../src/domains/assets/schema/assets";
import { busabaseRouter } from "../src/router";

/**
 * A large but fully indexed workspace is complete regardless of recency.
 * Missing/unreadable projections must still report incomplete coverage;
 * replacing the live scan must never turn a partial index into a clean miss.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const HASH = (byte: string) => `sha256:${byte.repeat(64)}`;
const FILLER_USAGES = 1200;

describe("search — files source index coverage disclosure", () => {
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
    // Filtered by the asset THIS call just mounted — see the identical note
    // in the sibling test files' copy of this helper.
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
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-search-truncation-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-search-truncation-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const assetId = await uploadAsset("quarterly-notes.txt", "irrelevant body", "e");
    await mountAsFileNode(assetId, "content-match-2", "Quarterly notes");

    // Filler usages for an unrelated asset, newer than the target — pushes it
    // below the content-scan's recency window (MAX_ASSET_USAGE_SCAN_ROWS).
    const fillerAssetId = await uploadAsset("unrelated.txt", "unrelated body", "f");
    const fillerUsage = await mountAsFileNode(fillerAssetId, "filler-file-2", "Filler file 2");
    if (!fillerUsage) throw new Error("Expected a filler usage row to clone");

    const db = await getDb();
    const newer = new Date(Date.now() + 60_000);
    const rows = Array.from({ length: FILLER_USAGES }, (_, i) => ({
      ...fillerUsage,
      id: `usage_filler2_${i}`,
      assetId: fillerAssetId,
      path: `filler2/${i}.txt`,
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

  it("does not claim truncation when all 1200+ usages have indexed text", async () => {
    // No object-storage scan or latest-1000 window is necessary anymore.
    const result = await client.search({ query: "nonexistent-phrase-xyz", sources: ["files"] });
    expect(result.results).toHaveLength(0);
    expect(result.contentTruncated).toBe(false);
  });

  it("does not claim truncation when identity alone already answered the query", async () => {
    // Identity lookup remains complete as well as the body index.
    const result = await client.search({ query: "Quarterly", sources: ["files"] });
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.contentTruncated).toBe(false);
  });
  it("reports incomplete coverage when a legacy text object cannot be indexed", async () => {
    const db = await getDb();
    const [text] = await db.select().from(busabaseAssetTexts).limit(1);
    if (!text) throw new Error("Expected an indexed text fixture");
    await db
      .delete(busabaseAssetTextSearch)
      .where(eq(busabaseAssetTextSearch.assetId, text.assetId));
    await storage.deleteObject(text.textStorageKey);
    const result = await client.search({ query: "not-in-any-file", sources: ["files"] });
    expect(result.results).toHaveLength(0);
    expect(result.contentTruncated).toBe(true);
    // A failed indexing attempt must not create a false completed marker.
    const [projection] = await db
      .select()
      .from(busabaseAssetTextSearch)
      .where(eq(busabaseAssetTextSearch.assetId, text.assetId));
    expect(projection).toBeUndefined();
  });
});
