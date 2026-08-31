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
 * The truncation-disclosure half of the files-source content-scan split (see
 * `search-files-content-truncation.test.ts` for the ordinary/uncapped case,
 * and why these two are separate files rather than two `describe` blocks —
 * `getDb()` is a per-process singleton, so only one PGLite lifecycle can live
 * in a given test file).
 *
 * A real workspace here: 1200+ asset usages, well past `MAX_ASSET_USAGE_SCAN_ROWS`
 * (1000). The content-scan phase legitimately cannot inspect every eligible
 * file's body — that's a real object-storage-read cost bound, not a bug. What
 * the response must not do is stay silent about it: an empty result here has
 * to say "I didn't look at everything" (`contentTruncated: true`), not read
 * as "this workspace has no such file" (spec D2b).
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const HASH = (byte: string) => `sha256:${byte.repeat(64)}`;
const FILLER_USAGES = 1200;

describe("search — files source content-scan truncation disclosure", () => {
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

  it("reports contentTruncated honestly when the content scan could not cover every eligible file", async () => {
    // A phrase that matches NEITHER identity NOR any body in this fixture.
    // With 1200+ eligible usages and a 1000-row content-scan cap, the search
    // cannot have inspected everything — the response must say so rather than
    // implying a clean, complete "no matches".
    const result = await client.search({ query: "nonexistent-phrase-xyz", sources: ["files"] });
    expect(result.results).toHaveLength(0);
    expect(result.contentTruncated).toBe(true);
  });

  it("does not claim truncation when identity alone already answered the query", async () => {
    // "Quarterly" is in the identity fields (node name), so phase 1 satisfies
    // this without ever needing the capped content scan — the SQL push-down
    // fix from `search-files-recency-window.test.ts` at work here too.
    const result = await client.search({ query: "Quarterly", sources: ["files"] });
    expect(result.results.length).toBeGreaterThan(0);
    expect(result.contentTruncated).toBe(false);
  });
});
