import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { storage } from "openlib/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { docBodyKey } from "../src/domains/doc/handlers";
import { busabaseRouter } from "../src/router";

/**
 * Unified Grep (P2a files+docs, P2b records) integration coverage — driven
 * through the real oRPC router (mirrors `drive-grep-retrieval.test.ts`'s
 * harness: real temp PGLite DB + real local storage) so these tests
 * exercise the exact `grep` → `logic/grep.ts` → (`grepAssets` | docs adapter
 * | records adapter) code path a caller hits. See
 * apps/busabase/content/spec/unified-grep.md.
 *
 * The pre-existing `assets.grep` suite (drive-grep-retrieval.test.ts,
 * drive-grep-concurrency.test.ts, drive-grep-rg-routing.test.ts,
 * drive-grep-rg-real.test.ts, grep-pattern-guard.test.ts,
 * grep-literal-pattern.test.ts) is the regression gate for this feature and
 * is intentionally NOT modified by this change — see this PR's report.
 *
 * Records tests share this file's DB/client with the P2a files+docs tests
 * above (same convention: scope narrowly by explicit ids —
 * `scope: { records: { baseIds: [...] } }` — to avoid cross-test DB
 * pollution, mirroring how the docs tests scope by `nodeIds`).
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

describe("Unified Grep — POST /grep (files + docs + records)", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-unified-grep-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-unified-grep-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  /** Upload+confirm+putText a small text asset, returning its assetId. */
  const seedFile = async (opts: { fileName: string; hashByte: string; text: string }) => {
    const contentHash = HASH(opts.hashByte);
    const req = await client.assets.createUploadUrl({
      fileName: opts.fileName,
      mimeType: "text/plain",
      sizeBytes: 100,
      contentHash,
    });
    const confirmed = await client.assets.confirm({
      storageKey: req.storageKey,
      fileName: opts.fileName,
      mimeType: "text/plain",
      sizeBytes: 100,
      contentHash,
    });
    const assetId = expectDefined(confirmed.assetId);
    await client.assets.putText({ assetId, text: opts.text });
    return assetId;
  };

  /** Create an auto-merged Doc, returning its node id. */
  const seedDoc = async (opts: { slug: string; name: string; body: string }) => {
    const doc = await client.docs.create({ autoMerge: true, ...opts });
    if (!("node" in doc)) throw new Error("Expected a materialized DocVO (autoMerge: true)");
    return doc.node.id;
  };

  const archiveNode = async (nodeId: string) => {
    const cr = await client.nodes.createChangeRequest({ operations: [{ kind: "delete", nodeId }] });
    await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
    await client.changeRequests.merge({ changeRequestId: cr.id });
  };

  it("finds a cross-source hit: one match from files, one from docs, files ordered before docs", async () => {
    const assetId = await seedFile({
      fileName: "cross-source.log",
      hashByte: "1",
      text: "CROSSMARKER lives in a file",
    });
    const nodeId = await seedDoc({
      slug: "cross-source-doc",
      name: "Cross Source Doc",
      body: "CROSSMARKER lives in a doc\n",
    });

    const result = await client.grep({ pattern: "CROSSMARKER" });

    expect(result.matches).toHaveLength(2);
    expect(result.matches[0]?.source).toBe("files");
    expect(result.matches[1]?.source).toBe("docs");
    const fileMatch = result.matches[0];
    const docMatch = result.matches[1];
    if (fileMatch?.source === "files") expect(fileMatch.assetId).toBe(assetId);
    if (docMatch?.source === "docs") expect(docMatch.nodeId).toBe(nodeId);
    expect(result.coverage.files.scanned).toBeGreaterThanOrEqual(1);
    expect(result.coverage.docs.scanned).toBeGreaterThanOrEqual(1);
  });

  it("scopes to sources: ['docs'] — files coverage stays empty, no file match even though the marker is also in a file", async () => {
    await seedFile({
      fileName: "docs-only-scope.log",
      hashByte: "2",
      text: "DOCSONLYMARKER lives in a file too",
    });
    const nodeId = await seedDoc({
      slug: "docs-only-scope-doc",
      name: "Docs Only Scope Doc",
      body: "DOCSONLYMARKER lives in a doc\n",
    });

    const result = await client.grep({ pattern: "DOCSONLYMARKER", sources: ["docs"] });

    expect(result.matches).toHaveLength(1);
    expect(result.matches[0]?.source).toBe("docs");
    if (result.matches[0]?.source === "docs") expect(result.matches[0].nodeId).toBe(nodeId);
    expect(result.coverage.files).toEqual({
      scanned: 0,
      missing: [],
      stale: [],
      unsearchable: 0,
      errored: [],
      notReached: 0,
    });
  });

  it("reports exact line/column/text and respects contextLines for a Doc match", async () => {
    const body = "line one\nline two\nLINEMARKER on line three\nline four\nline five\n";
    const nodeId = await seedDoc({ slug: "line-column-doc", name: "Line Column Doc", body });

    const result = await client.grep({
      pattern: "LINEMARKER",
      sources: ["docs"],
      contextLines: 1,
    });

    expect(result.matches).toHaveLength(1);
    const match = expectDefined(result.matches[0]);
    if (match.source !== "docs") throw new Error("expected a docs match");
    expect(match.nodeId).toBe(nodeId);
    expect(match.line).toBe(3);
    expect(match.column).toBe(1);
    expect(match.text).toBe("LINEMARKER on line three");
    expect(match.before).toEqual(["line two"]);
    expect(match.after).toEqual(["line four"]);
  });

  it("excludes an archived doc: no match, and it is not counted in docs.scanned", async () => {
    const nodeId = await seedDoc({
      slug: "archived-doc",
      name: "Archived Doc",
      body: "ARCHIVEDMARKER should not be found\n",
    });
    await archiveNode(nodeId);

    const result = await client.grep({
      pattern: "ARCHIVEDMARKER",
      sources: ["docs"],
      // Scope to just this node — the DB is shared across this file's tests,
      // so other tests' (non-archived) docs would otherwise also be counted
      // as "scanned" and mask the assertion this test cares about.
      scope: { docs: { nodeIds: [nodeId] } },
    });

    expect(result.matches).toHaveLength(0);
    expect(result.coverage.docs.scanned).toBe(0);
  });

  it("reports a doc body read failure in coverage.docs.errored, not as an unremarked absence", async () => {
    const nodeId = await seedDoc({
      slug: "errored-doc",
      name: "Errored Doc",
      body: "ERROREDMARKER should not be reachable\n",
    });
    // Simulate a storage failure out from under the doc node — mirrors
    // `drive-grep-retrieval.test.ts`'s "reports a scan failure explicitly in
    // errored" test, adapted to Docs (which have no DB pointer to repoint;
    // deleting the backing object directly is the equivalent failure mode).
    await storage.deleteObject(docBodyKey(nodeId));

    const result = await client.grep({
      pattern: "ERROREDMARKER",
      sources: ["docs"],
      // Scope to just this node — see the archived-doc test above for why.
      scope: { docs: { nodeIds: [nodeId] } },
    });

    expect(result.matches).toHaveLength(0);
    expect(result.coverage.docs.scanned).toBe(0);
    expect(result.coverage.docs.errored).toContain(nodeId);
  });

  it("honors the maxMatches budget across docs: truncated, accurate notReached, never over budget", async () => {
    const nodeIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const nodeId = await seedDoc({
        slug: `budget-doc-${i}`,
        name: `Budget Doc ${i}`,
        body: `BUDGETNEEDLE-${i} present\n`,
      });
      nodeIds.push(nodeId);
    }

    const result = await client.grep({
      pattern: "BUDGETNEEDLE-\\d",
      sources: ["docs"],
      maxMatches: 2,
      // Scope to just these 5 nodes — see the archived-doc test above for why.
      scope: { docs: { nodeIds } },
    });

    expect(result.truncated).toBe(true);
    expect(result.matches.length).toBeLessThanOrEqual(2);
    expect(result.coverage.docs.notReached).toBeGreaterThan(0);
    expect(result.coverage.docs.scanned + result.coverage.docs.notReached).toBe(nodeIds.length);
  });

  it("regex parity: unified grep's files source returns byte-identical matches to assets.grep", async () => {
    const assetId = await seedFile({
      fileName: "parity.log",
      hashByte: "3",
      text: "call 555-1234 or 555-5678 today",
    });

    const legacy = await client.assets.grep({
      pattern: "\\d{3}-\\d{4}",
      scope: { assetIds: [assetId] },
    });
    const unified = await client.grep({
      pattern: "\\d{3}-\\d{4}",
      sources: ["files"],
      scope: { files: { assetIds: [assetId] } },
    });

    expect(unified.matches).toHaveLength(legacy.matches.length);
    const stripped = unified.matches.map((match) => {
      if (match.source !== "files") throw new Error("expected a files match");
      const { source: _source, ...rest } = match;
      return rest;
    });
    expect(stripped).toEqual(legacy.matches);
  });

  describe("records adapter (P2b)", () => {
    const approveAndMerge = async (changeRequestId: string) => {
      await client.changeRequests.review({ changeRequestId, verdict: "approved" });
      return client.changeRequests.merge({ changeRequestId });
    };

    /** Create+auto-merge a Base, returning its materialized BaseVO. */
    const seedBase = async (opts: {
      slug: string;
      name: string;
      fields: Parameters<Client["bases"]["create"]>[0]["fields"];
    }) => {
      const base = await client.bases.create({
        slug: opts.slug,
        name: opts.name,
        fields: opts.fields,
        autoMerge: true,
      });
      if ("status" in base) throw new Error("Expected materialized BaseVO");
      return base;
    };

    /** Create a record in `baseId` through the create → review → merge loop. */
    const createBaseRecord = async (baseId: string, fields: Record<string, unknown>) => {
      const cr = await client.bases.createChangeRequest({ baseId, fields, submittedBy: "agent" });
      const merged = await approveAndMerge(cr.id);
      if (!merged.record) throw new Error("expected a created record");
      return merged.record.id;
    };

    const archiveBase = async (baseId: string) => {
      const cr = await client.bases.archiveChangeRequest({ baseId, submittedBy: "agent" });
      await approveAndMerge(cr.id);
    };

    const archiveRecord = async (recordId: string) => {
      const cr = await client.records.deleteChangeRequest({ recordId });
      await approveAndMerge(cr.id);
    };

    const deleteField = async (baseId: string, fieldId: string) => {
      const cr = await client.bases.deleteFieldChangeRequest({
        baseId,
        fieldId,
        submittedBy: "agent",
      });
      await approveAndMerge(cr.id);
    };

    it("finds a marker past char 1024 of a longtext field via records grep, but NOT via search — the fidelity gap this task closes", async () => {
      const base = await seedBase({
        slug: "grep-records-longtext",
        name: "Longtext Base",
        fields: [{ slug: "notes", name: "Notes", type: "longtext" }],
      });
      const marker = "LONGTAILMARKER9271";
      // VALUE_TEXT_INDEX_LIMIT (logic/vo.ts) truncates search's projection at
      // 1024 chars — pad well past that boundary before the marker.
      const padding = "x".repeat(1100);
      const value = `${padding} ${marker} tail content`;
      const recordId = await createBaseRecord(base.id, { notes: value });

      // Side A: records grep finds it (canonical, untruncated commit data).
      const grepResult = await client.grep({
        pattern: marker,
        sources: ["records"],
        scope: { records: { baseIds: [base.id] } },
      });
      expect(grepResult.matches).toHaveLength(1);
      const match = expectDefined(grepResult.matches[0]);
      if (match.source !== "records") throw new Error("expected a records match");
      expect(match.recordId).toBe(recordId);
      expect(match.baseId).toBe(base.id);
      expect(match.fieldSlug).toBe("notes");
      expect(match.line).toBe(1);
      expect(match.text).toContain(marker);

      // Side B: search does NOT find it — the projection truncated the value
      // before the marker's position, so it never got indexed at all.
      const searchResult = await client.search({ query: marker, limit: 10 });
      expect(searchResult.results).toHaveLength(0);
    });

    it("flattens number/boolean/array/json fields into scannable text; skips attachment content (documented boundary)", async () => {
      const base = await seedBase({
        slug: "grep-records-flatten",
        name: "Flatten Base",
        fields: [
          { slug: "f_number", name: "Number", type: "number" },
          { slug: "f_checkbox", name: "Checkbox", type: "checkbox" },
          {
            slug: "f_multi",
            name: "Multi",
            type: "multiselect",
            options: {
              choices: [
                { id: "m1", name: "FLATTENMULTIALPHA" },
                { id: "m2", name: "FLATTENMULTIBETA" },
              ],
            },
          },
          { slug: "f_json", name: "JSON", type: "json" },
          {
            slug: "f_attach",
            name: "Attach",
            type: "attachment",
            options: {
              attachment: {
                maxFiles: 2,
                allowedMimeTypes: ["image/png"],
                maxFileSize: 10 * 1024 * 1024,
              },
            },
          },
        ],
      });
      await createBaseRecord(base.id, {
        f_number: 918273,
        f_checkbox: true,
        f_multi: ["FLATTENMULTIALPHA", "FLATTENMULTIBETA"],
        f_json: JSON.stringify({ note: "FLATTENJSONMARKER" }),
        f_attach: [
          {
            id: "att_flatten_1",
            url: "https://cdn.example.com/x.png",
            fileName: "FLATTENFILEMARKER.png",
            mimeType: "image/png",
            size: 1000,
          },
        ],
      });
      const scope = { records: { baseIds: [base.id] } };

      const numberResult = await client.grep({ pattern: "918273", sources: ["records"], scope });
      expect(numberResult.matches).toHaveLength(1);
      const numberMatch = expectDefined(numberResult.matches[0]);
      if (numberMatch.source !== "records") throw new Error("expected a records match");
      expect(numberMatch.fieldSlug).toBe("f_number");
      expect(numberMatch.text).toBe("918273");

      const boolResult = await client.grep({ pattern: "true", sources: ["records"], scope });
      expect(boolResult.matches).toHaveLength(1);
      const boolMatch = expectDefined(boolResult.matches[0]);
      if (boolMatch.source !== "records") throw new Error("expected a records match");
      expect(boolMatch.fieldSlug).toBe("f_checkbox");
      expect(boolMatch.text).toBe("true");

      const arrayResult = await client.grep({
        pattern: "FLATTENMULTIALPHA, FLATTENMULTIBETA",
        sources: ["records"],
        scope,
      });
      expect(arrayResult.matches).toHaveLength(1);
      const arrayMatch = expectDefined(arrayResult.matches[0]);
      if (arrayMatch.source !== "records") throw new Error("expected a records match");
      expect(arrayMatch.fieldSlug).toBe("f_multi");

      const jsonResult = await client.grep({
        pattern: "FLATTENJSONMARKER",
        sources: ["records"],
        scope,
      });
      expect(jsonResult.matches).toHaveLength(1);
      const jsonMatch = expectDefined(jsonResult.matches[0]);
      if (jsonMatch.source !== "records") throw new Error("expected a records match");
      expect(jsonMatch.fieldSlug).toBe("f_json");

      // Documented boundary: attachment/relation fields are pointers, not
      // content — the marker inside the attachment ref is never surfaced.
      const attachResult = await client.grep({
        pattern: "FLATTENFILEMARKER",
        sources: ["records"],
        scope,
      });
      expect(attachResult.matches).toHaveLength(0);
    });

    it("confines before/after context to the SAME field — never bleeds into another field's or record's lines", async () => {
      const base = await seedBase({
        slug: "grep-records-context",
        name: "Context Base",
        fields: [
          { slug: "field_a", name: "Field A", type: "longtext" },
          { slug: "field_b", name: "Field B", type: "longtext" },
        ],
      });
      const marker = "CONTEXTMARKER5521";
      const valueA = `alpha before line\n${marker} in field a\nalpha after line`;
      const valueB = `beta before line\n${marker} in field b\nbeta after line`;
      await createBaseRecord(base.id, { field_a: valueA, field_b: valueB });

      const result = await client.grep({
        pattern: marker,
        sources: ["records"],
        contextLines: 1,
        scope: { records: { baseIds: [base.id] } },
      });

      expect(result.matches).toHaveLength(2);
      const byField = new Map(
        result.matches.map((m) => [m.source === "records" ? m.fieldSlug : "", m]),
      );
      const matchA = byField.get("field_a");
      const matchB = byField.get("field_b");
      expect(matchA).toBeDefined();
      expect(matchB).toBeDefined();
      if (matchA?.source === "records") {
        expect(matchA.before).toEqual(["alpha before line"]);
        expect(matchA.after).toEqual(["alpha after line"]);
      }
      if (matchB?.source === "records") {
        expect(matchB.before).toEqual(["beta before line"]);
        expect(matchB.after).toEqual(["beta after line"]);
      }
    });

    it("scope.records.baseIds / baseSlugs narrow to specific Bases (each is a union match, not an intersection)", async () => {
      const marker = "SCOPEMARKER7734";
      const baseA = await seedBase({
        slug: "grep-records-scope-a",
        name: "Scope A",
        fields: [{ slug: "notes", name: "Notes", type: "text" }],
      });
      const baseB = await seedBase({
        slug: "grep-records-scope-b",
        name: "Scope B",
        fields: [{ slug: "notes", name: "Notes", type: "text" }],
      });
      const recordA = await createBaseRecord(baseA.id, { notes: marker });
      const recordB = await createBaseRecord(baseB.id, { notes: marker });

      const byId = await client.grep({
        pattern: marker,
        sources: ["records"],
        scope: { records: { baseIds: [baseA.id] } },
      });
      expect(byId.matches).toHaveLength(1);
      const idMatch = expectDefined(byId.matches[0]);
      if (idMatch.source !== "records") throw new Error("expected a records match");
      expect(idMatch.recordId).toBe(recordA);

      const bySlug = await client.grep({
        pattern: marker,
        sources: ["records"],
        scope: { records: { baseSlugs: [baseB.slug] } },
      });
      expect(bySlug.matches).toHaveLength(1);
      const slugMatch = expectDefined(bySlug.matches[0]);
      if (slugMatch.source !== "records") throw new Error("expected a records match");
      expect(slugMatch.recordId).toBe(recordB);

      // Union: both lists given, neither Base excluded.
      const union = await client.grep({
        pattern: marker,
        sources: ["records"],
        scope: { records: { baseIds: [baseA.id], baseSlugs: [baseB.slug] } },
      });
      expect(union.matches.map((m) => (m.source === "records" ? m.recordId : null)).sort()).toEqual(
        [recordA, recordB].sort(),
      );
    });

    it("excludes an archived Base's records: no match, not counted in records.scanned", async () => {
      const marker = "ARCHIVEDBASEMARKER8842";
      const base = await seedBase({
        slug: "grep-records-archived-base",
        name: "Archived Base",
        fields: [{ slug: "notes", name: "Notes", type: "text" }],
      });
      await createBaseRecord(base.id, { notes: marker });
      await archiveBase(base.id);

      const result = await client.grep({
        pattern: marker,
        sources: ["records"],
        scope: { records: { baseIds: [base.id] } },
      });
      expect(result.matches).toHaveLength(0);
      expect(result.coverage.records.scanned).toBe(0);
    });

    it("excludes a non-active (archived) record: no match, not counted in records.scanned", async () => {
      const marker = "ARCHIVEDRECORDMARKER9931";
      const base = await seedBase({
        slug: "grep-records-archived-record",
        name: "Archived Record Base",
        fields: [{ slug: "notes", name: "Notes", type: "text" }],
      });
      const recordId = await createBaseRecord(base.id, { notes: marker });
      await archiveRecord(recordId);

      const result = await client.grep({
        pattern: marker,
        sources: ["records"],
        scope: { records: { baseIds: [base.id] } },
      });
      expect(result.matches).toHaveLength(0);
      expect(result.coverage.records.scanned).toBe(0);
    });

    it("excludes a soft-deleted field's stale value still sitting in headCommit.fields (deletedAt correctness regression)", async () => {
      const marker = "DELETEDFIELDMARKER4471";
      const base = await seedBase({
        slug: "grep-records-deleted-field",
        name: "Deleted Field Base",
        fields: [
          { slug: "keep", name: "Keep", type: "text" },
          { slug: "gone", name: "Gone", type: "text" },
        ],
      });
      const goneField = base.fields.find((f) => f.slug === "gone");
      if (!goneField) throw new Error("expected a 'gone' field");
      await createBaseRecord(base.id, { keep: "keep value", gone: marker });

      // Soft-delete the "gone" field AFTER the record was written — its
      // stale value (the marker) is still sitting in headCommit.fields.gone,
      // but loadRecordBatchData's field query filters isNull(deletedAt), so
      // it must never resurface.
      await deleteField(base.id, goneField.id);

      const result = await client.grep({
        pattern: marker,
        sources: ["records"],
        scope: { records: { baseIds: [base.id] } },
      });
      expect(result.matches).toHaveLength(0);
      // The record itself IS still scanned — only its "keep" field
      // (unaffected) is scanned, "gone" is skipped entirely.
      expect(result.coverage.records.scanned).toBe(1);
    });

    it("honors the maxMatches budget across records: truncated, accurate notReached, never over budget", async () => {
      const base = await seedBase({
        slug: "grep-records-budget",
        name: "Budget Base",
        fields: [{ slug: "notes", name: "Notes", type: "text" }],
      });
      const recordIds: string[] = [];
      for (let i = 0; i < 5; i++) {
        recordIds.push(
          await createBaseRecord(base.id, { notes: `BUDGETRECORDNEEDLE-${i} present` }),
        );
      }

      const result = await client.grep({
        pattern: "BUDGETRECORDNEEDLE-\\d",
        sources: ["records"],
        maxMatches: 2,
        scope: { records: { baseIds: [base.id] } },
      });

      expect(result.truncated).toBe(true);
      expect(result.matches.length).toBeLessThanOrEqual(2);
      expect(result.coverage.records.notReached).toBeGreaterThan(0);
      expect(result.coverage.records.scanned + result.coverage.records.notReached).toBe(
        recordIds.length,
      );
    });

    it("orders matches files → docs → records when a marker is seeded in all three sources (default sources = all three)", async () => {
      const marker = "TRISOURCEMARKER6612";
      const assetId = await seedFile({
        fileName: "tri-source.log",
        hashByte: "7",
        text: `${marker} lives in a file`,
      });
      const nodeId = await seedDoc({
        slug: "tri-source-doc",
        name: "Tri Source Doc",
        body: `${marker} lives in a doc\n`,
      });
      const base = await seedBase({
        slug: "grep-records-tri-source",
        name: "Tri Source Base",
        fields: [{ slug: "notes", name: "Notes", type: "text" }],
      });
      const recordId = await createBaseRecord(base.id, { notes: `${marker} lives in a record` });

      // No `sources` given — proves the DEFAULT scans all three, in order.
      const result = await client.grep({ pattern: marker });

      expect(result.matches).toHaveLength(3);
      expect(result.matches.map((m) => m.source)).toEqual(["files", "docs", "records"]);
      const fileMatch = result.matches[0];
      const docMatch = result.matches[1];
      const recordMatch = result.matches[2];
      if (fileMatch?.source === "files") expect(fileMatch.assetId).toBe(assetId);
      if (docMatch?.source === "docs") expect(docMatch.nodeId).toBe(nodeId);
      if (recordMatch?.source === "records") expect(recordMatch.recordId).toBe(recordId);
    });

    it("sources: ['files', 'docs'] (records omitted) — records coverage stays all-zero, no records match even though the marker is also in a record", async () => {
      const marker = "RECORDSOMITTEDMARKER3391";
      const base = await seedBase({
        slug: "grep-records-omitted",
        name: "Omitted Base",
        fields: [{ slug: "notes", name: "Notes", type: "text" }],
      });
      await createBaseRecord(base.id, { notes: marker });

      const result = await client.grep({ pattern: marker, sources: ["files", "docs"] });

      expect(result.matches).toHaveLength(0);
      expect(result.coverage.records).toEqual({ scanned: 0, errored: [], notReached: 0 });
    });
  });
});
