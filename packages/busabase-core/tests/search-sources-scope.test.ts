import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { storage } from "openlib/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * `search`'s new `sources` scope parameter (`records`/`files`/`names`) —
 * before this, EVERY call ran the full pipeline (records ranking query +
 * file body scan + base/field-name matching) regardless of what the caller
 * actually cared about. See apps/busabase/content/spec/unified-grep.md's
 * "Search vs Grep" section for the measured cost of that (a "files" query
 * paying the full records-ranking cost when records coexist in the space).
 *
 * Seeds one marker per source so a query for any single marker only ever
 * matches its own source, then proves `sources` narrows results to exactly
 * the requested source(s) — and that omitting it preserves the pre-existing
 * "search everything" default.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const RECORD_MARKER = "RECORDMARKER7f1a";
const FILE_MARKER = "FILEMARKER9c3d";
const NAME_MARKER = "NAMEMARKER2e8b";

describe("search — sources scope", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-search-sources-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-search-sources-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    // Records source: a marker living only in a record's field value.
    const base = await client.bases.create({
      slug: "sources-test-base",
      name: "Sources Test Base",
      fields: [{ slug: "notes", name: "Notes", type: "longtext" }],
      autoMerge: true,
    });
    if (!("id" in base)) throw new Error("Expected a materialized BaseVO");
    const recordCr = await client.bases.createChangeRequest({
      baseId: base.id,
      fields: { notes: `Contains ${RECORD_MARKER} in a record field.` },
      submittedBy: "test",
    });
    await client.changeRequests.review({ changeRequestId: recordCr.id, verdict: "approved" });
    await client.changeRequests.merge({ changeRequestId: recordCr.id });

    // Files source: a marker living only in a mounted file's content.
    const hash = `sha256:${"d".repeat(64)}`;
    const content = `File body containing ${FILE_MARKER} in its text.`;
    const sizeBytes = Buffer.byteLength(content, "utf8");
    const uploadReq = await client.assets.createUploadUrl({
      fileName: "sources-test.txt",
      mimeType: "text/plain",
      sizeBytes,
      contentHash: hash,
    });
    await storage.uploadFileToKey(Buffer.from(content, "utf8"), uploadReq.storageKey, "text/plain");
    const confirmed = await client.assets.confirm({
      storageKey: uploadReq.storageKey,
      fileName: "sources-test.txt",
      mimeType: "text/plain",
      sizeBytes,
      contentHash: hash,
    });
    const fileCr = await client.nodes.createChangeRequest({
      operations: [
        {
          kind: "create",
          nodeType: "file",
          slug: "sources-test-file",
          name: "Sources Test File",
          metadata: { assetId: confirmed.assetId },
        },
      ],
    });
    await client.changeRequests.review({ changeRequestId: fileCr.id, verdict: "approved" });
    await client.changeRequests.merge({ changeRequestId: fileCr.id });

    // Names source: a marker living only in a Base's own name.
    const namedBase = await client.bases.create({
      slug: "names-test-base",
      name: `Base named ${NAME_MARKER}`,
      fields: [],
      autoMerge: true,
    });
    if (!("id" in namedBase)) throw new Error("Expected a materialized BaseVO");
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("default (no sources) finds all three markers — unchanged pre-existing behavior", async () => {
    const record = await client.search({ query: RECORD_MARKER });
    const file = await client.search({ query: FILE_MARKER });
    const name = await client.search({ query: NAME_MARKER });
    expect(record.results.length).toBeGreaterThan(0);
    expect(file.results.length).toBeGreaterThan(0);
    expect(name.results.length).toBeGreaterThan(0);
  });

  it("sources: ['records'] finds the record marker but NOT the file or name markers", async () => {
    const record = await client.search({ query: RECORD_MARKER, sources: ["records"] });
    const file = await client.search({ query: FILE_MARKER, sources: ["records"] });
    const name = await client.search({ query: NAME_MARKER, sources: ["records"] });
    expect(record.results.some((r) => r.kind === "record")).toBe(true);
    expect(file.results.length).toBe(0);
    expect(name.results.length).toBe(0);
  });

  it("sources: ['files'] finds the file marker but NOT the record or name markers", async () => {
    const record = await client.search({ query: RECORD_MARKER, sources: ["files"] });
    const file = await client.search({ query: FILE_MARKER, sources: ["files"] });
    const name = await client.search({ query: NAME_MARKER, sources: ["files"] });
    expect(file.results.some((r) => r.href === "/file/sources-test-file")).toBe(true);
    expect(record.results.length).toBe(0);
    expect(name.results.length).toBe(0);
  });

  it("sources: ['names'] finds the base-name marker but NOT the record or file markers", async () => {
    const record = await client.search({ query: RECORD_MARKER, sources: ["names"] });
    const file = await client.search({ query: FILE_MARKER, sources: ["names"] });
    const name = await client.search({ query: NAME_MARKER, sources: ["names"] });
    expect(name.results.some((r) => r.kind === "base")).toBe(true);
    expect(record.results.length).toBe(0);
    expect(file.results.length).toBe(0);
  });

  it("sources: ['files', 'records'] finds both, still excludes names", async () => {
    const result = await client.search({
      query: RECORD_MARKER,
      sources: ["files", "records"],
    });
    expect(result.results.some((r) => r.kind === "record")).toBe(true);
    const nameResult = await client.search({ query: NAME_MARKER, sources: ["files", "records"] });
    expect(nameResult.results.length).toBe(0);
  });
});
