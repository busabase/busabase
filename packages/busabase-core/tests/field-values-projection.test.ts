import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
// Import logic through the same entry points the router uses (store barrel /
// dynamic imports) — a direct deep import of logic modules at load time flips
// the circular-import initialization order and breaks router bindings on CI.
import { getRelationRecordIds, seedScenario } from "../src/logic/store";
import { busabaseRouter } from "../src/router";

const getDb = async () => (await import("../src/db")).getDb();
const getSchema = () => import("../src/db/schema");
const getQueries = () => import("../src/domains/base/logic/queries");

/**
 * Coverage of the field-value projection helpers that remain on the hot path:
 * the pure getRelationRecordIds extractor plus the archived/deleted listing
 * queries. (The one-time ensureProjectionBackfill / projectCommitFieldsIfMissing
 * repair sweep was removed — every write projects at write time, and the seed
 * resolves its forward-reference relation links with a targeted re-projection;
 * that seed behaviour is covered end-to-end by apps/busabase busabase-pglite.)
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("field-values projection layer", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-fv-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-fv-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    await seedScenario({ folders: DEMO_FOLDERS, bases: DEMO_BASES });

    const base = await client.bases.create({
      slug: "fv-projection",
      name: "FV Projection",
      fields: [{ slug: "title", name: "Title", type: "text", required: true }],
      autoMerge: true,
    });
    baseId = base.id;
    await client.bases.createField({
      baseId,
      slug: "ref",
      name: "Ref",
      type: "relation",
      options: { targetBaseId: baseId },
    });
  }, 120_000);

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  // ── getRelationRecordIds (pure) ─────────────────────────────────────────────

  it("getRelationRecordIds keeps non-empty string ids from arrays and scalars", () => {
    expect(getRelationRecordIds(["rec_a", "", 1, "rec_b"])).toEqual(["rec_a", "rec_b"]);
    expect(getRelationRecordIds("rec_c")).toEqual(["rec_c"]);
    expect(getRelationRecordIds("")).toEqual([]);
    expect(getRelationRecordIds({ nope: true })).toEqual([]);
  });

  it("replaces an existing relation link even when its stored field slug is stale", async () => {
    const createRecord = async (fields: Record<string, unknown>) => {
      const cr = await client.bases.createChangeRequest({
        baseId,
        fields,
        message: "Create projection test record",
        autoMerge: false,
      });
      await client.changeRequests.review({ changeRequestIds: [cr.id], verdict: "approved" });
      const [result] = (await client.changeRequests.merge({ changeRequestIds: [cr.id] })).results;
      if (!result?.ok || !result.record) throw new Error("Expected a merged record");
      return result.record;
    };

    const target = await createRecord({ title: "Target" });
    const source = await createRecord({ title: "Source", ref: target.id });
    const db = await getDb();
    const { busabaseRecordLinks } = await getSchema();
    const linkWhere = eq(busabaseRecordLinks.sourceRecordId, source.id);
    const [initialLink] = await db.select().from(busabaseRecordLinks).where(linkWhere);
    if (!initialLink) throw new Error("Expected the initial relation link");
    expect(initialLink.targetRecordId).toBe(target.id);

    await db
      .update(busabaseRecordLinks)
      .set({ fieldSlug: "ref_before_rename" })
      .where(eq(busabaseRecordLinks.id, initialLink.id));

    const { projectCommitFields } = await import("../src/logic/field-values");
    await projectCommitFields({
      baseId,
      commitId: source.headCommit.id,
      recordId: source.id,
      fields: { title: "Source", ref: target.id },
    });

    const links = await db.select().from(busabaseRecordLinks).where(linkWhere);
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ fieldSlug: "ref", targetRecordId: target.id });
  });

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

    const viewCr = await client.views.changeRequest({
      operation: "create",
      baseId,
      slug: "fv-archived-view",
      name: "FV Archived View",
      autoMerge: false, // review-first: this test approves + merges the CR by hand
    });
    await client.changeRequests.review({ changeRequestIds: [viewCr.id], verdict: "approved" });
    await client.changeRequests.merge({ changeRequestIds: [viewCr.id] });
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
});
