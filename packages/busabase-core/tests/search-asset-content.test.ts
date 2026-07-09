import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { storage } from "openlib/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * Asset-backed file search must still find matches by FILE CONTENT (which needs a
 * storage read) as well as by name/metadata. The scalability fix reordered the
 * loop so the file body is only fetched when the in-memory columns didn't already
 * match — these tests pin both paths so that optimisation can't drop content hits.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const CONTENT = "Quarterly numbers: the ZEBRAWIDGET line item grew 12% this period.";

describe("Asset-backed file search — content vs metadata", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-search-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-search-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const hash = `sha256:${"c".repeat(64)}`;
    const sizeBytes = Buffer.byteLength(CONTENT, "utf8");
    const req = await client.assets.createUploadUrl({
      fileName: "quarterly.txt",
      mimeType: "text/plain",
      sizeBytes,
      contentHash: hash,
    });
    // Put real bytes at the content-addressed key so the search's getObject reads them.
    await storage.uploadFileToKey(Buffer.from(CONTENT, "utf8"), req.storageKey, "text/plain");
    const confirmed = await client.assets.confirm({
      storageKey: req.storageKey,
      fileName: "quarterly.txt",
      mimeType: "text/plain",
      sizeBytes,
      contentHash: hash,
    });

    // A file node whose name/description/slug do NOT contain the content marker.
    const cr = await client.nodes.createChangeRequest({
      operations: [
        {
          kind: "create",
          nodeType: "file",
          slug: "quarterly",
          name: "Finance upload",
          description: "Board handout",
          metadata: { assetId: confirmed.assetId },
        },
      ],
    });
    await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
    await client.changeRequests.merge({ changeRequestId: cr.id });
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("finds a file by a marker that lives ONLY in its content (storage read path)", async () => {
    const search = await client.search({ query: "ZEBRAWIDGET", limit: 10 });
    expect(search.results.some((result) => result.href === "/file/quarterly")).toBe(true);
  });

  it("finds a file by its filename without depending on content", async () => {
    const search = await client.search({ query: "quarterly.txt", limit: 10 });
    expect(search.results.some((result) => result.href === "/file/quarterly")).toBe(true);
  });

  it("finds a file by its node name (metadata match)", async () => {
    const search = await client.search({ query: "Finance upload", limit: 10 });
    expect(search.results.some((result) => result.href === "/file/quarterly")).toBe(true);
  });

  it("does not match an unrelated query", async () => {
    const search = await client.search({ query: "NONEXISTENTTOKEN", limit: 10 });
    expect(search.results.some((result) => result.href === "/file/quarterly")).toBe(false);
  });
});
