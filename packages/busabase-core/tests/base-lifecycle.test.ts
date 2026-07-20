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
        autoMerge: true,
      });
      if ("status" in created) throw new Error("Expected materialized BaseVO");

      expect(created.slug).toBe("lc-projects");
      expect(created.fields.map((f) => f.slug)).toEqual(["title", "owner"]);
      // Positions are assigned by insertion order.
      expect(created.fields.map((f) => f.position)).toEqual([0, 1]);

      const all = await client.bases.list();
      expect(all.some((b) => b.slug === "lc-projects")).toBe(true);
    });

    it("is idempotent on a duplicate slug + matching name (returns the existing Base)", async () => {
      const first = await client.bases.create({
        slug: "lc-dup",
        name: "Dup One",
        fields: [{ slug: "title", name: "Title", type: "text" }],
        autoMerge: true,
      });
      if ("status" in first) throw new Error("Expected materialized BaseVO");
      // Same slug + same name = legitimate idempotent retry (e.g. a seed/
      // migration script safely re-running bases.create) — still succeeds and
      // returns the ORIGINAL base's fields untouched, ignoring the resubmitted
      // `fields`.
      const second = await client.bases.create({
        slug: "lc-dup",
        name: "Dup One",
        fields: [{ slug: "other", name: "Other", type: "text" }],
        autoMerge: true,
      });
      if ("status" in second) throw new Error("Expected materialized BaseVO");

      expect(second.id).toBe(first.id);
      expect(second.name).toBe("Dup One");
      expect(second.fields.map((f) => f.slug)).toEqual(["title"]);
    });

    it("rejects a duplicate slug with a DIFFERENT name as a conflict, instead of silently discarding it", async () => {
      const first = await client.bases.create({
        slug: "lc-dup-conflict",
        name: "Dup One",
        fields: [{ slug: "title", name: "Title", type: "text" }],
        autoMerge: true,
      });
      if ("status" in first) throw new Error("Expected materialized BaseVO");

      // A genuinely different submission colliding on slug is a real
      // conflict — it must NOT silently return the existing base's data.
      await expect(
        client.bases.create({
          slug: "lc-dup-conflict",
          name: "Dup Two — a different Base",
          fields: [{ slug: "other", name: "Other", type: "text" }],
          autoMerge: true,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it("rejects an unknown parent node id", async () => {
      await expect(
        client.bases.create({
          parentNodeId: "pnd_does_not_exist",
          slug: "lc-orphan",
          name: "Orphan",
          fields: [{ slug: "title", name: "Title", type: "text" }],
        }),
      ).rejects.toThrow(/Parent node not found/);
    });
  });

  // ── Fields (columns) ──────────────────────────────────────────────────────
  describe("bases.createField", () => {
    it("appends a field at the next position", async () => {
      const base = await client.bases.create({
        slug: "lc-fields",
        name: "Fields",
        fields: [{ slug: "title", name: "Title", type: "text", required: true }],
        autoMerge: true,
      });
      if ("status" in base) throw new Error("Expected materialized BaseVO");
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

    it("round-trips a gallery view type and its cover config through merge", async () => {
      const createCr = await client.bases.createViewChangeRequest({
        baseId: blogBaseId,
        slug: "lc-gallery",
        name: "Gallery",
        type: "gallery",
        config: {
          filters: [],
          sorts: [],
          coverFieldSlug: "cover",
          coverFit: "fit",
          cardSize: "large",
          showFieldLabels: true,
        },
      });
      await approveAndMerge(createCr.id);

      const views = await client.bases.listViews({ baseId: blogBaseId });
      const gallery = views.find((v) => v.slug === "lc-gallery");
      expect(gallery?.type).toBe("gallery");
      expect(gallery?.config.coverFieldSlug).toBe("cover");
      expect(gallery?.config.coverFit).toBe("fit");
      expect(gallery?.config.cardSize).toBe("large");
      expect(gallery?.config.showFieldLabels).toBe(true);

      // Switching a gallery back to a table via update persists the new type.
      const updateCr = await client.views.updateChangeRequest({
        viewId: gallery?.id ?? "",
        type: "table",
      });
      await approveAndMerge(updateCr.id);
      const afterUpdate = await client.bases.listViews({ baseId: blogBaseId });
      expect(afterUpdate.find((v) => v.slug === "lc-gallery")?.type).toBe("table");
    });

    it("round-trips kanban and calendar view config through merge", async () => {
      const kanbanCr = await client.bases.createViewChangeRequest({
        baseId: blogBaseId,
        slug: "lc-kanban",
        name: "Board",
        type: "kanban",
        config: { filters: [], sorts: [], stackByFieldSlug: "status" },
      });
      await approveAndMerge(kanbanCr.id);

      const calendarCr = await client.bases.createViewChangeRequest({
        baseId: blogBaseId,
        slug: "lc-calendar",
        name: "Calendar",
        type: "calendar",
        config: { filters: [], sorts: [], dateFieldSlug: "published_at" },
      });
      await approveAndMerge(calendarCr.id);

      const views = await client.bases.listViews({ baseId: blogBaseId });
      const kanban = views.find((v) => v.slug === "lc-kanban");
      const calendar = views.find((v) => v.slug === "lc-calendar");
      expect(kanban?.type).toBe("kanban");
      expect(kanban?.config.stackByFieldSlug).toBe("status");
      expect(calendar?.type).toBe("calendar");
      expect(calendar?.config.dateFieldSlug).toBe("published_at");
    });

    it("round-trips gantt view config through merge", async () => {
      const cr = await client.bases.createViewChangeRequest({
        baseId: blogBaseId,
        slug: "lc-gantt",
        name: "Timeline",
        type: "gantt",
        config: {
          filters: [],
          sorts: [],
          startFieldSlug: "start_at",
          endFieldSlug: "end_at",
          ganttScale: "week",
        },
      });
      await approveAndMerge(cr.id);
      const gantt = (await client.bases.listViews({ baseId: blogBaseId })).find(
        (v) => v.slug === "lc-gantt",
      );
      expect(gantt?.type).toBe("gantt");
      expect(gantt?.config.startFieldSlug).toBe("start_at");
      expect(gantt?.config.endFieldSlug).toBe("end_at");
      expect(gantt?.config.ganttScale).toBe("week");
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

    // TOCTOU race: two CRs proposed before either merges, both targeting the
    // same slug on the same Base. createViewChangeRequest's propose-time check
    // only sees views that exist at proposal time, so neither sees the other —
    // both reach merge, and mergeViewCreate must catch the second one with a
    // clean CONFLICT instead of an unclassified unique-constraint 500.
    it("returns a CONFLICT (not a crash) when two view_create CRs race on the same slug", async () => {
      const crA = await client.bases.createViewChangeRequest({
        baseId: blogBaseId,
        slug: "lc-view-race",
        name: "Race A",
      });
      const crB = await client.bases.createViewChangeRequest({
        baseId: blogBaseId,
        slug: "lc-view-race",
        name: "Race B",
      });

      await approveAndMerge(crA.id);
      await expect(approveAndMerge(crB.id)).rejects.toMatchObject({ code: "CONFLICT" });

      // The successful first merge is unaffected — exactly one view with this
      // slug exists, and it's Race A.
      const views = await client.bases.listViews({ baseId: blogBaseId });
      const matches = views.filter((v) => v.slug === "lc-view-race");
      expect(matches).toHaveLength(1);
      expect(matches[0]?.name).toBe("Race A");
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

    it("persists a single-field update through merge (kanban drag-to-move path)", async () => {
      const recordId = await createRecord({
        title: "Move Me",
        body: "body",
        channel: "blog",
      });
      const before = await client.records.get({ recordId });
      // Mirror submitMoveRecord: resubmit all fields with just the stack field changed.
      const moveCr = await client.records.updateChangeRequest({
        recordId,
        fields: { ...before.headCommit.fields, channel: "social" },
        message: "Move",
      });
      await approveAndMerge(moveCr.id);
      const after = await client.records.get({ recordId });
      expect(after.headCommit.fields.channel).toBe("social");
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
