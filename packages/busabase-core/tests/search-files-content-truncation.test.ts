import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { LocalStorage, storage } from "openlib/storage";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "../src/db";
import { busabaseAssetUsages } from "../src/domains/assets/schema/assets";
import { busabaseRouter } from "../src/router";

/** A complete indexed corpus must answer body searches without storage scans. */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("search — files source content matching, ordinary (uncapped) case", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  const uploadAsset = async (fileName: string, body: string, _hashByte: string) => {
    const sizeBytes = Buffer.byteLength(body, "utf8");
    const contentHash = `sha256:${createHash("sha256").update(body).digest("hex")}`;
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
    // Filtered by the asset THIS call just mounted — an unfiltered `LIMIT 1`
    // (no ORDER BY) returns whichever row the engine happens to scan first,
    // which by a second call in the same workspace can be an EARLIER call's
    // row, not this one.
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
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-search-content-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-search-content-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    // Name does NOT carry the phrase; only the body does — findable only by
    // the content-scan phase, never by the identity phase.
    const assetId = await uploadAsset(
      "quarterly-notes.txt",
      "unrelated header\nthe cash value formula is on page twelve\nunrelated footer",
      "c",
    );
    await mountAsFileNode(assetId, "content-match", "Quarterly notes");
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("finds a content-only match when nothing is anywhere near the scan cap", async () => {
    const result = await client.search({ query: "cash value formula", sources: ["files"] });
    // Title comes from the asset's own name (no displayName override in this
    // fixture) — the node name is what identity matching reads, not the title.
    expect(result.results.map((r) => r.title)).toContain("quarterly-notes.txt");
    expect(result.contentTruncated).toBe(false);
  });

  // Slow storage used to exhaust the request budget while looking for a word
  // that no file contained. Indexed corpus search should not touch storage.
  it("does not spend its request budget rereading indexed object storage", async () => {
    for (let index = 0; index < 6; index++) {
      const assetId = await uploadAsset(`slow-${index}.txt`, `body ${index}\n`, String(index + 2));
      await mountAsFileNode(assetId, `slow-${index}`, `Slow ${index}`);
    }
    const original = LocalStorage.prototype.objectExists;
    const spy = vi.spyOn(LocalStorage.prototype, "objectExists").mockImplementation(async function (
      this: LocalStorage,
      key: string,
    ) {
      await new Promise((resolve) => setTimeout(resolve, 400));
      return original.call(this, key);
    });
    process.env.BUSABASE_SEARCH_FULL_REQUEST_TIMEOUT_MS = "1500";
    try {
      const result = await client.search({ query: "in-no-file-at-all", sources: ["files"] });
      expect(result.results).toHaveLength(0);
      expect(result.contentTruncated).toBe(false);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      delete process.env.BUSABASE_SEARCH_FULL_REQUEST_TIMEOUT_MS;
      spy.mockRestore();
    }
  }, 60_000);
});
