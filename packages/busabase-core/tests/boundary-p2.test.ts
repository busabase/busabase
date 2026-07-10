import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { seedScenario } from "../src/logic/store";
import { busabaseRouter } from "../src/router";

/**
 * Boundary P2 fixes — 8 edge-case boundaries across the base/CR lifecycle.
 * Runs against a real PGLite database seeded from the apps/busabase migrations.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("Boundary P2 — oRPC", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-p2-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-p2-storage-"));
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
    fields: Array<{ slug: string; name: string; type?: "text" | "number"; required?: boolean }>,
  ) => {
    const base = await client.bases.create({
      slug,
      name: slug,
      fields: fields.map((f) => ({
        slug: f.slug,
        name: f.name,
        type: f.type ?? "text",
        required: f.required ?? false,
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

  // ── Fix 1: Base Restore ─────────────────────────────────────────────────────
  it("Fix 1: archives a base then restores it back into bases.list", async () => {
    const base = await makeBase("p2-restore", [{ slug: "title", name: "Title", required: true }]);

    const archiveCr = await client.bases.archiveChangeRequest({ baseId: base.id });
    await approveAndMerge(archiveCr.id);
    expect((await client.bases.list()).some((b) => b.id === base.id)).toBe(false);

    const restoreCr = await client.bases.restoreChangeRequest({ baseId: base.id });
    await approveAndMerge(restoreCr.id);
    expect((await client.bases.list()).some((b) => b.id === base.id)).toBe(true);
  });

  // ── Fix 2: Required Field Addition Validation ───────────────────────────────
  it("Fix 2: rejects making a field required when active records have empty values", async () => {
    const base = await makeBase("p2-required", [
      { slug: "title", name: "Title", required: true },
      { slug: "note", name: "Note" },
    ]);
    const recordId = await createRecord(base.id, { title: "has title" }); // note empty
    const noteField = base.fields.find((f) => f.slug === "note");
    if (!noteField) throw new Error("note field missing");

    const cr = await client.bases.updateFieldChangeRequest({
      baseId: base.id,
      fieldId: noteField.id,
      patch: { required: true },
    });
    await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
    await expect(client.changeRequests.merge({ changeRequestId: cr.id })).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    // recordId is surfaced in the error data
    await client.changeRequests.merge({ changeRequestId: cr.id }).catch((err) => {
      expect(JSON.stringify(err.data ?? {})).toContain(recordId);
    });
  });

  // ── Fix 3: Concurrent CR Conflict = explicit CONFLICT ───────────────────────
  it("Fix 3: two CRs editing the same field on the same record conflict on the second merge", async () => {
    const base = await makeBase("p2-conflict", [
      { slug: "title", name: "Title", required: true },
      { slug: "status", name: "Status" },
    ]);
    const recordId = await createRecord(base.id, { title: "t", status: "open" });

    const crA = await client.records.updateChangeRequest({
      recordId,
      fields: { title: "t", status: "A" },
    });
    const crB = await client.records.updateChangeRequest({
      recordId,
      fields: { title: "t", status: "B" },
    });

    await approveAndMerge(crA.id);
    await client.changeRequests.review({ changeRequestId: crB.id, verdict: "approved" });
    await expect(client.changeRequests.merge({ changeRequestId: crB.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  // ── Fix 4: Relation Target Archived ─────────────────────────────────────────
  it("Fix 4: rejects creating a relation value pointing at an archived base", async () => {
    const baseB = await makeBase("p2-rel-target", [
      { slug: "title", name: "Title", required: true },
    ]);
    const baseA = await client.bases.create({
      slug: "p2-rel-source",
      name: "source",
      fields: [
        { slug: "title", name: "Title", type: "text", required: true },
        {
          slug: "link",
          name: "Link",
          type: "relation",
          options: { targetBaseId: baseB.id },
        },
      ],
      autoMerge: true,
    });
    if ("status" in baseA) throw new Error("Expected materialized BaseVO");
    const targetRecordId = await createRecord(baseB.id, { title: "target" });

    const archiveCr = await client.bases.archiveChangeRequest({ baseId: baseB.id });
    await approveAndMerge(archiveCr.id);

    await expect(
      client.bases.createChangeRequest({
        baseId: baseA.id,
        fields: { title: "src", link: [targetRecordId] },
        message: "rel",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  // ── Fix 5: Soft-Delete Field Values on Field Delete ─────────────────────────
  it("Fix 5: deleting a field makes its values un-searchable", async () => {
    const base = await makeBase("p2-softdelete", [
      { slug: "title", name: "Title", required: true },
      { slug: "tag", name: "Tag" },
    ]);
    const marker = "softdelete-marker-7731";
    await createRecord(base.id, { title: "t", tag: marker });

    const before = await client.records.search({
      baseId: base.id,
      fieldSlug: "tag",
      valueText: marker,
    });
    expect(before.length).toBe(1);

    const tagField = base.fields.find((f) => f.slug === "tag");
    if (!tagField) throw new Error("tag field missing");
    const delCr = await client.bases.deleteFieldChangeRequest({
      baseId: base.id,
      fieldId: tagField.id,
    });
    await approveAndMerge(delCr.id);

    const after = await client.records.search({
      baseId: base.id,
      fieldSlug: "tag",
      valueText: marker,
    });
    expect(after.length).toBe(0);
  });

  // ── Fix 6: View Filter migration to fieldId ─────────────────────────────────
  it("Fix 6: a view filter stores fieldId and is dropped when the field is deleted (slug reuse safe)", async () => {
    const base = await makeBase("p2-viewfilter", [
      { slug: "title", name: "Title", required: true },
      { slug: "color", name: "Color" },
    ]);
    const colorField = base.fields.find((f) => f.slug === "color");
    if (!colorField) throw new Error("color field missing");

    const viewCr = await client.bases.createViewChangeRequest({
      baseId: base.id,
      slug: "p2-vf-view",
      name: "VF",
      config: {
        filters: [{ fieldSlug: "color", operator: "equals", value: "red" }],
        sorts: [],
      },
    });
    await approveAndMerge(viewCr.id);

    let views = await client.bases.listViews({ baseId: base.id });
    let view = views.find((v) => v.slug === "p2-vf-view");
    expect(view?.config.filters?.[0]?.fieldId).toBe(colorField.id);

    // Delete the field → filter referencing it is removed
    const delCr = await client.bases.deleteFieldChangeRequest({
      baseId: base.id,
      fieldId: colorField.id,
    });
    await approveAndMerge(delCr.id);

    // Re-add a field with the same slug → new fieldId; old filter must be gone
    const addCr = await client.bases.createFieldChangeRequest({
      baseId: base.id,
      slug: "color",
      name: "Color2",
    });
    await approveAndMerge(addCr.id);

    views = await client.bases.listViews({ baseId: base.id });
    view = views.find((v) => v.slug === "p2-vf-view");
    expect(view?.config.filters?.length ?? 0).toBe(0);
  });

  // ── Fix 7: CR timeout on concurrent convert lock ────────────────────────────
  it("Fix 7: a stale (>7d) in-review convert CR is auto-closed so a new one can be created", async () => {
    const base = await makeBase("p2-convertlock", [
      { slug: "title", name: "Title", required: true },
      { slug: "amount", name: "Amount" },
    ]);
    const amountField = base.fields.find((f) => f.slug === "amount");
    if (!amountField) throw new Error("amount field missing");

    const first = await client.bases.convertFieldChangeRequest({
      baseId: base.id,
      fieldId: amountField.id,
      newType: "number",
    });

    // A second immediate attempt is rejected (active lock).
    await expect(
      client.bases.convertFieldChangeRequest({
        baseId: base.id,
        fieldId: amountField.id,
        newType: "number",
      }),
    ).rejects.toThrow(/already in review/i);

    // Age the first CR's commit + CR to 8 days ago.
    const { getDb } = await import("../src/db");
    const { eq } = await import("drizzle-orm");
    const { busabaseChangeRequests } = await import("../src/db/schema");
    const db = await getDb();
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await db
      .update(busabaseChangeRequests)
      .set({ createdAt: eightDaysAgo })
      .where(eq(busabaseChangeRequests.id, first.id));

    // Now a new convert CR succeeds (stale one auto-closed).
    const second = await client.bases.convertFieldChangeRequest({
      baseId: base.id,
      fieldId: amountField.id,
      newType: "number",
    });
    expect(second.id).not.toBe(first.id);

    const stale = await client.changeRequests.get({ changeRequestId: first.id });
    expect(stale?.status).toBe("rejected");
  });

  // ── Fix 8: Record pagination with cursor ────────────────────────────────────
  it("Fix 8: pages through records using nextCursor", async () => {
    const base = await makeBase("p2-pagination", [
      { slug: "title", name: "Title", required: true },
    ]);
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(await createRecord(base.id, { title: `row-${i}` }));
    }

    const seen = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    for (;;) {
      const page = await client.records.listPaged({ baseId: base.id, limit: 2, cursor });
      for (const r of page.records) seen.add(r.id);
      pages++;
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
      if (pages > 10) throw new Error("pagination did not terminate");
    }
    // All 5 of our records were paged through.
    for (const id of ids) expect(seen.has(id)).toBe(true);
    expect(pages).toBeGreaterThanOrEqual(3);
  });
});
