import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
// Import logic through the same entry points the router uses (store barrel /
// dynamic imports) — a direct deep import of logic modules at load time flips
// the circular-import initialization order and breaks router bindings on CI.
import {
  ensureProjectionBackfill,
  getRelationRecordIds,
  projectCommitFieldsIfMissing,
  seedScenario,
} from "../src/logic/store";
import { busabaseRouter } from "../src/router";

const getDb = async () => (await import("../src/db")).getDb();
const getSchema = () => import("../src/db/schema");
const getQueries = () => import("../src/domains/base/logic/queries");

/**
 * Direct coverage of the field-value projection layer (src/logic/field-values.ts):
 * projectCommitFieldsIfMissing's early-return branches and the
 * ensureProjectionBackfill sweep that repairs missing projections.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("field-values projection layer", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";
  let plainRecordId = "";
  let plainHeadCommitId = "";
  let linkedRecordId = "";
  let linkedHeadCommitId = "";
  let targetRecordId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-fv-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-fv-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    await seedScenario({ folders: DEMO_FOLDERS, bases: DEMO_BASES });

    const approveAndMerge = (changeRequestId: string) =>
      client.changeRequests
        .review({ changeRequestId, verdict: "approved" })
        .then(() => client.changeRequests.merge({ changeRequestId }));

    const base = await client.bases.create({
      slug: "fv-projection",
      name: "FV Projection",
      fields: [{ slug: "title", name: "Title", type: "text", required: true }],
    });
    baseId = base.id;
    await client.bases.createField({
      baseId,
      slug: "ref",
      name: "Ref",
      type: "relation",
      options: { targetBaseId: baseId },
    });

    const targetCr = await client.bases.createChangeRequest({ baseId, fields: { title: "T" } });
    targetRecordId = (await approveAndMerge(targetCr.id)).record!.id;

    const plainCr = await client.bases.createChangeRequest({ baseId, fields: { title: "P" } });
    plainRecordId = (await approveAndMerge(plainCr.id)).record!.id;
    plainHeadCommitId = (await client.records.get({ recordId: plainRecordId }))!.headCommit.id;

    const linkedCr = await client.bases.createChangeRequest({
      baseId,
      fields: { title: "L", ref: [targetRecordId] },
    });
    linkedRecordId = (await approveAndMerge(linkedCr.id)).record!.id;
    linkedHeadCommitId = (await client.records.get({ recordId: linkedRecordId }))!.headCommit.id;
  }, 120_000);

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  const liveValueRows = async (recordId: string) => {
    const db = await getDb();
    const { busabaseFieldValues } = await getSchema();
    return db
      .select()
      .from(busabaseFieldValues)
      .where(
        and(eq(busabaseFieldValues.recordId, recordId), isNull(busabaseFieldValues.deletedAt)),
      );
  };

  // ── getRelationRecordIds (pure) ─────────────────────────────────────────────

  it("getRelationRecordIds keeps non-empty string ids from arrays and scalars", () => {
    expect(getRelationRecordIds(["rec_a", "", 1, "rec_b"])).toEqual(["rec_a", "rec_b"]);
    expect(getRelationRecordIds("rec_c")).toEqual(["rec_c"]);
    expect(getRelationRecordIds("")).toEqual([]);
    expect(getRelationRecordIds({ nope: true })).toEqual([]);
  });

  // ── projectCommitFieldsIfMissing early returns ─────────────────────────────

  it("no record/operation/change-request id → no-op", async () => {
    await expect(
      projectCommitFieldsIfMissing({ baseId, commitId: plainHeadCommitId }),
    ).resolves.toBeUndefined();
  });

  it("unknown commit id → no-op (no rows written)", async () => {
    const db = await getDb();
    const { busabaseFieldValues } = await getSchema();
    await db.delete(busabaseFieldValues).where(eq(busabaseFieldValues.recordId, plainRecordId));
    await projectCommitFieldsIfMissing({
      baseId,
      commitId: "cmt_does_not_exist",
      recordId: plainRecordId,
    });
    expect(await liveValueRows(plainRecordId)).toEqual([]);
  });

  it("missing projection + valid commit → re-projects the record's values", async () => {
    // Rows were wiped by the previous test; the backfill path must restore them.
    await projectCommitFieldsIfMissing({
      baseId,
      commitId: plainHeadCommitId,
      recordId: plainRecordId,
    });
    const rows = await liveValueRows(plainRecordId);
    expect(rows.map((row) => row.fieldSlug)).toContain("title");
  });

  it("existing projection without relation values → left untouched", async () => {
    const before = await liveValueRows(plainRecordId);
    await projectCommitFieldsIfMissing({
      baseId,
      commitId: plainHeadCommitId,
      recordId: plainRecordId,
    });
    const after = await liveValueRows(plainRecordId);
    expect(after.map((row) => row.id).sort()).toEqual(before.map((row) => row.id).sort());
  });

  it("existing projection with relation values → re-projected (links rebuilt)", async () => {
    const db = await getDb();
    const { busabaseRecordLinks } = await getSchema();
    await db
      .delete(busabaseRecordLinks)
      .where(eq(busabaseRecordLinks.sourceRecordId, linkedRecordId));
    await projectCommitFieldsIfMissing({
      baseId,
      commitId: linkedHeadCommitId,
      recordId: linkedRecordId,
    });
    const links = await db
      .select()
      .from(busabaseRecordLinks)
      .where(eq(busabaseRecordLinks.sourceRecordId, linkedRecordId));
    expect(links.map((link) => link.targetRecordId)).toContain(targetRecordId);
  });

  // ── ensureProjectionBackfill sweep ─────────────────────────────────────────

  // ── archived/deleted listing queries ───────────────────────────────────────

  it("listDeletedFields returns soft-deleted fields; unknown base → []", async () => {
    const { listDeletedFields } = await getQueries();
    expect(await listDeletedFields("bse_does_not_exist")).toEqual([]);
    expect((await listDeletedFields(baseId)).map((field) => field.slug)).toEqual([]);

    const db = await getDb();
    const { busabaseBaseFields } = await getSchema();
    await db
      .update(busabaseBaseFields)
      .set({ deletedAt: new Date() })
      .where(and(eq(busabaseBaseFields.baseId, baseId), eq(busabaseBaseFields.slug, "ref")));

    expect((await listDeletedFields(baseId)).map((field) => field.slug)).toEqual(["ref"]);

    await db
      .update(busabaseBaseFields)
      .set({ deletedAt: null })
      .where(and(eq(busabaseBaseFields.baseId, baseId), eq(busabaseBaseFields.slug, "ref")));
  });

  it("listArchivedViews returns archived views; unknown base → []", async () => {
    const { listArchivedViews } = await getQueries();
    expect(await listArchivedViews("bse_does_not_exist")).toEqual([]);
    expect(await listArchivedViews(baseId)).toEqual([]);

    const viewCr = await client.bases.createViewChangeRequest({
      baseId,
      slug: "fv-archived-view",
      name: "FV Archived View",
    });
    await client.changeRequests.review({ changeRequestId: viewCr.id, verdict: "approved" });
    await client.changeRequests.merge({ changeRequestId: viewCr.id });
    const views = await client.bases.listViews({ baseId });
    const view = views.find((item) => item.slug === "fv-archived-view");
    expect(view).toBeDefined();

    const db = await getDb();
    const { busabaseViews } = await getSchema();
    await db
      .update(busabaseViews)
      .set({ status: "archived" })
      .where(eq(busabaseViews.id, view!.id));

    expect((await listArchivedViews(baseId)).map((item) => item.id)).toEqual([view!.id]);
  });

  it("ensureProjectionBackfill repairs wiped record projections across the space", async () => {
    const db = await getDb();
    const { busabaseFieldValues } = await getSchema();
    await db.delete(busabaseFieldValues).where(eq(busabaseFieldValues.recordId, plainRecordId));
    expect(await liveValueRows(plainRecordId)).toEqual([]);

    await ensureProjectionBackfill();

    const rows = await liveValueRows(plainRecordId);
    expect(rows.map((row) => row.fieldSlug)).toContain("title");
  }, 120_000);
});
