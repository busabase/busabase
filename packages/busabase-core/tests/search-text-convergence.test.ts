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
 * Drive Grep Retrieval convergence — `search.ts`'s `searchAssetBackedFiles`
 * now reads through the same `busabase_asset_texts` + streaming-cache
 * infrastructure `grep` uses (`asset-grep-logic.ts`), instead of its own
 * separate `storage.getObject` + in-memory-buffer + 256KB-cap mechanism.
 * See apps/busabase/content/spec/drive-grep-retrieval.md.
 *
 * These tests pin the direct consequences of that convergence:
 *  1. the 256KB cap is genuinely gone (a large text file is now searchable)
 *  2. the self-heal path search inherited from grep actually runs
 *  3. a `stale` text row is excluded from content search (but not metadata)
 *  4. the new wall-clock body-scan budget fails safe (no hang/throw)
 *
 * `tests/search-asset-content.test.ts` remains the pinned regression test
 * for the common (small file, upload-time auto-registration) case and is
 * intentionally left unmodified.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const HASH = (byte: string) => `sha256:${byte.repeat(64)}`;

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
    const contentHash = HASH(opts.hashByte);
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
    const contentHash = HASH(opts.hashByte);
    const req = await client.assets.createUploadUrl({
      fileName: opts.fileName,
      mimeType: "application/pdf",
      sizeBytes: 100,
      contentHash,
    });
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
    await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
    await client.changeRequests.merge({ changeRequestId: cr.id });
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

    const drive = await client.drives.create({
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

    const cr = await client.drives.createChangeRequest({
      nodeId: drive.node.id,
      operations: [{ kind: "update", path: "contract.pdf", assetId: replacementAssetId }],
      message: "Replace contract with v2",
      submittedBy: "agent",
    });
    await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
    await client.changeRequests.merge({ changeRequestId: cr.id });

    const staleRow = expectDefined(await getTextRow(pdfAssetId));
    expect(staleRow.status).toBe("stale");

    // Now excluded from a content-only marker search.
    const after = await client.search({ query: "STALEMARKERALPHA", limit: 10 });
    expect(after.results.some((result) => result.id.startsWith(`${pdfAssetId}:`))).toBe(false);

    // Still findable by metadata (the drive/node name), unaffected by staleness.
    const byMetadata = await client.search({ query: "Stale Search Drive", limit: 10 });
    expect(byMetadata.results.some((result) => result.id.startsWith(`${pdfAssetId}:`))).toBe(true);
  });

  it("returns cleanly (no hang, no throw) with metadata-only results when the scan deadline is exhausted", async () => {
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
      // Body-only marker — with a zero-budget deadline, the body scan never
      // runs, so this must NOT be found (metadata-only fallthrough), and the
      // call must resolve cleanly rather than hang or throw.
      expect(search.results.some((result) => result.href === "/file/deadline-file")).toBe(false);
    } finally {
      if (previous === undefined) delete process.env.BUSABASE_SEARCH_FILE_SCAN_TIMEOUT_MS;
      else process.env.BUSABASE_SEARCH_FILE_SCAN_TIMEOUT_MS = previous;
    }

    // Sanity: without the deadline squeeze, the same marker IS findable —
    // proves the previous assertion was really about the deadline, not a
    // broken fixture.
    const searchNormal = await client.search({ query: "DEADLINEONLYMARKER", limit: 10 });
    expect(searchNormal.results.some((result) => result.href === "/file/deadline-file")).toBe(true);
  });
});
