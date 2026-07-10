import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { seedScenario } from "../src/logic/store";
import { busabaseRouter } from "../src/router";

/**
 * Regression tests for three merge/projection defects:
 *  - #1 record-level field_values are a full REPLACE on update (no stale index)
 *  - #2 base_convert_field rewrites the authoritative commit.fields, not just the index
 *  - #4 record restore only un-deletes the links its own archive soft-deleted
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("merge projection fixes", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-proj-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-proj-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    await seedScenario({ folders: DEMO_FOLDERS, bases: DEMO_BASES });
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  const approveAndMerge = (changeRequestId: string) =>
    client.changeRequests
      .review({ changeRequestId, verdict: "approved" })
      .then(() => client.changeRequests.merge({ changeRequestId }));

  // ── #1: record update fully replaces its projection ────────────────────────
  it("record search does not return stale values after an update (#1)", async () => {
    const base = await client.bases.create({
      slug: "proj-replace",
      name: "Projection Replace",
      fields: [
        { slug: "title", name: "Title", type: "text", required: true },
        { slug: "status", name: "Status", type: "text" },
      ],
      autoMerge: true,
    });
    const baseId = base.id;

    const createCr = await client.bases.createChangeRequest({
      baseId,
      fields: { title: "rec-1", status: "draft" },
    });
    const created = await approveAndMerge(createCr.id);
    const recordId = created.record!.id;

    // Initially searchable by status=draft.
    const byDraft = await client.records.search({
      baseId,
      fieldSlug: "status",
      valueText: "draft",
    });
    expect(byDraft.map((r) => r.id)).toContain(recordId);

    // Update the record: status draft → published.
    const updateCr = await client.records.updateChangeRequest({
      recordId,
      fields: { title: "rec-1", status: "published" },
    });
    await approveAndMerge(updateCr.id);

    // The stale "draft" projection must be gone…
    const staleDraft = await client.records.search({
      baseId,
      fieldSlug: "status",
      valueText: "draft",
    });
    expect(staleDraft.map((r) => r.id)).not.toContain(recordId);

    // …and the record is now found by its current value only.
    const byPublished = await client.records.search({
      baseId,
      fieldSlug: "status",
      valueText: "published",
    });
    expect(byPublished.map((r) => r.id)).toEqual([recordId]);
  });

  // ── #2: convert rewrites the authoritative commit.fields ───────────────────
  it("converting text → select migrates the record's displayed value, not just the index (#2)", async () => {
    const base = await client.bases.create({
      slug: "convert-commit",
      name: "Convert Commit",
      fields: [
        { slug: "title", name: "Title", type: "text", required: true },
        { slug: "category", name: "Category", type: "text" },
      ],
      autoMerge: true,
    });
    const baseId = base.id;
    const categoryFieldId = base.fields.find((f) => f.slug === "category")!.id;

    const createCr = await client.bases.createChangeRequest({
      baseId,
      fields: { title: "r", category: "Apple" },
    });
    const created = await approveAndMerge(createCr.id);
    const recordId = created.record!.id;

    // Convert category text → select with auto_create.
    const convertCr = await client.bases.convertFieldChangeRequest({
      baseId,
      fieldId: categoryFieldId,
      newType: "select",
      selectChoiceMode: "auto_create",
    });
    await approveAndMerge(convertCr.id);

    // A choice named "Apple" was auto-created.
    const updatedBase = (await client.bases.list()).find((b) => b.id === baseId)!;
    const categoryField = updatedBase.fields.find((f) => f.slug === "category")!;
    expect(categoryField.type).toBe("select");
    const appleChoice = categoryField.options?.choices?.find((c) => c.name === "Apple");
    expect(appleChoice).toBeDefined();
    const appleId = appleChoice!.id;

    // The authoritative record value (commit.fields) now holds the CHOICE ID,
    // not the raw "Apple" label — i.e. display == index.
    const record = await client.records.get({ recordId });
    expect(record?.headCommit.fields.category).toBe(appleId);

    // And the index agrees: searchable by the choice id, not the old label.
    const byLabel = await client.records.search({
      baseId,
      fieldSlug: "category",
      valueText: "Apple",
    });
    expect(byLabel.map((r) => r.id)).not.toContain(recordId);
    const byId = await client.records.search({ baseId, fieldSlug: "category", valueText: appleId });
    expect(byId.map((r) => r.id)).toContain(recordId);
  });

  // ── #4: record restore brings back its own inbound links ───────────────────
  it("restoring an archived record un-deletes its inbound links (#4)", async () => {
    const base = await client.bases.create({
      slug: "restore-links",
      name: "Restore Links",
      fields: [{ slug: "title", name: "Title", type: "text", required: true }],
      autoMerge: true,
    });
    const baseId = base.id;
    await client.bases.createField({
      baseId,
      slug: "ref",
      name: "Ref",
      type: "relation",
      options: { targetBaseId: baseId },
    });

    const tCr = await client.bases.createChangeRequest({ baseId, fields: { title: "T" } });
    const tId = (await approveAndMerge(tCr.id)).record!.id;

    const sCr = await client.bases.createChangeRequest({
      baseId,
      fields: { title: "S", ref: [tId] },
    });
    const sId = (await approveAndMerge(sCr.id)).record!.id;

    const linkedBefore = await client.records.listLinks({ recordId: sId });
    expect(linkedBefore.map((l) => l.targetRecordId)).toContain(tId);

    // Archive T → its inbound link from S is soft-deleted.
    const deleteCr = await client.records.deleteChangeRequest({
      recordId: tId,
      deleteMode: "archive",
    });
    await approveAndMerge(deleteCr.id);
    const linkedWhileArchived = await client.records.listLinks({ recordId: sId });
    expect(linkedWhileArchived.map((l) => l.targetRecordId)).not.toContain(tId);

    // Restore T → the link comes back.
    const restoreCr = await client.records.restoreChangeRequest({ recordId: tId });
    await approveAndMerge(restoreCr.id);
    const linkedAfter = await client.records.listLinks({ recordId: sId });
    expect(linkedAfter.map((l) => l.targetRecordId)).toContain(tId);
  });
});
