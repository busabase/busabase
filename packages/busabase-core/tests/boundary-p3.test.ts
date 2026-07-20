import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { seedScenario } from "../src/logic/store";
import { busabaseRouter } from "../src/router";

/**
 * Boundary P3 fixes — 8 further edge-case boundaries across the base/CR lifecycle.
 * Runs against a real PGLite database seeded from the apps/busabase migrations.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("Boundary P3 — oRPC", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-p3-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-p3-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    await seedScenario({ folders: DEMO_FOLDERS, bases: DEMO_BASES });
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) {
      process.chdir(originalCwd);
    }
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
    }
    if (storageDir) {
      await rm(storageDir, { recursive: true, force: true });
    }
  });

  const approveAndMerge = async (changeRequestId: string) => {
    await client.changeRequests.review({ changeRequestId, verdict: "approved" });
    return client.changeRequests.merge({ changeRequestId });
  };

  const makeBase = async (
    slug: string,
    fields: Array<{
      slug: string;
      name: string;
      type?: "text" | "number" | "select" | "relation" | "auto_number";
      required?: boolean;
      options?: Record<string, unknown>;
    }>,
  ) => {
    const base = await client.bases.create({
      slug,
      name: slug,
      fields: fields.map((f) => ({
        slug: f.slug,
        name: f.name,
        type: f.type ?? "text",
        required: f.required ?? false,
        options: f.options,
      })),
      autoMerge: true,
    });
    if ("status" in base) throw new Error("Expected materialized BaseVO");
    return base;
  };

  const createRecord = async (baseId: string, fields: Record<string, unknown>) => {
    const cr = await client.bases.createChangeRequest({
      baseId,
      fields,
      message: "Create",
      submittedBy: "agent",
    });
    const merged = await approveAndMerge(cr.id);
    if (!merged.record) throw new Error("expected a created record");
    return merged.record.id;
  };

  // ── Fix 1: createBase persists spaceId ──────────────────────────────────────
  it("Fix 1: createBase writes spaceId onto the base + field rows", async () => {
    const base = await makeBase("p3-spaceid", [{ slug: "title", name: "Title", required: true }]);

    const { getDb } = await import("../src/db");
    const { eq } = await import("drizzle-orm");
    const { busabaseBases, busabaseBaseFields } = await import("../src/db/schema");
    const db = await getDb();

    const [baseRow] = await db
      .select()
      .from(busabaseBases)
      .where(eq(busabaseBases.id, base.id))
      .limit(1);
    expect(baseRow?.spaceId).toBeTruthy();

    const fieldRows = await db
      .select()
      .from(busabaseBaseFields)
      .where(eq(busabaseBaseFields.baseId, base.id));
    expect(fieldRows.length).toBeGreaterThan(0);
    for (const f of fieldRows) {
      expect(f.spaceId).toBeTruthy();
    }
  });

  // ── Fix 2: removing a select choice in use is blocked ───────────────────────
  it("Fix 2: removing a select choice still referenced by records is rejected", async () => {
    const base = await makeBase("p3-choice", [
      { slug: "title", name: "Title", required: true },
      {
        slug: "status",
        name: "Status",
        type: "select",
        options: {
          choices: [
            { id: "ch_open", name: "Open" },
            { id: "ch_done", name: "Done" },
          ],
        },
      },
    ]);
    const statusField = base.fields.find((f) => f.slug === "status");
    if (!statusField) throw new Error("status field missing");

    const recordId = await createRecord(base.id, { title: "t", status: "ch_open" });

    const cr = await client.bases.updateFieldChangeRequest({
      baseId: base.id,
      fieldId: statusField.id,
      patch: { options: { choices: [{ id: "ch_done", name: "Done" }] } },
    });
    await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
    await expect(client.changeRequests.merge({ changeRequestId: cr.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    await client.changeRequests.merge({ changeRequestId: cr.id }).catch((err) => {
      expect(JSON.stringify(err.data ?? {})).toContain(recordId);
    });
  });

  // ── Fix 3: merge re-validates required against current schema ───────────────
  it("Fix 3: record-create merge is rejected when a now-required field has no value", async () => {
    const base = await makeBase("p3-revalidate", [
      { slug: "title", name: "Title", required: true },
      { slug: "note", name: "Note" },
    ]);
    const noteField = base.fields.find((f) => f.slug === "note");
    if (!noteField) throw new Error("note field missing");

    // Create a record CR with note empty (allowed while note is optional).
    const recCr = await client.bases.createChangeRequest({
      baseId: base.id,
      fields: { title: "has title" },
      message: "Create",
      submittedBy: "agent",
    });

    // Make note required first (separate CR, approved + merged).
    const reqCr = await client.bases.updateFieldChangeRequest({
      baseId: base.id,
      fieldId: noteField.id,
      patch: { required: true },
    });
    await approveAndMerge(reqCr.id);

    // Now merging the record CR must fail — note is required but absent.
    await client.changeRequests.review({ changeRequestId: recCr.id, verdict: "approved" });
    await expect(client.changeRequests.merge({ changeRequestId: recCr.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
  });

  // ── Fix 4: record links cleaned when target archived ────────────────────────
  it("Fix 4: archiving a linked target record removes it from listRecordLinks", async () => {
    const baseB = await makeBase("p3-link-target", [
      { slug: "title", name: "Title", required: true },
    ]);
    const baseA = await makeBase("p3-link-source", [
      { slug: "title", name: "Title", required: true },
      {
        slug: "link",
        name: "Link",
        type: "relation",
        options: { targetBaseId: baseB.id },
      },
    ]);

    const targetRecordId = await createRecord(baseB.id, { title: "target" });
    const sourceRecordId = await createRecord(baseA.id, {
      title: "src",
      link: [targetRecordId],
    });

    const { listRecordLinks } = await import("../src/domains/base/logic/queries");
    const before = await listRecordLinks(sourceRecordId);
    expect(before.length).toBe(1);

    // Archive the target record.
    const delCr = await client.records.deleteChangeRequest({ recordId: targetRecordId });
    await approveAndMerge(delCr.id);

    const after = await listRecordLinks(sourceRecordId);
    expect(after.length).toBe(0);
  });

  // ── Fix 5: hard_delete_after_retention removed from API ──────────────────────
  it("Fix 5: createDeleteChangeRequest rejects hard_delete_after_retention", async () => {
    const base = await makeBase("p3-deletemode", [
      { slug: "title", name: "Title", required: true },
    ]);
    const recordId = await createRecord(base.id, { title: "t" });

    await expect(
      client.records.deleteChangeRequest({
        recordId,
        // @ts-expect-error — value intentionally removed from the contract
        deleteMode: "hard_delete_after_retention",
      }),
    ).rejects.toBeTruthy();
  });

  // ── Fix 6: node (base) delete cascades to records ───────────────────────────
  it("Fix 6: deleting a base node archives the base + its records", async () => {
    const base = await makeBase("p3-nodedelete", [
      { slug: "title", name: "Title", required: true },
    ]);
    await createRecord(base.id, { title: "row" });

    expect((await client.bases.list()).some((b) => b.id === base.id)).toBe(true);

    const delCr = await client.nodes.createChangeRequest({
      operations: [{ kind: "delete", nodeId: base.nodeId }],
    });
    await approveAndMerge(delCr.id);

    expect((await client.bases.list()).some((b) => b.id === base.id)).toBe(false);

    const { getDb } = await import("../src/db");
    const { and, eq } = await import("drizzle-orm");
    const { busabaseRecords } = await import("../src/db/schema");
    const db = await getDb();
    const activeRecords = await db
      .select({ id: busabaseRecords.id })
      .from(busabaseRecords)
      .where(and(eq(busabaseRecords.baseId, base.id), eq(busabaseRecords.status, "active")));
    expect(activeRecords.length).toBe(0);
  });

  // ── Fix 7: View restore API ─────────────────────────────────────────────────
  it("Fix 7: a deleted view can be restored back into listViews", async () => {
    const base = await makeBase("p3-viewrestore", [
      { slug: "title", name: "Title", required: true },
    ]);
    const viewCr = await client.bases.createViewChangeRequest({
      baseId: base.id,
      slug: "p3-vr-view",
      name: "VR",
      config: { filters: [], sorts: [] },
    });
    const mergedView = await approveAndMerge(viewCr.id);
    const viewId =
      mergedView.view?.id ??
      (await client.bases.listViews({ baseId: base.id })).find((v) => v.slug === "p3-vr-view")?.id;
    if (!viewId) throw new Error("expected created view id");

    const delCr = await client.views.deleteChangeRequest({ viewId });
    await approveAndMerge(delCr.id);
    expect(
      (await client.bases.listViews({ baseId: base.id })).some((v) => v.slug === "p3-vr-view"),
    ).toBe(false);

    const restoreCr = await client.views.restoreChangeRequest({ viewId });
    await approveAndMerge(restoreCr.id);
    expect(
      (await client.bases.listViews({ baseId: base.id })).some((v) => v.slug === "p3-vr-view"),
    ).toBe(true);
  });

  // ── Fix 8: auto_number preserved across archive/restore ─────────────────────
  it("Fix 8: restoring an archived record keeps its original auto_number", async () => {
    const base = await makeBase("p3-autonumber", [
      { slug: "title", name: "Title", required: true },
      { slug: "seq", name: "Seq", type: "auto_number" },
    ]);

    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push(await createRecord(base.id, { title: `row-${i}` }));
    }

    const seqOf = async (recordId: string): Promise<number | null> => {
      const rec = await client.records.get({ recordId });
      const raw = (rec.headCommit.fields as Record<string, unknown>).seq;
      return typeof raw === "number" ? raw : raw == null ? null : Number(raw);
    };

    expect(await seqOf(ids[1])).toBe(2);

    const delCr = await client.records.deleteChangeRequest({ recordId: ids[1] });
    await approveAndMerge(delCr.id);

    const restoreCr = await client.records.restoreChangeRequest({ recordId: ids[1] });
    await approveAndMerge(restoreCr.id);

    expect(await seqOf(ids[1])).toBe(2);
  });

  // ── Fix 9: createBase slug collision with a different name is a real conflict ──
  it("Fix 9: createBase rejects a slug collision with a different name, but preserves the idempotent-retry shortcut", async () => {
    const first = await makeBase("p3-slug-collision", [{ slug: "title", name: "Title" }]);

    // Genuinely different submission colliding on slug — must NOT silently
    // return the existing base's data; must surface as a real conflict.
    await expect(
      client.bases.create({
        slug: "p3-slug-collision",
        name: "Completely Different Name",
        fields: [{ slug: "other", name: "Other", type: "text", required: false }],
        autoMerge: true,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    // Same slug + same name = legitimate idempotent retry — must still
    // succeed and return the existing base unchanged (not error).
    const retry = await client.bases.create({
      slug: "p3-slug-collision",
      name: "p3-slug-collision",
      fields: [{ slug: "title", name: "Title", type: "text", required: false }],
      autoMerge: true,
    });
    if ("status" in retry) throw new Error("Expected materialized BaseVO");
    expect(retry.id).toBe(first.id);
    expect(retry.name).toBe(first.name);
  });
});
