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
});
