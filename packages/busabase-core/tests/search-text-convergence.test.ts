import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { storage } from "openlib/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "../src/db";
import { busabaseAssetTexts } from "../src/domains/assets/schema/asset-texts";
import { busabaseRouter } from "../src/router";

/**
 * Search and grep share the same canonical busabase_asset_texts slot. Search
 * now reads a chunked database projection of that text, while grep continues
 * to stream the full object. These integration tests preserve deep matches,
 * legacy text-slot repair, stale-content exclusion and independence from the
 * former per-request object-storage scan budget.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

const expectDefined = <T>(value: T | undefined | null): T => {
  expect(value).toBeDefined();
  expect(value).not.toBeNull();
  if (value === undefined || value === null) throw new Error("Expected value to be defined");
  return value;
};

describe("Search / Drive Grep Retrieval convergence", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-search-conv-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-search-conv-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  /** Upload+confirm a text/plain asset (auto-registers a `present` text row pointing at its own bytes). */
  const uploadTextAsset = async (opts: { fileName: string; content: string; hashByte: string }) => {
    const contentHash = `sha256:${createHash("sha256").update(opts.content).digest("hex")}`;
    const sizeBytes = Buffer.byteLength(opts.content, "utf8");
    const req = await client.assets.createUploadUrl({
      fileName: opts.fileName,
      mimeType: "text/plain",
      sizeBytes,
      contentHash,
    });
    await storage.uploadFileToKey(Buffer.from(opts.content, "utf8"), req.storageKey, "text/plain");
    const confirmed = await client.assets.confirm({
      storageKey: req.storageKey,
      fileName: opts.fileName,
      mimeType: "text/plain",
      sizeBytes,
      contentHash,
    });
    return { assetId: expectDefined(confirmed.assetId) };
  };

  /** Upload+confirm a binary (application/pdf) asset — no auto text registration. */
  const uploadBinaryAsset = async (opts: { fileName: string; hashByte: string }) => {
    const bytes = Buffer.alloc(100, opts.hashByte);
    const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const req = await client.assets.createUploadUrl({
      fileName: opts.fileName,
      mimeType: "application/pdf",
      sizeBytes: 100,
      contentHash,
    });
    await storage.uploadFileToKey(bytes, req.storageKey, "application/pdf");
    const confirmed = await client.assets.confirm({
      storageKey: req.storageKey,
      fileName: opts.fileName,
      mimeType: "application/pdf",
      sizeBytes: 100,
      contentHash,
    });
    return { assetId: expectDefined(confirmed.assetId) };
  };

  /** Mount an asset as a `file` node via a normal ChangeRequest, so it's join-reachable by `search()`. */
  const mountAsFileNode = async (opts: { assetId: string; slug: string; name: string }) => {
    const cr = await client.nodes.createChangeRequest({
      operations: [
        {
          kind: "create",
          nodeType: "file",
          slug: opts.slug,
          name: opts.name,
          description: "",
          metadata: { assetId: opts.assetId },
        },
      ],
    });
    await client.changeRequests.review({ changeRequestIds: [cr.id], verdict: "approved" });
    await client.changeRequests.merge({ changeRequestIds: [cr.id] });
  };

  const getTextRow = async (assetId: string) => {
    const db = await getDb();
    const [row] = await db
      .select()
      .from(busabaseAssetTexts)
      .where(eq(busabaseAssetTexts.assetId, assetId))
      .limit(1);
    return row;
  };

  it("finds a match past the old 256KB cap — the cap is genuinely gone", async () => {
    const filler = "The quick brown fox jumps over the lazy dog. ";
    const bodyFiller = filler.repeat(Math.ceil((300 * 1024) / filler.length));
    const content = `${bodyFiller}\nHUGECONTENTNEEDLE appears only near the end of this file.\n`;
    expect(Buffer.byteLength(content, "utf8")).toBeGreaterThan(256 * 1024);

    const { assetId } = await uploadTextAsset({
      fileName: "huge-report.txt",
      content,
      hashByte: "1",
    });
    await mountAsFileNode({ assetId, slug: "huge-report", name: "Huge Report" });

    const search = await client.search({ query: "HUGECONTENTNEEDLE", limit: 10 });
    expect(search.results.some((result) => result.href === "/file/huge-report")).toBe(true);
  });

  it("self-heals a pre-existing (legacy) text-kind asset with no text row yet", async () => {
    const { assetId } = await uploadTextAsset({
      fileName: "legacy-notes.txt",
      content: "id,value\n1,SelfHealSearchMarkerXYZ\n",
      hashByte: "2",
    });
    await mountAsFileNode({ assetId, slug: "legacy-notes", name: "Legacy Notes" });

    // Sanity: normal upload-time auto-registration already made this present.
    expect(await getTextRow(assetId)).toBeDefined();

    // Simulate "asset from before this feature shipped": delete its
    // busabase_asset_texts row directly, leaving a text-kind asset with NO
    // row at all — the exact precondition grep's own self-heal exists for.
    const db = await getDb();
    await db.delete(busabaseAssetTexts).where(eq(busabaseAssetTexts.assetId, assetId));
    expect(await getTextRow(assetId)).toBeUndefined();

    const search = await client.search({ query: "SelfHealSearchMarkerXYZ", limit: 10 });
    expect(search.results.some((result) => result.href === "/file/legacy-notes")).toBe(true);

    // The self-heal is persisted — a row now exists again, registered fresh.
    const healed = expectDefined(await getTextRow(assetId));
    expect(healed.status).toBe("present");
    expect(healed.writtenBy).toBe("auto");
  });

  it("excludes stale text from content search, while metadata (node name) still matches", async () => {
    const { assetId: pdfAssetId } = await uploadBinaryAsset({
      fileName: "contract-v1.pdf",
      hashByte: "3",
    });
    await client.assets.putText({
      assetId: pdfAssetId,
      text: "ACME Corp STALEMARKERALPHA contract version one",
    });

    const drive = await client.fileTrees.create({
      type: "drive",
      autoMerge: true,
      slug: "stale-search-drive",
      name: "Stale Search Drive",
      files: [{ path: "contract.pdf", assetId: pdfAssetId }],
    });
    if (!("node" in drive)) throw new Error("expected an immediate node (autoMerge: true)");

    // Before repoint: content-only marker is findable.
    const before = await client.search({ query: "STALEMARKERALPHA", limit: 10 });
    expect(before.results.some((result) => result.id.startsWith(`${pdfAssetId}:`))).toBe(true);

    const { assetId: replacementAssetId } = await uploadBinaryAsset({
      fileName: "contract-v2.pdf",
      hashByte: "4",
    });

    const cr = await client.fileTrees.createChangeRequest({
      type: "drive",
      nodeId: drive.node.id,
      operations: [{ kind: "update", path: "contract.pdf", assetId: replacementAssetId }],
      message: "Replace contract with v2",
      submittedBy: "agent",
    });
    await client.changeRequests.review({ changeRequestIds: [cr.id], verdict: "approved" });
    await client.changeRequests.merge({ changeRequestIds: [cr.id] });

    const staleRow = expectDefined(await getTextRow(pdfAssetId));
    expect(staleRow.status).toBe("stale");

    // Now excluded from a content-only marker search.
    const after = await client.search({ query: "STALEMARKERALPHA", limit: 10 });
    expect(after.results.some((result) => result.id.startsWith(`${pdfAssetId}:`))).toBe(false);

    // Still findable by metadata (the drive/node name), unaffected by staleness.
    const byMetadata = await client.search({ query: "Stale Search Drive", limit: 10 });
    expect(byMetadata.results.some((result) => result.id.startsWith(`${pdfAssetId}:`))).toBe(true);
  });

  it("finds indexed body content even when the former storage-scan budget is zero", async () => {
    const { assetId } = await uploadTextAsset({
      fileName: "deadline-file.txt",
      content: "this file contains DEADLINEONLYMARKER somewhere in its body",
      hashByte: "5",
    });
    await mountAsFileNode({ assetId, slug: "deadline-file", name: "Deadline File" });

    const previous = process.env.BUSABASE_SEARCH_FILE_SCAN_TIMEOUT_MS;
    process.env.BUSABASE_SEARCH_FILE_SCAN_TIMEOUT_MS = "0";
    try {
      const search = await client.search({ query: "DEADLINEONLYMARKER", limit: 10 });
      // Indexed content requires no live scan, so the legacy scan deadline
      // cannot hide content which has already been made searchable.
      expect(search.results.some((result) => result.href === "/file/deadline-file")).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.BUSABASE_SEARCH_FILE_SCAN_TIMEOUT_MS;
      else process.env.BUSABASE_SEARCH_FILE_SCAN_TIMEOUT_MS = previous;
    }

    // Search behavior is identical without the legacy deadline override.
    const searchNormal = await client.search({ query: "DEADLINEONLYMARKER", limit: 10 });
    expect(searchNormal.results.some((result) => result.href === "/file/deadline-file")).toBe(true);
  });
});
