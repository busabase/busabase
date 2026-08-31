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
 * The other half of `search-files-recency-window.test.ts`.
 *
 * That file pins IDENTITY matching (filename/path/node name) surviving the
 * recency window — the deterministic false negative spec S2 calls "confidently
 * wrong", now fixed by pushing identity matching into SQL with no row cap.
 *
 * CONTENT matching (a phrase inside the file body, not its name) is a
 * different story: it stays behind `MAX_ASSET_USAGE_SCAN_ROWS`, because
 * scanning a file's body is a real object-storage read, not a free indexed
 * string comparison — a cost bound there is legitimate, not a bug. What *was*
 * missing is honesty about it: `contentTruncated` must tell the truth when the
 * cap genuinely left candidates unscanned, instead of the search staying
 * silent about it (spec D2b, the same principle `searchNodeContent` already
 * had for node bodies).
 *
 * This file proves the ordinary case: with nothing anywhere near the scan
 * cap, a content-only match (the phrase is only in the file body, never in
 * its name/path) is still found and the response does not falsely claim
 * truncation. `search-files-truncation-disclosure.test.ts` is the other half
 * — a workspace that genuinely exceeds the cap — kept in its own file because
 * `getDb()` is a per-process singleton (see `packages/busabase-core/src/db`):
 * two independent PGLite lifecycles cannot coexist inside one test file.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const HASH = (byte: string) => `sha256:${byte.repeat(64)}`;

describe("search — files source content matching, ordinary (uncapped) case", () => {
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
});
