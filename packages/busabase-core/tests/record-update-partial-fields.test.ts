import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { seedScenario } from "../src/logic/store";
import { busabaseRouter } from "../src/router";

/**
 * Regression tests for a data-loss bug: a record_update change request that
 * only submits a SUBSET of a record's fields (the normal, real-world usage —
 * "just rename this record" shouldn't require resending every other field)
 * used to silently WIPE every field it didn't resubmit once merged, because
 * the merge only ran a field-preserving 3-way merge when it detected the
 * record had moved since the CR's base commit. In the common no-concurrent-
 * edit case that branch was skipped entirely and the merge fell back to the
 * operation's own commit — which only ever held the fields the caller actually
 * sent — before doing a full REPLACE of the record's field-value rows.
 *
 * Fixed in packages/busabase-core/src/domains/base/logic/merge/record.ts
 * (mergeRecordUpdate): the no-divergence fallback now carries the record's
 * current full field set forward and lets the submitted delta's own keys
 * (including an explicit `null` to clear a field) override on top of it,
 * instead of using the delta alone.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("record_update — partial-field submissions preserve untouched fields", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-partial-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-partial-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    await seedScenario({ folders: DEMO_FOLDERS, bases: DEMO_BASES });

    const base = await client.bases.create({
      slug: "partial-update-test",
      name: "Partial Update Test",
      fields: [
        { slug: "title", name: "Title", type: "text" },
        { slug: "score", name: "Score", type: "number" },
        { slug: "note", name: "Note", type: "text" },
        { slug: "ghost", name: "Ghost (unknown to schema)", type: "text" },
      ],
      autoMerge: true,
    });
    if ("status" in base) throw new Error("Expected materialized BaseVO");
    baseId = base.id;
    // `ghost` is intentionally NOT part of the base's actual field list above —
    // remove it after creation so scenario 6 can submit a genuinely unknown slug.
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  const approveAndMerge = async (changeRequestId: string) => {
    await client.changeRequests.review({ changeRequestId, verdict: "approved" });
    return client.changeRequests.merge({ changeRequestId });
  };

  const createRecord = async (fields: Record<string, unknown>) => {
    const cr = await client.bases.createChangeRequest({
      baseId,
      fields,
      message: "Create",
      submittedBy: "agent",
      autoMerge: false,
    });
    const merged = await approveAndMerge(cr.id);
    if (!merged.record) throw new Error("expected a created record");
    return merged.record.id;
  };

  const getFields = async (recordId: string) => {
    const record = await client.records.get({ recordId });
    if (!record) throw new Error("expected record to exist");
    return record.headCommit.fields;
  };

  // ── Scenario 1: basic partial update preserves the untouched field ─────────
  it("updating only field A leaves field B's value intact", async () => {
    const recordId = await createRecord({ title: "X", score: 100 });
    expect(await getFields(recordId)).toMatchObject({ title: "X", score: 100 });

    const updateCr = await client.records.updateChangeRequest({
      recordId,
      fields: { title: "Renamed" },
    });
    await approveAndMerge(updateCr.id);

    const fields = await getFields(recordId);
    expect(fields.title).toBe("Renamed");
    expect(fields.score).toBe(100); // must NOT have disappeared
  });

  // ── Scenario 2: three sequential single-field updates all stick ────────────
  it("three sequential single-field updates each preserve everything set before them", async () => {
    const recordId = await createRecord({ title: "A0", score: 1, note: "n0" });

    const cr1 = await client.records.updateChangeRequest({ recordId, fields: { title: "A1" } });
    await approveAndMerge(cr1.id);
    expect(await getFields(recordId)).toMatchObject({ title: "A1", score: 1, note: "n0" });

    const cr2 = await client.records.updateChangeRequest({ recordId, fields: { score: 2 } });
    await approveAndMerge(cr2.id);
    expect(await getFields(recordId)).toMatchObject({ title: "A1", score: 2, note: "n0" });

    const cr3 = await client.records.updateChangeRequest({ recordId, fields: { note: "n1" } });
    await approveAndMerge(cr3.id);
    expect(await getFields(recordId)).toMatchObject({ title: "A1", score: 2, note: "n1" });
  });

  // ── Scenario 3: explicit null clears a field; omission preserves it ─────────
  it("distinguishes an explicit null (clears) from an omitted key (preserves)", async () => {
    const recordId = await createRecord({ title: "B0", score: 5, note: "keep-me" });

    // Submit fieldB (score) as explicit null → must become null.
    const clearCr = await client.records.updateChangeRequest({
      recordId,
      fields: { title: "B1", score: null },
    });
    await approveAndMerge(clearCr.id);
    const afterClear = await getFields(recordId);
    expect(afterClear.title).toBe("B1");
    expect(afterClear.score).toBeNull();
    expect(afterClear.note).toBe("keep-me"); // untouched, omitted

    // A later update that omits score entirely must NOT resurrect or further
    // touch it — it stays null (still present as a key, still cleared).
    const omitCr = await client.records.updateChangeRequest({
      recordId,
      fields: { note: "still-here" },
    });
    await approveAndMerge(omitCr.id);
    const afterOmit = await getFields(recordId);
    expect(afterOmit.title).toBe("B1");
    expect(afterOmit.score).toBeNull();
    expect(afterOmit.note).toBe("still-here");
  });

  // ── Scenario 4: same-field concurrent edits still correctly CONFLICT ───────
  it("still reports CONFLICT when two change requests edit the SAME field concurrently", async () => {
    const recordId = await createRecord({ title: "C0", score: 10 });

    const crOne = await client.records.updateChangeRequest({
      recordId,
      fields: { title: "C-one" },
    });
    const crTwo = await client.records.updateChangeRequest({
      recordId,
      fields: { title: "C-two" },
    });

    await approveAndMerge(crOne.id);
    expect((await getFields(recordId)).title).toBe("C-one");

    await client.changeRequests.review({ changeRequestId: crTwo.id, verdict: "approved" });
    await expect(client.changeRequests.merge({ changeRequestId: crTwo.id })).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining("title"),
    });
    // The conflicting merge must not have applied — field stays at CR one's value.
    expect((await getFields(recordId)).title).toBe("C-one");
  });

  // ── Scenario 5: non-overlapping concurrent partial updates both merge clean ─
  it("merges two non-overlapping single-field concurrent updates without conflict, preserving other fields", async () => {
    const recordId = await createRecord({ title: "D0", score: 20, note: "orig-note" });

    // Both proposed against the same original head, before either merges.
    const crA = await client.records.updateChangeRequest({ recordId, fields: { title: "D-new" } });
    const crB = await client.records.updateChangeRequest({ recordId, fields: { score: 99 } });

    await approveAndMerge(crA.id);
    // crB is now stale (record moved), but touches a disjoint field → clean auto-merge, no conflict.
    await client.changeRequests.review({ changeRequestId: crB.id, verdict: "approved" });
    const mergedB = await client.changeRequests.merge({ changeRequestId: crB.id });
    expect(mergedB.record?.headCommit.fields).toMatchObject({
      title: "D-new",
      score: 99,
      note: "orig-note",
    });

    const fields = await getFields(recordId);
    expect(fields).toMatchObject({ title: "D-new", score: 99, note: "orig-note" });
  });

  // ── Scenario 6: unknown ("ghost") field slugs alongside real ones ───────────
  // validateRecordFields / the field-values projection both ignore/drop slugs
  // that aren't defined on the base (see field-rules.ts's "Unknown field slugs
  // are ignored (the projection layer drops them)" and PR #5475) — an unknown
  // slug must not block the merge, and it must not be searchable via the
  // field-value index. This regression is specifically about the REAL,
  // untouched fields surviving alongside it.
  it("accepts an unknown field slug without blocking the real update, and preserves untouched fields", async () => {
    const recordId = await createRecord({ title: "E0", score: 30, note: "e-note" });

    const cr = await client.records.updateChangeRequest({
      recordId,
      // `ghostField` isn't a defined slug on this base at all.
      fields: { title: "E1", ghostField: "should not break anything" },
    });
    await approveAndMerge(cr.id);

    const fields = await getFields(recordId);
    expect(fields.title).toBe("E1");
    expect(fields.score).toBe(30); // untouched field preserved
    expect(fields.note).toBe("e-note"); // untouched field preserved

    // The unknown slug is dropped from the searchable field-value projection
    // (existing behavior, unrelated to this fix) — it must not be findable.
    const byGhost = await client.records.search({
      baseId,
      fieldSlug: "ghostField",
      valueText: "should not break anything",
    });
    expect(byGhost.map((r) => r.id)).not.toContain(recordId);
  });

  // ── reviseOperation shares the same merge path — must be covered too ────────
  it("reviseOperation on a pending CR with a partial field set also preserves untouched fields", async () => {
    const recordId = await createRecord({ title: "F0", score: 40, note: "f-note" });

    const cr = await client.records.updateChangeRequest({ recordId, fields: { title: "F-draft" } });
    const operationId = cr.primaryOperation?.id ?? "";
    expect(operationId).not.toBe("");

    await client.changeRequests.review({
      changeRequestId: cr.id,
      verdict: "rejected",
      reason: "needs a different title",
    });

    const revised = await client.operations.revise({
      operationId,
      fields: { title: "F-final" },
    });
    expect(revised.status).toBe("in_review");

    await approveAndMerge(cr.id);
    const fields = await getFields(recordId);
    expect(fields.title).toBe("F-final");
    expect(fields.score).toBe(40); // must still be there after a revise + merge
    expect(fields.note).toBe("f-note");
  });
});
