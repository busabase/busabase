/**
 * The public file-search path must use the indexed text slot, including
 * externally extracted binary content. Fixtures go through upload, mount,
 * putText and search against real PGLite and local object storage.
 */
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient, ORPCError } from "@orpc/server";
import { eq, inArray } from "drizzle-orm";
import { LocalStorage, storage } from "openlib/storage";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { getDb } from "../src/db";
import {
  busabaseAssetTextSearch,
  busabaseAssetTextSearchChunks,
  busabaseAssetTexts,
  busabaseAssetUsages,
  busabaseNodes,
} from "../src/db/schema";
import * as assetTextSearchLogic from "../src/domains/assets/logic/asset-text-search-logic";
import {
  ASSET_SEARCH_MAX_CHARS,
  auditAssetTextSearch,
  backfillAssetTextSearch,
  healAssetTextProjections,
} from "../src/domains/assets/logic/asset-text-search-logic";
import * as assetTextsLogic from "../src/domains/assets/logic/asset-texts-logic";
import { literalSearchPattern } from "../src/logic/search-record-query";
import { busabaseRouter } from "../src/router";

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

const requireValue = <T>(value: T | null | undefined): T => {
  if (value === null || value === undefined) throw new Error("Expected fixture value");
  return value;
};

describe("asset text search index", () => {
  let originalCwd = "";
  let dataDir = "";
  let storageDir = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "asset-search-index-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "asset-search-index-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  const upload = async (fileName: string, content: string, mimeType = "application/pdf") => {
    const bytes = Buffer.from(content, "utf8");
    const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const pending = await client.assets.createUploadUrl({
      fileName,
      mimeType,
      sizeBytes: bytes.length,
      contentHash,
    });
    await storage.uploadFileToKey(bytes, pending.storageKey, mimeType);
    const confirmed = await client.assets.confirm({
      storageKey: pending.storageKey,
      fileName,
      mimeType,
      sizeBytes: bytes.length,
      contentHash,
    });
    return requireValue(confirmed.assetId);
  };

  const mount = async (assetId: string, slug: string) => {
    await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [
        {
          kind: "create",
          nodeType: "file",
          name: "Uploaded document",
          slug,
          metadata: { assetId },
        },
      ],
    });
    const [usage] = await (await getDb())
      .select()
      .from(busabaseAssetUsages)
      .where(eq(busabaseAssetUsages.assetId, assetId))
      .limit(1);
    return requireValue(usage);
  };

  const search = (query: string, options: Partial<Parameters<Client["search"]>[0]> = {}) =>
    client.search({ query, sources: ["files"], limit: 100, ...options });

  const hits = async (query: string, assetId: string) =>
    (await search(query)).results.filter((row) => row.id.startsWith(`${assetId}:`));

  it("publishes externally extracted text at putText completion and updates it without old hits", async () => {
    const assetId = await upload("report.pdf", "%PDF inline fixture");
    await mount(assetId, "indexed-inline");
    await client.assets.putText({ assetId, text: "The EXTERNALBODYALPHA clause starts here." });
    expect(await hits("EXTERNALBODYALPHA", assetId)).toHaveLength(1);
    expect((await hits("EXTERNALBODYALPHA", assetId))[0]?.body).toContain("EXTERNALBODYALPHA");
    // Typeahead retains its existing file-identity-only contract.
    expect((await search("EXTERNALBODYALPHA", { mode: "quick" })).results).toHaveLength(0);

    await client.assets.putText({ assetId, text: "The REPLACEMENTBODYBETA clause is current." });
    expect(await hits("EXTERNALBODYALPHA", assetId)).toHaveLength(0);
    expect(await hits("REPLACEMENTBODYBETA", assetId)).toHaveLength(1);
    await client.assets.putText({ assetId, none: true });
    expect(await hits("REPLACEMENTBODYBETA", assetId)).toHaveLength(0);
  });

  it("does not show withdrawn text in identity-match snippets", async () => {
    const assetId = await upload("QueryName.pdf", "%PDF snippet privacy fixture");
    await mount(assetId, "indexed-withdrawn-snippet");
    await client.assets.putText({
      assetId,
      text: "QueryName contains SECRETWITHDRAWNTEXT in its body.",
    });
    const before = await hits("QueryName", assetId);
    expect(before[0]?.body).toContain("SECRETWITHDRAWNTEXT");
    await client.assets.putText({ assetId, none: true });
    const after = await hits("QueryName", assetId);
    expect(after).toHaveLength(1);
    expect(after[0]?.body).not.toContain("SECRETWITHDRAWNTEXT");
  });

  it("finds native text beyond 256KB and includes the actual match in the snippet", async () => {
    const body = `${"routine ordinary filler ".repeat(16_000)}\n尾页存有中文检索目标，DEEPBODYGAMMA is here.\n`;
    expect(Buffer.byteLength(body)).toBeGreaterThan(256 * 1024);
    const assetId = await upload("large-notes.txt", body, "text/plain");
    await mount(assetId, "indexed-deep");
    const found = await hits("DEEPBODYGAMMA", assetId);
    expect(found).toHaveLength(1);
    expect(found[0]?.body).toContain("DEEPBODYGAMMA");
    expect(await hits("中文检索目标", assetId)).toHaveLength(1);
  });

  it("indexes presigned putText and matches a phrase spanning a chunk boundary", async () => {
    const assetId = await upload("long-form.pdf", "%PDF presigned fixture");
    await mount(assetId, "indexed-presigned");
    // A phrase deliberately crossing 16,384 UTF-16 code units; overlap must
    // preserve it and matching many chunks must still produce one file hit.
    const text = `${"x".repeat(16_380)}BOUNDARYDELTA${"y".repeat(300_000)}\nPRESIGNEDTAILOMEGA\n`;
    const bytes = Buffer.from(text, "utf8");
    const pending = await client.assets.createTextUploadUrl({ assetId, sizeBytes: bytes.length });
    await storage.uploadFileToKey(bytes, pending.storageKey, "text/plain");
    await client.assets.putText({ assetId, storageKey: pending.storageKey });
    for (const query of ["BOUNDARYDELTA", "PRESIGNEDTAILOMEGA"]) {
      const found = await hits(query, assetId);
      expect(found).toHaveLength(1);
      expect(found[0]?.body).toContain(query);
    }
  });

  it("keeps percent, underscore and backslash literal while accepting short Chinese terms", async () => {
    const fixture = [
      ["literal-percent", "The vendor discount is 50%."],
      ["literal-underscore", "The snake_case value is required."],
      ["literal-backslash", "Windows path C:\\work\\notes"],
      ["literal-chinese", "人工智能支持检索"],
      ["literal-ordinary", "Nothing special in this unrelated document."],
    ];
    const ids = [];
    for (const [slug, text] of fixture) {
      const assetId = await upload(`${slug}.pdf`, `%PDF ${slug}`);
      await mount(assetId, slug);
      await client.assets.putText({ assetId, text: requireValue(text) });
      ids.push(assetId);
    }
    for (const [query, expectedIndex] of [
      ["%", 0],
      ["_", 1],
      ["\\", 2],
      ["人工", 3],
      ["智", 3],
    ] as const) {
      const found = await search(query);
      const fixtureHits = found.results.filter((row) =>
        ids.some((id) => row.id.startsWith(`${id}:`)),
      );
      expect(fixtureHits.map((row) => row.id.split(":")[0])).toEqual([ids[expectedIndex]]);
    }
  });

  it("searches indexed content when object storage becomes unavailable", async () => {
    const assetId = await upload("offline-readable.pdf", "%PDF storage outage fixture");
    await mount(assetId, "indexed-offline");
    await client.assets.putText({ assetId, text: "OFFLINEBODYEPSILON remains searchable." });
    const rangeSpy = vi
      .spyOn(LocalStorage.prototype, "getObjectRange")
      .mockRejectedValue(new Error("storage unavailable"));
    const readSpy = vi
      .spyOn(LocalStorage.prototype, "getObject")
      .mockRejectedValue(new Error("storage unavailable"));
    try {
      expect(await hits("OFFLINEBODYEPSILON", assetId)).toHaveLength(1);
      expect(rangeSpy).not.toHaveBeenCalled();
      expect(readSpy).not.toHaveBeenCalled();
    } finally {
      rangeSpy.mockRestore();
      readSpy.mockRestore();
    }
  });

  it("applies live ACL revocation, date and subtree narrowing to body hits", async () => {
    const assetId = await upload("restricted.pdf", "%PDF acl fixture");
    const usage = await mount(assetId, "indexed-private");
    await client.assets.putText({ assetId, text: "ACLONLYBODYZETA lives in a private file." });
    const asReader = <T>(run: () => Promise<T>) =>
      runWithBusabaseContext(
        { spaceId: LOCAL_SPACE_ID, actorId: "search-reader", isSpaceManager: false },
        run,
      );
    expect((await asReader(() => search("ACLONLYBODYZETA"))).results).toHaveLength(1);
    expect((await search("ACLONLYBODYZETA", { inNodeId: usage.nodeId })).results).toHaveLength(1);
    const sibling = await client.docs.create({
      autoMerge: true,
      slug: "index-sibling",
      name: "Other folder",
      body: "unrelated",
    });
    if (!("node" in sibling)) throw new Error("Expected a materialized sibling document");
    expect((await search("ACLONLYBODYZETA", { inNodeId: sibling.node.id })).results).toHaveLength(
      0,
    );
    expect((await search("ACLONLYBODYZETA", { createdBy: "other-uploader" })).results).toHaveLength(
      0,
    );
    expect(
      (await search("ACLONLYBODYZETA", { updatedBefore: "2000-01-01T00:00:00.000Z" })).results,
    ).toHaveLength(0);
    await client.nodes.updateVisibility({ nodeId: usage.nodeId, visibility: "private" });
    expect((await asReader(() => search("ACLONLYBODYZETA"))).results).toHaveLength(0);
    expect(await hits("ACLONLYBODYZETA", assetId)).toHaveLength(1);
    await client.nodes.principals.add({
      nodeId: usage.nodeId,
      principalType: "user",
      principalId: "search-reader",
      role: "read",
    });
    expect((await asReader(() => search("ACLONLYBODYZETA"))).results).toHaveLength(1);
    await client.nodes.principals.remove({
      nodeId: usage.nodeId,
      principalType: "user",
      principalId: "search-reader",
    });
    expect((await asReader(() => search("ACLONLYBODYZETA"))).results).toHaveLength(0);
  });

  it("hides archived files and cannot return another space's content", async () => {
    const assetId = await upload("archived.pdf", "%PDF archival fixture");
    const usage = await mount(assetId, "indexed-archived");
    await client.assets.putText({ assetId, text: "ARCHIVEONLYBODYETA used to be visible." });
    expect(await hits("ARCHIVEONLYBODYETA", assetId)).toHaveLength(1);
    const elsewhere = await runWithBusabaseContext(
      { spaceId: "other-space-search-index", actorId: "manager", isSpaceManager: true },
      () => search("ARCHIVEONLYBODYETA"),
    );
    expect(elsewhere.results).toHaveLength(0);
    await (await getDb())
      .update(busabaseNodes)
      .set({ archivedAt: new Date() })
      .where(eq(busabaseNodes.id, usage.nodeId));
    expect(await hits("ARCHIVEONLYBODYETA", assetId)).toHaveLength(0);
  });
  it("rolls back a text replacement when publishing its search projection fails", async () => {
    const assetId = await upload("atomic-write.pdf", "%PDF atomic rollback fixture");
    await mount(assetId, "indexed-atomic-write");
    await client.assets.putText({ assetId, text: "ATOMICPREVIOUSKAPPA is the committed text." });
    const db = await getDb();
    const [before] = await db
      .select()
      .from(busabaseAssetTexts)
      .where(eq(busabaseAssetTexts.assetId, assetId));
    const originalPublish = assetTextSearchLogic.publishAssetTextProjection;
    const publish = vi
      .spyOn(assetTextSearchLogic, "publishAssetTextProjection")
      .mockImplementationOnce(async (transaction, input) => {
        // Execute the real header/chunk writes, then fail while still inside
        // putText's transaction. This detects a non-atomic success path, not
        // just an early validation failure before the database was modified.
        await originalPublish(transaction, input);
        throw new Error("index publication unavailable");
      });
    try {
      await expect(
        client.assets.putText({
          assetId,
          text: "ATOMICREPLACEMENTLAMBDA must not become current.",
        }),
      ).rejects.toThrow("index publication unavailable");
      expect(publish).toHaveBeenCalledOnce();
    } finally {
      publish.mockRestore();
    }
    const [after] = await db
      .select()
      .from(busabaseAssetTexts)
      .where(eq(busabaseAssetTexts.assetId, assetId));
    expect(after).toMatchObject({
      status: "present",
      textStorageKey: requireValue(before).textStorageKey,
      textContentHash: requireValue(before).textContentHash,
    });
    const [projection] = await db
      .select()
      .from(busabaseAssetTextSearch)
      .where(eq(busabaseAssetTextSearch.assetId, assetId));
    expect(projection?.textStorageKey).toBe(requireValue(before).textStorageKey);
    expect(await hits("ATOMICPREVIOUSKAPPA", assetId)).toHaveLength(1);
    expect(await hits("ATOMICREPLACEMENTLAMBDA", assetId)).toHaveLength(0);
  });

  it("replaces native text at a stable file path without returning the old projection", async () => {
    const drive = await client.fileTrees.create({
      type: "drive",
      autoMerge: true,
      slug: "index-native-repoint",
      name: "Native text revisions",
      files: [{ path: "notes.md", content: "NATIVEREVISIONONE is the original body." }],
    });
    if (!("node" in drive)) throw new Error("Expected a materialized Drive");
    const assetId = requireValue(drive.files.find((file) => file.path === "notes.md")).assetId;
    expect(await hits("NATIVEREVISIONONE", assetId)).toHaveLength(1);
    const replacement = await client.fileTrees.createChangeRequest({
      type: "drive",
      nodeId: drive.node.id,
      operations: [
        { kind: "update", path: "notes.md", content: "NATIVEREVISIONTWO is the replacement body." },
      ],
      submittedBy: "agent",
    });
    await client.changeRequests.review({ changeRequestIds: [replacement.id], verdict: "approved" });
    await client.changeRequests.merge({ changeRequestIds: [replacement.id] });
    await healAssetTextProjections(await getDb(), LOCAL_SPACE_ID, { waitMs: 60_000 });
    expect(await hits("NATIVEREVISIONONE", assetId)).toHaveLength(0);
    expect(await hits("NATIVEREVISIONTWO", assetId)).toHaveLength(1);
    const [currentText] = await (await getDb())
      .select()
      .from(busabaseAssetTexts)
      .where(eq(busabaseAssetTexts.assetId, assetId));
    expect(currentText).toMatchObject({ status: "present", writtenBy: "auto" });
  });

  it("invalidates extracted text and snippets when the original binary is replaced, then accepts new text", async () => {
    const assetId = await upload("QueryStale.pdf", "%PDF derived revision one");
    await client.assets.putText({
      assetId,
      text: "QueryStale has DERIVEDREVISIONONE and WITHDRAWNSTALENOTES.",
    });
    const drive = await client.fileTrees.create({
      type: "drive",
      autoMerge: true,
      slug: "index-derived-repoint",
      name: "Binary revisions",
      files: [{ path: "QueryStale.pdf", assetId }],
    });
    if (!("node" in drive)) throw new Error("Expected a materialized Drive");
    expect(await hits("DERIVEDREVISIONONE", assetId)).toHaveLength(1);
    const nextAssetId = await upload("revision-two.pdf", "%PDF derived revision two");
    const replacement = await client.fileTrees.createChangeRequest({
      type: "drive",
      nodeId: drive.node.id,
      operations: [{ kind: "update", path: "QueryStale.pdf", assetId: nextAssetId }],
      submittedBy: "agent",
    });
    await client.changeRequests.review({ changeRequestIds: [replacement.id], verdict: "approved" });
    await client.changeRequests.merge({ changeRequestIds: [replacement.id] });
    const [stale] = await (await getDb())
      .select()
      .from(busabaseAssetTexts)
      .where(eq(busabaseAssetTexts.assetId, assetId));
    expect(stale?.status).toBe("stale");
    expect(await hits("DERIVEDREVISIONONE", assetId)).toHaveLength(0);
    const identity = await hits("QueryStale", assetId);
    expect(identity).toHaveLength(1);
    expect(identity[0]?.body).not.toContain("WITHDRAWNSTALENOTES");
    await client.assets.putText({ assetId, text: "QueryStale now has DERIVEDREVISIONTWO." });
    expect(await hits("DERIVEDREVISIONONE", assetId)).toHaveLength(0);
    expect(await hits("DERIVEDREVISIONTWO", assetId)).toHaveLength(1);
  });

  it("reports incomplete coverage for a long phrase crossing the chunk overlap", async () => {
    const assetId = await upload("long-query.pdf", "%PDF long-query fixture");
    await mount(assetId, "indexed-long-query");
    const query = `LONGQUERYSTART${"q".repeat(880)}LONGQUERYEND`;
    expect(query.length).toBeGreaterThan(512);
    await client.assets.putText({
      assetId,
      text: `${"f".repeat(15_700)}${query}${"g".repeat(20_000)}`,
    });
    const found = await search(query);
    // The phrase straddles both copies of a chunk boundary. A bounded index
    // cannot prove absence here, so it must say its result is incomplete.
    expect(found.results).toHaveLength(0);
    expect(found.contentTruncated).toBe(true);
  });

  it("resumes bounded legacy backfill past an unreadable object and keeps successful work", async () => {
    const assetIds = [];
    for (let index = 0; index < 3; index++) {
      const assetId = await upload(`legacy-${index}.pdf`, `%PDF legacy page ${index}`);
      await mount(assetId, `indexed-legacy-${index}`);
      await client.assets.putText({
        assetId,
        text: `BACKFILLBODYIOTA${index} is only in extracted text.`,
      });
      assetIds.push(assetId);
    }
    const db = await getDb();
    await db
      .delete(busabaseAssetTextSearch)
      .where(inArray(busabaseAssetTextSearch.assetId, assetIds));
    const ordered = [...assetIds].sort();
    const brokenId = requireValue(ordered[0]);
    const [broken] = await db
      .select()
      .from(busabaseAssetTexts)
      .where(eq(busabaseAssetTexts.assetId, brokenId));
    await storage.deleteObject(requireValue(broken).textStorageKey);

    let afterAssetId: string | undefined;
    let indexed = 0;
    let failed = 0;
    const cursors: string[] = [];
    const failureReasons: Record<string, number> = {};
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    for (let pageCount = 0; pageCount < 5; pageCount++) {
      const page = await backfillAssetTextSearch(db, {
        spaceId: LOCAL_SPACE_ID,
        afterAssetId,
        limit: 1,
      });
      expect(page.indexed + page.failed).toBeLessThanOrEqual(1);
      for (const [reason, count] of Object.entries(page.failureReasons)) {
        failureReasons[reason] = (failureReasons[reason] ?? 0) + count;
      }
      indexed += page.indexed;
      failed += page.failed;
      afterAssetId = page.nextCursor;
      if (!afterAssetId) break;
      cursors.push(afterAssetId);
    }
    expect(indexed).toBe(2);
    expect(failed).toBe(1);
    // Why it failed is reported, and logged with the asset id but never the text.
    expect(failureReasons).toEqual({ error: 1 });
    const logged = warnings.mock.calls.map((call) => String(call[0]));
    warnings.mockRestore();
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain(`asset=${brokenId}`);
    expect(logged[0]).toContain("reason=error");
    // The storage error itself is in the line, so an operator can tell a missing
    // object from a timeout.
    expect(logged[0]).toMatch(/error=\w*Error[^\n]*\S/);
    expect(logged.join("\n")).not.toContain("BACKFILLBODYIOTA");
    expect(cursors).toEqual(ordered);
    const projections = await db
      .select()
      .from(busabaseAssetTextSearch)
      .where(inArray(busabaseAssetTextSearch.assetId, assetIds));
    expect(projections.map((row) => row.assetId).sort()).toEqual(ordered.slice(1));
    // Starting again does not rebuild successful pages or erase their text.
    const restarted = await backfillAssetTextSearch(db, { spaceId: LOCAL_SPACE_ID, limit: 100 });
    expect(restarted.indexed).toBe(0);
    expect(restarted.failed).toBe(1);
    const result = await search("BACKFILLBODYIOTA");
    expect(
      result.results.filter((row) => assetIds.some((id) => row.id.startsWith(`${id}:`))),
    ).toHaveLength(2);
    expect(result.contentTruncated).toBe(true);
  });
  it("reconciles existing partial projections skipped by an idempotent backfill", async () => {
    const db = await getDb();
    const partialAssetId = await upload("audit-partial.pdf", "%PDF partial audit fixture");
    await mount(partialAssetId, "indexed-audit-partial");
    await client.assets.putText({
      assetId: partialAssetId,
      text: "AUDITPARTIALOMEGA is only a projected prefix.",
    });
    await db
      .update(busabaseAssetTextSearch)
      .set({ complete: false })
      .where(eq(busabaseAssetTextSearch.assetId, partialAssetId));
    const [before] = await db
      .select()
      .from(busabaseAssetTextSearch)
      .where(eq(busabaseAssetTextSearch.assetId, partialAssetId));
    await backfillAssetTextSearch(db, { spaceId: LOCAL_SPACE_ID, limit: 100 });
    const [after] = await db
      .select()
      .from(busabaseAssetTextSearch)
      .where(eq(busabaseAssetTextSearch.assetId, partialAssetId));
    expect(after?.complete).toBe(false);
    expect(after?.indexedAt).toEqual(before?.indexedAt);

    const missingAssetId = await upload("audit-missing.pdf", "%PDF missing audit fixture");
    await mount(missingAssetId, "indexed-audit-missing");
    await client.assets.putText({
      assetId: missingAssetId,
      text: "AUDITMISSINGOMEGA has not been projected.",
    });
    await db
      .delete(busabaseAssetTextSearch)
      .where(eq(busabaseAssetTextSearch.assetId, missingAssetId));
    const audit = await auditAssetTextSearch(db, { spaceId: LOCAL_SPACE_ID, sampleLimit: 100 });
    expect(audit.complete).toBe(false);
    expect(audit.partial).toBeGreaterThanOrEqual(1);
    expect(audit.missing).toBeGreaterThanOrEqual(1);
    expect(audit.partialAssetIds).toContain(partialAssetId);
    expect(audit.missingAssetIds).toContain(missingAssetId);
    expect(await auditAssetTextSearch(db, { spaceId: "different-audit-space" })).toMatchObject({
      complete: true,
      eligible: 0,
      missing: 0,
      partial: 0,
    });
  });

  it("indexes the head of a source over the cap and discloses, without failing, its unindexed tail", async () => {
    // Its own space: the other tests deliberately leave a missing projection
    // behind, and this one must prove a capped file alone is not a failure.
    const spaceId = "huge-source-search-index";
    await runWithBusabaseContext(
      { spaceId, actorId: "manager", isSpaceManager: true },
      async () => {
        const body = `HUGEHEADMARKER opens the export.\n${"a".repeat(ASSET_SEARCH_MAX_CHARS)}\nHUGETAILMARKER is past the cap.\n`;
        const assetId = await upload("huge-export.txt", body, "text/plain");
        await mount(assetId, "indexed-huge-source");
        const db = await getDb();
        expect(await healAssetTextProjections(db, spaceId, { waitMs: 60_000 })).toBe(true);
        const [projection] = await db
          .select()
          .from(busabaseAssetTextSearch)
          .where(eq(busabaseAssetTextSearch.assetId, assetId));
        expect(projection?.complete).toBe(false);

        const head = await search("HUGEHEADMARKER");
        expect(head.results.filter((row) => row.id.startsWith(`${assetId}:`))).toHaveLength(1);
        const tail = await search("HUGETAILMARKER");
        // Grep still has the whole file; search must say it did not look there.
        expect(tail.results).toHaveLength(0);
        expect(tail.contentTruncated).toBe(true);

        const audit = await auditAssetTextSearch(db, { spaceId });
        expect(audit).toMatchObject({ complete: true, eligible: 1, missing: 0, partial: 1 });
        expect(audit.partialAssetIds).toEqual([assetId]);
      },
    );
  });

  it("answers with file-name matches and discloses the gap when the text match runs out of time", async () => {
    const bodyOnly = await upload("plain-contract.pdf", "%PDF degrade body fixture");
    await mount(bodyOnly, "degrade-body-only");
    await client.assets.putText({
      assetId: bodyOnly,
      text: "DEGRADEMARKER lives only in this body.",
    });
    const named = await upload("DEGRADEMARKER-notes.pdf", "%PDF degrade name fixture");
    await mount(named, "degrade-named");
    const ids = async (query: string) => {
      const found = await search(query);
      return {
        found,
        has: (assetId: string) => found.results.some((r) => r.id.startsWith(`${assetId}:`)),
      };
    };
    const whole = await ids("DEGRADEMARKER");
    expect(whole.has(bodyOnly) && whole.has(named)).toBe(true);
    // Typeahead reads no text, so even a query longer than the chunk overlap
    // has nothing to disclose.
    const longQuery = `DEGRADEMARKER${"x".repeat(600)}`;
    expect((await search(longQuery, { mode: "quick" })).contentTruncated).toBe(false);
    expect((await search(longQuery)).contentTruncated).toBe(true);

    // A phrase the index cannot serve costs as much as the space has text. When
    // that statement runs out of time, the walk through the page's own files
    // answers instead: the same answer, disclosing no more than it would have.
    // (This space holds other tests' partly indexed files, so `whole` may
    // disclose a gap of its own.)
    const timeout = vi
      .spyOn(assetTextSearchLogic, "matchAssetTextAssetIds")
      .mockRejectedValueOnce(new ORPCError("TIMEOUT", { message: "statement timeout" }));
    try {
      const recovered = await ids("DEGRADEMARKER");
      expect(timeout).toHaveBeenCalledOnce();
      expect(recovered.has(named) && recovered.has(bodyOnly)).toBe(true);
      expect(recovered.found.contentTruncated).toBe(whole.found.contentTruncated);
    } finally {
      timeout.mockRestore();
    }

    // When the walk runs out of time too, the search must still answer.
    const firstTimeout = vi
      .spyOn(assetTextSearchLogic, "matchAssetTextAssetIds")
      .mockRejectedValueOnce(new ORPCError("TIMEOUT", { message: "statement timeout" }));
    const walkTimeout = vi
      .spyOn(assetTextSearchLogic, "matchAssetTextAssetIdsInOrderPage")
      .mockRejectedValueOnce(new ORPCError("TIMEOUT", { message: "statement timeout" }));
    try {
      const degraded = await ids("DEGRADEMARKER");
      expect(firstTimeout).toHaveBeenCalledOnce();
      expect(walkTimeout).toHaveBeenCalledOnce();
      expect(degraded.has(named)).toBe(true);
      expect(degraded.has(bodyOnly)).toBe(false);
      expect(degraded.found.contentTruncated).toBe(true);
    } finally {
      firstTimeout.mockRestore();
      walkTimeout.mockRestore();
    }

    // A completed page is usable even if the next page's SQL times out.
    const globalTimeout = vi
      .spyOn(assetTextSearchLogic, "matchAssetTextAssetIds")
      .mockRejectedValueOnce(new ORPCError("TIMEOUT", { message: "statement timeout" }));
    const laterTimeout = vi
      .spyOn(assetTextSearchLogic, "matchAssetTextAssetIdsInOrderPage")
      .mockResolvedValueOnce({
        assetIds: [bodyOnly],
        checkedAssets: 32,
        complete: false,
        stopped: false,
      })
      .mockRejectedValueOnce(new ORPCError("TIMEOUT", { message: "statement timeout" }));
    try {
      const retained = await ids("DEGRADEMARKER");
      expect(laterTimeout).toHaveBeenCalledTimes(2);
      expect(laterTimeout.mock.calls[1]?.[3].offset).toBe(32);
      expect(retained.has(bodyOnly) && retained.has(named)).toBe(true);
      expect(retained.found.contentTruncated).toBe(true);
    } finally {
      globalTimeout.mockRestore();
      laterTimeout.mockRestore();
    }

    // A timeout with no completed matches must not look like a genuine miss.
    // This term has no filename or other-source match to answer with.
    const noAnswerGlobal = vi
      .spyOn(assetTextSearchLogic, "matchAssetTextAssetIds")
      .mockRejectedValueOnce(new ORPCError("TIMEOUT", { message: "statement timeout" }));
    const noAnswerWalk = vi
      .spyOn(assetTextSearchLogic, "matchAssetTextAssetIdsInOrderPage")
      .mockRejectedValueOnce(new ORPCError("TIMEOUT", { message: "statement timeout" }));
    try {
      await expect(search("TRULYMISSINGTERM")).rejects.toMatchObject({ code: "TIMEOUT" });
    } finally {
      noAnswerGlobal.mockRestore();
      noAnswerWalk.mockRestore();
    }
    // A completed search with no match is still an ordinary empty answer.
    expect((await search("TRULYMISSINGTERM")).results).toHaveLength(0);

    // A walk that stopped at its budget found nothing above where it stopped,
    // so the first match's files still answer, and the gap is disclosed.
    const cappedFirst = vi
      .spyOn(assetTextSearchLogic, "matchAssetTextAssetIds")
      .mockResolvedValueOnce({ assetIds: [bodyOnly], capped: true });
    const stoppedWalk = vi
      .spyOn(assetTextSearchLogic, "matchAssetTextAssetIdsInOrderPage")
      .mockResolvedValueOnce({ assetIds: [], checkedAssets: 1, complete: false, stopped: true });
    try {
      const stopped = await ids("DEGRADEMARKER");
      expect(stoppedWalk).toHaveBeenCalledOnce();
      expect(stopped.has(bodyOnly) && stopped.has(named)).toBe(true);
      expect(stopped.found.contentTruncated).toBe(true);
    } finally {
      cappedFirst.mockRestore();
      stoppedWalk.mockRestore();
    }

    // Only a timeout degrades. A real fault must not be reported as "no text matches".
    const fault = vi
      .spyOn(assetTextSearchLogic, "matchAssetTextAssetIds")
      .mockRejectedValueOnce(new Error("connection lost"));
    try {
      await expect(search("DEGRADEMARKER")).rejects.toBeTruthy();
    } finally {
      fault.mockRestore();
    }
    const walkFault = vi
      .spyOn(assetTextSearchLogic, "matchAssetTextAssetIdsInOrderPage")
      .mockRejectedValueOnce(new Error("connection lost"));
    const capped = vi
      .spyOn(assetTextSearchLogic, "matchAssetTextAssetIds")
      .mockResolvedValueOnce({ assetIds: [named], capped: true });
    try {
      await expect(search("DEGRADEMARKER")).rejects.toBeTruthy();
    } finally {
      walkFault.mockRestore();
      capped.mockRestore();
    }
  });

  it("reports when a text match stopped at its chunk limit", async () => {
    const first = await upload("cap-probe-one.pdf", "%PDF cap one fixture");
    const second = await upload("cap-probe-two.pdf", "%PDF cap two fixture");
    for (const assetId of [first, second]) {
      await mount(assetId, `cap-probe-${assetId}`);
      await client.assets.putText({ assetId, text: "CAPPROBEMARKER is in both documents." });
    }
    const db = await getDb();
    const match = (maxChunks: number) =>
      db.transaction((tx) =>
        assetTextSearchLogic.matchAssetTextAssetIds(
          tx,
          LOCAL_SPACE_ID,
          "CAPPROBEMARKER",
          literalSearchPattern("CAPPROBEMARKER"),
          { statementMs: 30_000, maxChunks },
        ),
      );
    expect(await match(10)).toEqual({
      assetIds: expect.arrayContaining([first, second]),
      capped: false,
    });
    const limited = await match(1);
    expect(limited.capped).toBe(true);
    expect(limited.assetIds).toHaveLength(1);
  });

  it("shows the newest files for a phrase in more chunks than the text match may list", async () => {
    // Its own space: the order and the chunk counts must be this test's alone.
    const spaceId = "common-phrase-search-index";
    const manager = { spaceId, actorId: "manager", isSpaceManager: true };
    const reader = { spaceId, actorId: "phrase-reader", isSpaceManager: false };
    const db = await getDb();
    const file = async (slug: string, text: string, updatedAt: string) => {
      const assetId = await upload(`${slug}.pdf`, `%PDF ${slug} fixture`);
      const usage = await mount(assetId, slug);
      await client.assets.putText({ assetId, text });
      const at = new Date(updatedAt);
      await db
        .update(busabaseAssetUsages)
        .set({ createdAt: at, updatedAt: at })
        .where(eq(busabaseAssetUsages.assetId, assetId));
      return { assetId, nodeId: usage.nodeId };
    };
    const { old1, old2, old3, n1, n2, n3 } = await runWithBusabaseContext(manager, async () => {
      // Three old archives full of the phrase, indexed first: 2,100 matching
      // chunks between them, more than the text match may list, and the ones
      // it reaches first.
      const archives = [];
      for (const day of [1, 2, 3]) {
        const archive = await file(
          `phrase-archive-${day}`,
          "COMMONPHRASEWORD in an old archive.",
          `2020-01-0${day}T00:00:00.000Z`,
        );
        await db.insert(busabaseAssetTextSearchChunks).values(
          Array.from({ length: 699 }, (_, i) => ({
            assetId: archive.assetId,
            chunkIndex: i + 1,
            contentText: `COMMONPHRASEWORD archive page ${i + 1}`,
          })),
        );
        archives.push(archive);
      }
      const recent = [];
      for (const day of [1, 2, 3]) {
        recent.push(
          await file(
            `phrase-recent-${day}`,
            `COMMONPHRASEWORD in recent note ${day}.`,
            `2026-01-0${day}T00:00:00.000Z`,
          ),
        );
      }
      await file("phrase-unrelated", "Nothing to see here.", "2026-01-04T00:00:00.000Z");
      const [first, second, third] = archives;
      const [one, two, three] = recent;
      return { old1: first, old2: second, old3: third, n1: one, n2: two, n3: three };
    });
    const assetIdsOf = (found: Awaited<ReturnType<typeof search>>) =>
      found.results.map((row) => row.id.split(":")[0]);
    const asManager = (options: Partial<Parameters<Client["search"]>[0]>) =>
      runWithBusabaseContext(manager, () => search("COMMONPHRASEWORD", options));

    const newest = await asManager({ limit: 2 });
    expect(assetIdsOf(newest)).toEqual([n3.assetId, n2.assetId]);
    expect(newest.hasMore).toBe(true);
    expect(newest.contentTruncated).toBe(false);
    const nextPage = await asManager({ limit: 2, offset: 2 });
    expect(assetIdsOf(nextPage)).toEqual([n1.assetId, old3.assetId]);
    const oldest = await asManager({ limit: 2, sort: "updated_asc" });
    expect(assetIdsOf(oldest)).toEqual([old1.assetId, old2.assetId]);
    expect(oldest.contentTruncated).toBe(false);
    // Only the current present text counts: a withdrawn slot's old chunks are
    // still stored, and must not match.
    const withdraw = (status: "none" | "present") =>
      db
        .update(busabaseAssetTexts)
        .set({ status })
        .where(eq(busabaseAssetTexts.assetId, n2.assetId));
    await withdraw("none");
    expect(assetIdsOf(await asManager({ limit: 2 }))).toEqual([n3.assetId, n1.assetId]);
    await withdraw("present");
    // The walk obeys the page's narrowing, so a folder's matches are found
    // however far down the space they rank, not crowded out by newer files.
    const inFolder = await asManager({ inNodeId: n1.nodeId, limit: 1 });
    expect(assetIdsOf(inFolder)).toEqual([n1.assetId]);
    expect(inFolder.contentTruncated).toBe(false);
    // A file the reader cannot see neither shows nor takes a place on the page.
    await runWithBusabaseContext(manager, () =>
      client.nodes.updateVisibility({ nodeId: n3.nodeId, visibility: "private" }),
    );
    const asReader = (limit: number) =>
      runWithBusabaseContext(reader, () => search("COMMONPHRASEWORD", { limit }));
    const readerPage = await asReader(2);
    expect(assetIdsOf(readerPage)).toEqual([n2.assetId, n1.assetId]);
    expect(readerPage.contentTruncated).toBe(false);
    const readerFirst = await asReader(1);
    expect(assetIdsOf(readerFirst)).toEqual([n2.assetId]);
    expect(readerFirst.hasMore).toBe(true);
  });

  it("stops the in-order text match at its chunk budget and says the answer is incomplete", async () => {
    const spaceId = "in-order-budget-search-index";
    const manager = { spaceId, actorId: "manager", isSpaceManager: true };
    await runWithBusabaseContext(manager, async () => {
      const db = await getDb();
      const ids: string[] = [];
      for (const day of [1, 2, 3]) {
        const assetId = await upload(`budget-${day}.pdf`, `%PDF budget ${day} fixture`);
        await mount(assetId, `budget-${day}`);
        await client.assets.putText({
          assetId,
          text: day === 1 ? "BUDGETPHRASE only in the oldest." : "Nothing here.",
        });
        const at = new Date(`2026-02-0${day}T00:00:00.000Z`);
        await db
          .update(busabaseAssetUsages)
          .set({ createdAt: at, updatedAt: at })
          .where(eq(busabaseAssetUsages.assetId, assetId));
        ids.push(assetId);
      }
      const walk = (maxChunks: number) =>
        db.transaction((tx) =>
          assetTextSearchLogic.matchAssetTextAssetIdsInOrder(
            tx,
            spaceId,
            literalSearchPattern("BUDGETPHRASE"),
            {
              statementMs: 30_000,
              limit: 5,
              scope: undefined,
              order: { column: "updatedAt", ascending: false },
              maxChunks,
            },
          ),
        );
      // Newest first, one chunk each: two chunks of budget never reach the oldest.
      expect(await walk(2)).toEqual({ assetIds: [], complete: false });
      expect(await walk(3)).toEqual({ assetIds: [ids[0]], complete: true });
      const page = (offset: number, maxChunks = 3) =>
        db.transaction((tx) =>
          assetTextSearchLogic.matchAssetTextAssetIdsInOrderPage(
            tx,
            spaceId,
            literalSearchPattern("BUDGETPHRASE"),
            {
              statementMs: 30_000,
              limit: 5,
              scope: undefined,
              order: { column: "updatedAt", ascending: false },
              maxChunks,
              pageSize: 1,
              offset,
            },
          ),
        );
      // Nonmatching pages still advance. Each page is its own transaction,
      // and only the last candidate matches: never skip or reread an offset.
      for (const offset of [0, 1]) {
        expect(await page(offset)).toEqual({
          assetIds: [],
          checkedAssets: 1,
          complete: false,
          stopped: false,
        });
      }
      expect(await page(2)).toEqual({
        assetIds: [ids[0]],
        checkedAssets: 1,
        complete: false,
        stopped: false,
      });
      expect(await page(3)).toEqual({
        assetIds: [],
        checkedAssets: 0,
        complete: true,
        stopped: false,
      });
      const oldestFirst = await db.transaction((tx) =>
        assetTextSearchLogic.matchAssetTextAssetIdsInOrderPage(
          tx,
          spaceId,
          literalSearchPattern("BUDGETPHRASE"),
          {
            statementMs: 30_000,
            limit: 1,
            scope: undefined,
            order: { column: "updatedAt", ascending: true },
            pageSize: 1,
          },
        ),
      );
      expect(oldestFirst).toEqual({
        assetIds: [ids[0]],
        checkedAssets: 1,
        complete: true,
        stopped: false,
      });
      // The same last candidate is a sentinel when the chunk budget is two:
      // its matching text must not be read or returned.
      expect(await page(2, 2)).toEqual({
        assetIds: [],
        checkedAssets: 0,
        complete: false,
        stopped: true,
      });
    });
  });

  it("does not tell a reader their miss is incomplete because of a file they cannot see", async () => {
    // Its own space: the coverage gap must be this one private file's.
    const spaceId = "private-partial-search-index";
    const manager = { spaceId, actorId: "manager", isSpaceManager: true };
    const reader = { spaceId, actorId: "plain-reader", isSpaceManager: false };
    const secretId = await runWithBusabaseContext(manager, async () => {
      const assetId = await upload("private-partial.pdf", "%PDF private partial fixture");
      const usage = await mount(assetId, "private-partial");
      await client.assets.putText({
        assetId,
        text: "PRIVATEPARTIALMARKER in a long private file.",
      });
      await (await getDb())
        .update(busabaseAssetTextSearch)
        .set({ complete: false })
        .where(eq(busabaseAssetTextSearch.assetId, assetId));
      await client.nodes.updateVisibility({ nodeId: usage.nodeId, visibility: "private" });
      return assetId;
    });
    const asManager = await runWithBusabaseContext(manager, () => search("NOTHINGMATCHESTHIS"));
    const asReader = await runWithBusabaseContext(reader, () => search("NOTHINGMATCHESTHIS"));
    expect(asManager.contentTruncated).toBe(true);
    expect(asReader.contentTruncated).toBe(false);
    expect(secretId).toBeTruthy();
  });

  it("summarises a self-heal run: what it indexed, what failed and why, and where the time went", async () => {
    const spaceId = "heal-summary-search-index";
    await runWithBusabaseContext(
      { spaceId, actorId: "manager", isSpaceManager: true },
      async () => {
        const ids = [];
        for (const name of ["heal-summary-a.pdf", "heal-summary-b.pdf"]) {
          const assetId = await upload(name, `%PDF ${name}`);
          await mount(assetId, name.replace(".pdf", ""));
          await client.assets.putText({ assetId, text: `HEALSUMMARYMARKER in ${name}.` });
          ids.push(assetId);
        }
        const db = await getDb();
        await db
          .delete(busabaseAssetTextSearch)
          .where(inArray(busabaseAssetTextSearch.assetId, ids));
        const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
        let lines: string[] = [];
        try {
          expect(await healAssetTextProjections(db, spaceId, { waitMs: 60_000 })).toBe(true);
          lines = info.mock.calls
            .map((call) => String(call[0]))
            .filter((l) => l.includes("heal run"));
        } finally {
          info.mockRestore();
        }
        expect(lines).toHaveLength(1);
        expect(lines[0]).toContain(`space=${spaceId}`);
        expect(lines[0]).toContain("indexed=2");
        expect(lines[0]).toContain("failed=0");
        expect(lines[0]).toContain("backedOff=0");
        expect(lines[0]).toMatch(
          /readMs=\d+ publishMs=\d+ elapsedMs=\d+ finished=true reasons=\{\}/,
        );
        expect(lines[0]).not.toContain("HEALSUMMARYMARKER");
        // Nothing left to do: a quiet run logs nothing.
        const quiet = vi.spyOn(console, "info").mockImplementation(() => undefined);
        let quietLines: string[] = [];
        try {
          await healAssetTextProjections(db, spaceId, { waitMs: 60_000 });
          quietLines = quiet.mock.calls
            .map((call) => String(call[0]))
            .filter((l) => l.includes("heal run"));
        } finally {
          quiet.mockRestore();
        }
        expect(quietLines).toHaveLength(0);
      },
    );
  });

  it("reports a text-kind file whose text slot could not be registered, then registers it on the next pass", async () => {
    const spaceId = "legacy-register-search-index";
    await runWithBusabaseContext(
      { spaceId, actorId: "manager", isSpaceManager: true },
      async () => {
        const assetId = await upload(
          "legacy-notes.txt",
          "LEGACYREGISTERMARKER lives here.",
          "text/plain",
        );
        await mount(assetId, "legacy-register");
        const db = await getDb();
        // A file uploaded before text slots existed: no slot, no projection.
        await db
          .delete(busabaseAssetTextSearch)
          .where(eq(busabaseAssetTextSearch.assetId, assetId));
        await db.delete(busabaseAssetTexts).where(eq(busabaseAssetTexts.assetId, assetId));
        const register = vi
          .spyOn(assetTextsLogic, "autoRegisterAssetText")
          .mockRejectedValueOnce(new Error("registry unavailable"));
        const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        let failed: Awaited<ReturnType<typeof backfillAssetTextSearch>>;
        let logged: string[];
        try {
          failed = await backfillAssetTextSearch(db, { spaceId });
          logged = warnings.mock.calls.map((call) => String(call[0]));
        } finally {
          register.mockRestore();
          warnings.mockRestore();
        }
        expect(failed.failureReasons).toEqual({ "register-error": 1 });
        expect(logged.join("\n")).toContain(
          "reason=register-error error=Error: registry unavailable",
        );
        const retried = await backfillAssetTextSearch(db, { spaceId });
        expect(retried).toMatchObject({ indexed: 1, failed: 0, failureReasons: {} });
        expect((await search("LEGACYREGISTERMARKER")).results).toHaveLength(1);
      },
    );
  });

  it("finishes the self-heal inside the call on an embedded database, leaving nothing running behind it", async () => {
    // PGLite is one connection inside this process. A run left going after the call
    // returned is work a test or a shutdown can tear the database down under, and
    // that hung CI for hours. So even with a one-millisecond wait the call returns
    // only once its run is over.
    const spaceId = "embedded-heal-search-index";
    await runWithBusabaseContext(
      { spaceId, actorId: "manager", isSpaceManager: true },
      async () => {
        const ids = [];
        for (const name of ["embedded-heal-a.pdf", "embedded-heal-b.pdf", "embedded-heal-c.pdf"]) {
          const assetId = await upload(name, `%PDF ${name}`);
          await mount(assetId, name.replace(".pdf", ""));
          await client.assets.putText({ assetId, text: `EMBEDDEDHEAL body of ${name}` });
          ids.push(assetId);
        }
        const db = await getDb();
        await db
          .delete(busabaseAssetTextSearch)
          .where(inArray(busabaseAssetTextSearch.assetId, ids));
        const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
        let runLines: string[] = [];
        let projected = 0;
        try {
          await healAssetTextProjections(db, spaceId, { waitMs: 1 });
          runLines = info.mock.calls
            .map((call) => String(call[0]))
            .filter((l) => l.includes("heal run"));
          projected = (
            await db
              .select()
              .from(busabaseAssetTextSearch)
              .where(inArray(busabaseAssetTextSearch.assetId, ids))
          ).length;
        } finally {
          info.mockRestore();
        }
        // The run had already finished and reported when the call returned.
        expect(runLines).toHaveLength(1);
        expect(runLines[0]).toContain("indexed=3");
        expect(projected).toBe(3);
      },
    );
  });

  it("finishes an upload's index warm-up inside the call on an embedded database", async () => {
    // The warm-up used to give up waiting after 300 ms and let the read carry on in the
    // background. A slow object read must now be waited for.
    const spaceId = "embedded-warm-search-index";
    await runWithBusabaseContext(
      { spaceId, actorId: "manager", isSpaceManager: true },
      async () => {
        const original = LocalStorage.prototype.getObjectRange;
        const slow = vi
          .spyOn(LocalStorage.prototype, "getObjectRange")
          .mockImplementation(async function (
            this: LocalStorage,
            key: string,
            start: number,
            end: number,
          ) {
            await new Promise((resolve) => setTimeout(resolve, 700));
            return original.call(this, key, start, end);
          });
        try {
          const assetId = await upload(
            "embedded-warm.txt",
            "EMBEDDEDWARM native text.",
            "text/plain",
          );
          const db = await getDb();
          const [projection] = await db
            .select()
            .from(busabaseAssetTextSearch)
            .where(eq(busabaseAssetTextSearch.assetId, assetId));
          expect(projection?.complete).toBe(true);
        } finally {
          slow.mockRestore();
        }
      },
    );
  });

  it("puts the database's own reason first when a failure has a cause", async () => {
    const spaceId = "failure-cause-search-index";
    await runWithBusabaseContext(
      { spaceId, actorId: "manager", isSpaceManager: true },
      async () => {
        const assetId = await upload("failure-cause.txt", "FAILURECAUSE text.", "text/plain");
        await mount(assetId, "failure-cause");
        const db = await getDb();
        await db
          .delete(busabaseAssetTextSearch)
          .where(eq(busabaseAssetTextSearch.assetId, assetId));
        await db.delete(busabaseAssetTexts).where(eq(busabaseAssetTexts.assetId, assetId));
        const register = vi.spyOn(assetTextsLogic, "autoRegisterAssetText").mockRejectedValueOnce(
          new Error(`Failed query: insert into "busabase_asset_texts" ${"x".repeat(300)}`, {
            cause: Object.assign(new Error('duplicate key value violates unique constraint "k"'), {
              code: "23505",
            }),
          }),
        );
        const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        let line = "";
        try {
          await backfillAssetTextSearch(db, { spaceId });
          line = warnings.mock.calls.map((call) => String(call[0])).join("\n");
        } finally {
          register.mockRestore();
          warnings.mockRestore();
        }
        expect(line).toContain("error=Error 23505: duplicate key value violates unique constraint");
        expect(line.indexOf("duplicate key")).toBeLessThan(line.indexOf("Failed query"));
      },
    );
  });

  it("leaves failing assets out of the query while they back off, so the assets behind them are reached", async () => {
    const spaceId = "backoff-reach-search-index";
    await runWithBusabaseContext(
      { spaceId, actorId: "manager", isSpaceManager: true },
      async () => {
        // Ids are time-ordered, so the three whose text object is gone come first.
        const make = async (name: string) => {
          const assetId = await upload(`${name}.pdf`, `%PDF ${name}`);
          await mount(assetId, name);
          await client.assets.putText({ assetId, text: `BACKOFFREACH body of ${name}` });
          return assetId;
        };
        const failing = [
          await make("backoff-bad-0"),
          await make("backoff-bad-1"),
          await make("backoff-bad-2"),
        ];
        const healthy = [await make("backoff-ok-0"), await make("backoff-ok-1")];
        const db = await getDb();
        await db
          .delete(busabaseAssetTextSearch)
          .where(inArray(busabaseAssetTextSearch.assetId, [...failing, ...healthy]));
        for (const assetId of failing) {
          const [row] = await db
            .select()
            .from(busabaseAssetTexts)
            .where(eq(busabaseAssetTexts.assetId, assetId));
          await storage.deleteObject(requireValue(row).textStorageKey);
        }
        const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
          // Each call is a fresh self-heal run: no cursor, the whole queue again.
          const attempt = () =>
            backfillAssetTextSearch(db, { spaceId, limit: 2, coolDownFailures: true });
          expect(await attempt()).toMatchObject({ indexed: 0, failed: 2, backedOff: 0 });
          // The first two are backing off and absent from the query, so the page
          // fills with the next failing asset and the first healthy one. Before,
          // it was the same two again, skipped after being fetched.
          expect(await attempt()).toMatchObject({
            indexed: 1,
            failed: 1,
            cooledDown: 0,
            backedOff: 2,
          });
          expect(await attempt()).toMatchObject({
            indexed: 1,
            failed: 0,
            cooledDown: 0,
            backedOff: 3,
          });
          // Nothing left that is worth attempting.
          expect(await attempt()).toMatchObject({ indexed: 0, failed: 0, backedOff: 3 });
        } finally {
          warnings.mockRestore();
        }
      },
    );
  });

  it("waits longer after each further failure of the same asset", async () => {
    const spaceId = "backoff-growth-search-index";
    await runWithBusabaseContext(
      { spaceId, actorId: "manager", isSpaceManager: true },
      async () => {
        const assetId = await upload("backoff-growth.pdf", "%PDF backoff growth");
        await mount(assetId, "backoff-growth");
        await client.assets.putText({ assetId, text: "BACKOFFGROWTH body" });
        const db = await getDb();
        await db
          .delete(busabaseAssetTextSearch)
          .where(eq(busabaseAssetTextSearch.assetId, assetId));
        const [row] = await db
          .select()
          .from(busabaseAssetTexts)
          .where(eq(busabaseAssetTexts.assetId, assetId));
        await storage.deleteObject(requireValue(row).textStorageKey);
        const warnings = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        const minute = 60_000;
        const start = Date.now();
        vi.useFakeTimers({ toFake: ["Date"] });
        try {
          const attemptAt = async (minutes: number) => {
            vi.setSystemTime(start + minutes * minute);
            return (await backfillAssetTextSearch(db, { spaceId, coolDownFailures: true })).failed;
          };
          expect(await attemptAt(0)).toBe(1); // first failure: wait 10 minutes
          expect(await attemptAt(9)).toBe(0);
          expect(await attemptAt(11)).toBe(1); // second failure: wait 40 minutes
          expect(await attemptAt(11 + 39)).toBe(0);
          expect(await attemptAt(11 + 41)).toBe(1); // third failure: wait 160 minutes
          expect(await attemptAt(11 + 41 + 159)).toBe(0);
          expect(await attemptAt(11 + 41 + 161)).toBe(1);
        } finally {
          vi.useRealTimers();
          warnings.mockRestore();
        }
      },
    );
  });
});
