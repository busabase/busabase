import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { seedScenario } from "../src/logic/store";
import { busabaseRouter } from "../src/router";

/**
 * Base-domain DB lifecycle: the CRUD paths that mutate canonical tables —
 * creating Bases (tables) and fields (columns), the View change-request →
 * review → merge loop, record deletion, and the field-text projection lookup.
 *
 * These are the operations that must stay rock-solid for the database to be
 * trustworthy; they were previously exercised only indirectly. Each test runs
 * against a real PGLite database seeded from the apps/busabase migrations, so
 * the assertions cover the actual SQL writes, not mocks.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("Base-domain DB lifecycle — oRPC", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let blogBaseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-lifecycle-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-lifecycle-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    await seedScenario({ folders: DEMO_FOLDERS, bases: DEMO_BASES });
    const bases = await client.bases.list();
    blogBaseId = bases.find((base) => base.slug === "blog")?.id ?? "";
    expect(blogBaseId).not.toBe("");
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

  const createRecord = async (fields: Record<string, unknown>) => {
    const cr = await client.bases.createChangeRequest({
      baseId: blogBaseId,
      fields,
      message: "Create",
      submittedBy: "agent",
    });
    const merged = await approveAndMerge(cr.id);
    if (!merged.record) {
      throw new Error("expected a created record");
    }
    return merged.record.id;
  };

  // ── Bases (tables) ────────────────────────────────────────────────────────
  describe("bases.create", () => {
    it("creates a new Base with fields and surfaces it in bases.list", async () => {
      const created = await client.bases.create({
        slug: "lc-projects",
        name: "Projects",
        description: "Lifecycle test base",
        fields: [
          { slug: "title", name: "Title", type: "text", required: true },
          { slug: "owner", name: "Owner", type: "text" },
        ],
      });

      expect(created.slug).toBe("lc-projects");
      expect(created.fields.map((f) => f.slug)).toEqual(["title", "owner"]);
      // Positions are assigned by insertion order.
      expect(created.fields.map((f) => f.position)).toEqual([0, 1]);

      const all = await client.bases.list();
      expect(all.some((b) => b.slug === "lc-projects")).toBe(true);
    });

    it("is idempotent on a duplicate slug (returns the existing Base)", async () => {
      const first = await client.bases.create({
        slug: "lc-dup",
        name: "Dup One",
        fields: [{ slug: "title", name: "Title", type: "text" }],
      });
      const second = await client.bases.create({
        slug: "lc-dup",
        name: "Dup Two — should be ignored",
        fields: [{ slug: "other", name: "Other", type: "text" }],
      });

      expect(second.id).toBe(first.id);
      expect(second.name).toBe("Dup One");
      expect(second.fields.map((f) => f.slug)).toEqual(["title"]);
    });

    it("rejects an unknown parent node id", async () => {
      await expect(
        client.bases.create({
          parentNodeId: "pnd_does_not_exist",
          slug: "lc-orphan",
          name: "Orphan",
          fields: [{ slug: "title", name: "Title", type: "text" }],
        }),
      ).rejects.toThrow(/Parent folder not found/);
    });
  });

  // ── Fields (columns) ──────────────────────────────────────────────────────
  describe("bases.createField", () => {
    it("appends a field at the next position", async () => {
      const base = await client.bases.create({
        slug: "lc-fields",
        name: "Fields",
        fields: [{ slug: "title", name: "Title", type: "text", required: true }],
      });
      const updated = await client.bases.createField({
        baseId: base.id,
        slug: "status",
        name: "Status",
        type: "text",
      });

      const status = updated.fields.find((f) => f.slug === "status");
      expect(status).toBeDefined();
      expect(status?.position).toBe(1);
    });

    it("rejects a duplicate field slug", async () => {
      await expect(
        client.bases.createField({
          baseId: blogBaseId,
          slug: "title",
          name: "Title Again",
          type: "text",
        }),
      ).rejects.toThrow(/Field already exists/);
    });

    it("rejects a relation field with no target Base", async () => {
      await expect(
        client.bases.createField({
          baseId: blogBaseId,
          slug: "lc-rel",
          name: "Related",
          type: "relation",
        }),
      ).rejects.toThrow(/Relation field requires a target Base/);
    });

    it("rejects an unknown Base", async () => {
      await expect(
        client.bases.createField({
          baseId: "qbs_missing",
          slug: "x",
          name: "X",
          type: "text",
        }),
      ).rejects.toThrow(/Base not found/);
    });
  });

  // ── Views: create → review → merge → update → delete ──────────────────────
  describe("view change-request lifecycle", () => {
    const activeSlugs = async (baseId: string) =>
      (await client.bases.listViews({ baseId })).map((v) => v.slug);

    it("creates, updates, and deletes a View through merged change requests", async () => {
      // Create.
      const createCr = await client.bases.createViewChangeRequest({
        baseId: blogBaseId,
        slug: "lc-view",
        name: "Lifecycle View",
      });
      await approveAndMerge(createCr.id);

      let views = await client.bases.listViews({ baseId: blogBaseId });
      const created = views.find((v) => v.slug === "lc-view");
      expect(created).toBeDefined();
      expect(created?.name).toBe("Lifecycle View");
      const viewId = created?.id ?? "";

      // Update the name.
      const updateCr = await client.views.updateChangeRequest({
        viewId,
        name: "Renamed View",
      });
      await approveAndMerge(updateCr.id);
      views = await client.bases.listViews({ baseId: blogBaseId });
      expect(views.find((v) => v.id === viewId)?.name).toBe("Renamed View");

      // Delete (archive) — drops out of the active list.
      const deleteCr = await client.views.deleteChangeRequest({ viewId });
      await approveAndMerge(deleteCr.id);
      expect(await activeSlugs(blogBaseId)).not.toContain("lc-view");
    });

    it("rejects a duplicate view slug", async () => {
      const cr = await client.bases.createViewChangeRequest({
        baseId: blogBaseId,
        slug: "lc-view-dup",
        name: "Dup",
      });
      await approveAndMerge(cr.id);
      await expect(
        client.bases.createViewChangeRequest({
          baseId: blogBaseId,
          slug: "lc-view-dup",
          name: "Dup Again",
        }),
      ).rejects.toThrow(/View slug already exists/);
    });

    it("rejects update/delete of an unknown View", async () => {
      await expect(
        client.views.updateChangeRequest({ viewId: "qvw_missing", name: "x" }),
      ).rejects.toThrow(/View not found/);
      await expect(client.views.deleteChangeRequest({ viewId: "qvw_missing" })).rejects.toThrow(
        /View not found/,
      );
    });
  });

  // ── Records: delete + projection lookup ───────────────────────────────────
  describe("record deletion and field-text lookup", () => {
    it("archives a record so it leaves the active list", async () => {
      const recordId = await createRecord({
        title: "To Be Deleted",
        body: "body",
        channel: "blog",
      });

      const beforeIds = (await client.records.list()).map((r) => r.id);
      expect(beforeIds).toContain(recordId);

      const deleteCr = await client.records.deleteChangeRequest({
        recordId,
        message: "Remove",
      });
      await approveAndMerge(deleteCr.id);

      const afterIds = (await client.records.list()).map((r) => r.id);
      expect(afterIds).not.toContain(recordId);
    });

    it("refuses to delete an already-archived record", async () => {
      const recordId = await createRecord({ title: "Twice", body: "b", channel: "blog" });
      const cr = await client.records.deleteChangeRequest({ recordId });
      await approveAndMerge(cr.id);

      await expect(client.records.deleteChangeRequest({ recordId })).rejects.toThrow(
        /already archived/,
      );
    });

    it("refuses to delete an unknown record", async () => {
      await expect(client.records.deleteChangeRequest({ recordId: "qrc_missing" })).rejects.toThrow(
        /Record not found/,
      );
    });

    it("finds records by exact field text and filters by Base", async () => {
      const uniqueTitle = "Lifecycle Lookup Marker 4821";
      const recordId = await createRecord({
        title: uniqueTitle,
        body: "body",
        channel: "blog",
      });

      const hits = await client.records.search({
        baseId: blogBaseId,
        fieldSlug: "title",
        valueText: uniqueTitle,
      });
      expect(hits.map((r) => r.id)).toContain(recordId);

      // No matching value → empty result, not an error.
      const misses = await client.records.search({
        fieldSlug: "title",
        valueText: "definitely-not-present-9999",
      });
      expect(misses).toEqual([]);
    });

    it("throws when getting a non-existent record", async () => {
      await expect(client.records.get({ recordId: "qrc_nope" })).rejects.toThrow(
        /Record not found/,
      );
    });
  });
});
