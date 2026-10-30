import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import type { ViewConfigVO, ViewType, ViewVO } from "busabase-contract/types";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { getDb, getPgliteClient } from "../src/db";
import * as schema from "../src/db/schema";
import { busabaseCommits, busabaseOperations, busabaseViews } from "../src/db/schema";
import { mergeViewUpdate } from "../src/domains/base/logic/merge/view";
import { getVisibleViewFieldSlugs } from "../src/domains/dashboard/helpers/view-config";
import {
  getViewConfigPatch,
  getViewUpdatePayload,
} from "../src/domains/dashboard/helpers/view-config-patch";
import type { MergeCtx } from "../src/logic/cr-lifecycle";
import { subscribeBusabaseLiveEvents } from "../src/logic/live-events";
import { busabaseRouter } from "../src/router";

describe("new field visibility across saved views", () => {
  const client = createRouterClient(busabaseRouter);
  let originalCwd = "";
  let dataDir = "";
  let sequence = 0;
  const makeBase = () =>
    client.bases.create({
      slug: `field-visibility-${++sequence}`,
      name: "Field visibility",
      fields: [
        { slug: "title", name: "Title", type: "text" },
        { slug: "hidden", name: "Hidden", type: "text" },
        { slug: "status", name: "Status", type: "text" },
      ],
      autoMerge: true,
    });
  const views = (baseId: string) => client.bases.listViews({ baseId });
  const makeView = async (baseId: string, type: ViewType, config?: Partial<ViewConfigVO>) => {
    const slug = `view-${++sequence}`;
    await client.views.changeRequest({
      operation: "create",
      baseId,
      slug,
      name: slug,
      type,
      config: { filters: [], sorts: [], ...config },
      autoMerge: true,
    });
    const result = (await views(baseId)).find((view) => view.slug === slug);
    if (!result) throw new Error("Expected a materialized view");
    return result;
  };
  const readView = async (baseId: string, viewId: string) => {
    const result = (await views(baseId)).find((view) => view.id === viewId);
    if (!result) throw new Error("Expected an active view");
    return result;
  };
  const visible = async (baseId: string, view: ViewVO) =>
    getVisibleViewFieldSlugs(
      (await readView(baseId, view.id)).config,
      (await client.bases.get({ baseId })).fields,
    );
  const add = (baseId: string, slug: string, originViewId?: string) =>
    client.bases.createField({ baseId, slug, name: slug, type: "attachment", originViewId });
  const approve = async (changeRequestId: string) => {
    await client.changeRequests.review({
      changeRequestIds: [changeRequestId],
      verdict: "approved",
    });
    return client.changeRequests.merge({ changeRequestIds: [changeRequestId] });
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(path.resolve(__dirname, "../../../apps/busabase"));
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-field-visibility-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
  });
  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
  });

  it("reveals an attachment in its manual origin without exposing old hidden fields or changing other manual views", async () => {
    const base = await makeBase();
    const origin = await makeView(base.id, "table", {
      visibleFieldSlugs: ["title", "status"],
      fieldOrderSlugs: ["title", "status", "hidden"],
    });
    const other = await makeView(base.id, "table", { visibleFieldSlugs: ["title"] });
    await add(base.id, "attachment", origin.id);
    expect(await visible(base.id, origin)).toEqual(["title", "status", "attachment"]);
    expect(await visible(base.id, other)).toEqual(["title"]);
    expect((await readView(base.id, origin.id)).config.fieldOrderSlugs).toEqual([
      "title",
      "status",
      "hidden",
      "attachment",
    ]);
  });

  it("follows the schema in automatic tables after reordering while preserving explicit hidden fields", async () => {
    const base = await makeBase();
    const table = await makeView(base.id, "table", {
      autoShowNewFields: true,
      hiddenFieldSlugs: ["hidden"],
      fieldOrderSlugs: ["title", "status", "hidden"],
    });
    const defaultView = (await views(base.id)).find((view) => view.slug === "grid-view");
    if (!defaultView) throw new Error("Expected the default table");
    expect(defaultView.config.autoShowNewFields).toBe(true);
    await add(base.id, "api_attachment");
    expect(await visible(base.id, table)).toEqual(["title", "status", "api_attachment"]);
    expect(await visible(base.id, defaultView)).toContain("api_attachment");
  });

  it("keeps new card views curated by default and honors their independent automatic opt-in", async () => {
    const base = await makeBase();
    const board = await makeView(base.id, "kanban");
    const gallery = await makeView(base.id, "gallery");
    const automaticGallery = await makeView(base.id, "gallery", { autoShowNewFields: true });
    expect(board.config.autoShowNewFields).toBe(false);
    expect(gallery.config.visibleFieldSlugs).toEqual(["title", "hidden", "status"]);
    await add(base.id, "api_attachment");
    expect(await visible(base.id, board)).not.toContain("api_attachment");
    expect(await visible(base.id, gallery)).not.toContain("api_attachment");
    expect(await visible(base.id, automaticGallery)).toContain("api_attachment");
    await add(base.id, "board_attachment", board.id);
    expect(await visible(base.id, board)).toContain("board_attachment");
    expect(await visible(base.id, gallery)).not.toContain("board_attachment");
  });

  it("freezes existing unconfigured cards without resetting legacy manually hidden table fields", async () => {
    const base = await makeBase();
    const board = await makeView(base.id, "kanban");
    const table = await makeView(base.id, "table");
    const db = await getDb();
    await db.update(busabaseViews).set({ config: {} }).where(eq(busabaseViews.id, board.id));
    await db
      .update(busabaseViews)
      .set({ config: { visibleFieldSlugs: ["title", "status"] } })
      .where(eq(busabaseViews.id, table.id));
    await add(base.id, "attachment");
    expect(await visible(base.id, board)).toEqual(["title", "hidden", "status"]);
    expect((await readView(base.id, board.id)).config.autoShowNewFields).toBe(false);
    expect(await visible(base.id, table)).toEqual(["title", "status"]);
  });

  it("persists origin intent during review and reveals the field only after a successful merge", async () => {
    const base = await makeBase();
    const origin = await makeView(base.id, "table", { visibleFieldSlugs: ["title"] });
    const pending = await client.bases.fieldChangeRequest({
      operation: "create",
      baseId: base.id,
      slug: "pending_attachment",
      name: "Attachment",
      type: "attachment",
      originViewId: origin.id,
      autoMerge: false,
    });
    expect(pending.status).toBe("in_review");
    expect(pending.operations[0]?.headCommit.payload.originViewId).toBe(origin.id);
    expect((await client.bases.get({ baseId: base.id })).fields).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ slug: "pending_attachment" })]),
    );
    expect(await visible(base.id, origin)).toEqual(["title"]);
    expect((await approve(pending.id)).results[0]?.ok).toBe(true);
    expect(await visible(base.id, origin)).toEqual(["title", "pending_attachment"]);
  });

  it("rejects missing and cross-Base origins without inserting a field", async () => {
    const base = await makeBase();
    const otherBase = await makeBase();
    const otherView = (await views(otherBase.id))[0];
    if (!otherView) throw new Error("Expected another Base's view");
    for (const origin of ["missing-view", otherView.id]) {
      await expect(add(base.id, "invalid_attachment", origin)).rejects.toMatchObject({
        code: "CONFLICT",
      });
    }
    expect((await client.bases.get({ baseId: base.id })).fields).toHaveLength(3);
  });

  it("rolls back the field if its source view is archived while the proposal is under review", async () => {
    const base = await makeBase();
    const source = await makeView(base.id, "table", { visibleFieldSlugs: ["title"] });
    const pending = await client.bases.fieldChangeRequest({
      operation: "create",
      baseId: base.id,
      slug: "stale_attachment",
      name: "Attachment",
      type: "attachment",
      originViewId: source.id,
      autoMerge: false,
    });
    await client.views.changeRequest({ operation: "delete", viewId: source.id, autoMerge: true });
    expect((await approve(pending.id)).results[0]).toMatchObject({ ok: false, code: "CONFLICT" });
    expect((await client.bases.get({ baseId: base.id })).fields).toHaveLength(3);
  });

  it("keeps simultaneous additions visible instead of overwriting the origin's allowlist", async () => {
    const base = await makeBase();
    const origin = await makeView(base.id, "table", { visibleFieldSlugs: ["title"] });
    await Promise.all([
      add(base.id, "attachment_a", origin.id),
      add(base.id, "attachment_b", origin.id),
    ]);
    expect(await visible(base.id, origin)).toEqual(
      expect.arrayContaining(["title", "attachment_a", "attachment_b"]),
    );
    expect(await visible(base.id, origin)).toHaveLength(3);
  });

  it("cleans deleted field references so reusing its slug does not inherit a previous field's hidden state", async () => {
    const base = await makeBase();
    const table = await makeView(base.id, "table", {
      autoShowNewFields: true,
      fieldOrderSlugs: ["title", "status", "hidden"],
      hiddenFieldSlugs: ["hidden"],
    });
    const deletedField = base.fields.find((field) => field.slug === "hidden");
    if (!deletedField) throw new Error("Expected a hidden field");
    await client.bases.fieldChangeRequest({
      operation: "delete",
      baseId: base.id,
      fieldId: deletedField.id,
      autoMerge: true,
    });
    expect((await readView(base.id, table.id)).config).toMatchObject({
      fieldOrderSlugs: ["title", "status"],
      hiddenFieldSlugs: [],
    });
    await add(base.id, "hidden");
    expect(await visible(base.id, table)).toEqual(["title", "status", "hidden"]);
  });

  it("reveals only the forward field in a paired relation's origin and leaves the target's curated layout intact", async () => {
    const base = await makeBase();
    const target = await makeBase();
    const origin = await makeView(base.id, "table", { visibleFieldSlugs: ["title"] });
    const targetView = await makeView(target.id, "table", { visibleFieldSlugs: ["title"] });
    const result = await client.bases.fieldChangeRequest({
      operation: "create",
      baseId: base.id,
      slug: "linked",
      name: "Linked",
      type: "relation",
      options: { targetBaseId: target.id },
      reverse: { name: "Sources" },
      originViewId: origin.id,
      autoMerge: true,
    });
    expect(result.status).toBe("merged");
    expect(result.operations).toHaveLength(2);
    expect(result.operations[0]?.headCommit.payload.originViewId).toBe(origin.id);
    expect(result.operations[1]?.headCommit.payload.originViewId).toBeUndefined();
    expect(await visible(base.id, origin)).toEqual(["title", "linked"]);
    expect(await visible(target.id, targetView)).toEqual(["title"]);
    expect((await client.bases.get({ baseId: target.id })).fields).toHaveLength(4);
  });

  it("snapshots current visible fields when the API disables automatic additions without sending an allowlist", async () => {
    const base = await makeBase();
    const table = (await views(base.id))[0];
    if (!table) throw new Error("Expected the default table");
    await client.views.changeRequest({
      operation: "update",
      viewId: table.id,
      config: { autoShowNewFields: false },
      autoMerge: true,
    });
    expect((await readView(base.id, table.id)).config.visibleFieldSlugs).toEqual([
      "title",
      "hidden",
      "status",
    ]);
    await add(base.id, "api_attachment");
    expect(await visible(base.id, table)).toEqual(["title", "hidden", "status"]);
  });

  it("preserves hidden fields when the API enables automatic additions and allows an explicit hidden-list override", async () => {
    const base = await makeBase();
    const table = await makeView(base.id, "table", { visibleFieldSlugs: ["title", "status"] });
    await client.views.changeRequest({
      operation: "update",
      viewId: table.id,
      config: { autoShowNewFields: true },
      autoMerge: true,
    });
    expect((await readView(base.id, table.id)).config.hiddenFieldSlugs).toEqual(["hidden"]);
    await add(base.id, "api_attachment");
    expect(await visible(base.id, table)).toEqual(["title", "status", "api_attachment"]);
    await client.views.changeRequest({
      operation: "update",
      viewId: table.id,
      config: { autoShowNewFields: true, hiddenFieldSlugs: [] },
      autoMerge: true,
    });
    expect(await visible(base.id, table)).toContain("hidden");
  });

  it("honors an older API client's explicit visible list on an automatically configured default table", async () => {
    const base = await makeBase();
    const table = (await views(base.id))[0];
    if (!table) throw new Error("Expected the default table");
    await client.views.changeRequest({
      operation: "update",
      viewId: table.id,
      config: { visibleFieldSlugs: ["title"] },
      autoMerge: true,
    });
    expect((await readView(base.id, table.id)).config.autoShowNewFields).toBe(false);
    await add(base.id, "api_attachment");
    expect(await visible(base.id, table)).toEqual(["title"]);
  });

  it("merges a pending rename without restoring the view's stale pre-addition config", async () => {
    const base = await makeBase();
    const table = await makeView(base.id, "table", { visibleFieldSlugs: ["title"] });
    const pending = await client.views.changeRequest({
      operation: "update",
      viewId: table.id,
      ...getViewUpdatePayload(table, {
        name: "Renamed",
        description: table.description,
        type: table.type,
        config: table.config,
      }),
      autoMerge: false,
    });
    if (pending.materialized) throw new Error("Expected a pending rename");
    expect(pending.operations[0]?.headCommit.payload.config).toBeUndefined();
    await add(base.id, "attachment", table.id);
    expect((await approve(pending.id)).results[0]?.ok).toBe(true);
    expect((await readView(base.id, table.id)).name).toBe("Renamed");
    expect(await visible(base.id, table)).toEqual(["title", "attachment"]);
  });

  it.each(["before proposal", "during review"])(
    "preserves a source field added %s when the UI saves only its edited width",
    async (timing) => {
      const base = await makeBase();
      const opened = await makeView(base.id, "table", { visibleFieldSlugs: ["title"] });
      if (timing === "before proposal") await add(base.id, "attachment", opened.id);
      const patch = getViewConfigPatch(opened.config, {
        ...opened.config,
        fieldWidths: { title: 280 },
      });
      expect(patch).toEqual({ fieldWidths: { title: 280 } });
      const pending = await client.views.changeRequest({
        operation: "update",
        viewId: opened.id,
        config: patch,
        autoMerge: false,
      });
      if (pending.materialized) throw new Error("Expected a review request");
      if (timing === "during review") await add(base.id, "attachment", opened.id);
      expect((await approve(pending.id)).results[0]?.ok).toBe(true);
      expect(await visible(base.id, opened)).toEqual(["title", "attachment"]);
      expect((await readView(base.id, opened.id)).config.fieldWidths).toEqual({ title: 280 });
    },
  );

  it("avoids field reads for width/name-only merges and shares one read for policy inference plus stamping", async () => {
    const base = await makeBase();
    const table = (await views(base.id))[0];
    if (!table) throw new Error("Expected the automatic default table");
    const db = await getDb();
    // Old views can still have unstamped field rules. Width/name changes must
    // leave those unrelated rules alone rather than reading fields to upgrade them.
    await db
      .update(busabaseViews)
      .set({
        config: { ...table.config, filters: [{ fieldSlug: "title", operator: "not_empty" }] },
      })
      .where(eq(busabaseViews.id, table.id));
    const queries: string[] = [];
    const observedDb = drizzle(await getPgliteClient(), {
      schema,
      logger: { logQuery: (query) => queries.push(query) },
    });
    const scenarios = [
      { input: { config: { fieldWidths: { title: 280 } } }, fieldReads: 0 },
      { input: { name: "Renamed" }, fieldReads: 0 },
      {
        input: {
          config: {
            autoShowNewFields: false,
            filters: [{ fieldSlug: "title", operator: "not_empty" as const }],
          },
        },
        fieldReads: 1,
      },
    ];
    for (const scenario of scenarios) {
      const pending = await client.views.changeRequest({
        operation: "update",
        viewId: table.id,
        ...scenario.input,
        autoMerge: false,
      });
      if (pending.materialized) throw new Error("Expected a review request");
      const operationId = pending.operations[0]?.id;
      const headId = pending.operations[0]?.headCommit.id;
      if (!operationId || !headId) throw new Error("Expected an operation and commit");
      const [operation] = await db
        .select()
        .from(busabaseOperations)
        .where(eq(busabaseOperations.id, operationId));
      const [head] = await db.select().from(busabaseCommits).where(eq(busabaseCommits.id, headId));
      if (!operation || !head) throw new Error("Expected stored operation and commit");
      queries.length = 0;
      // Exercise the actual handler against the real DB while measuring only
      // its SQL, excluding lifecycle loading/projection outside this module.
      await observedDb.transaction((tx) =>
        mergeViewUpdate(
          { db: tx, timestamp: new Date(), mergedViewIds: [] } as unknown as MergeCtx,
          operation,
          head,
        ),
      );
      expect(queries.filter((query) => /\bfrom "busabase_base_fields"/.test(query))).toHaveLength(
        scenario.fieldReads,
      );
    }
    const updated = await readView(base.id, table.id);
    expect(updated.config.visibleFieldSlugs).toEqual(["title", "hidden", "status"]);
    expect(updated.config.filters[0]).toMatchObject({
      fieldSlug: "title",
      fieldId: base.fields.find((field) => field.slug === "title")?.id,
    });
  });

  it("keeps review snapshots but only stores the supplied configuration baseline and preserves explicit clears", async () => {
    const base = await makeBase();
    const table = await makeView(base.id, "table", {
      visibleFieldSlugs: ["title"],
      fieldWidths: { title: 180 },
      coverFieldSlug: "hidden",
      filters: [{ fieldSlug: "title", operator: "not_empty" }],
    });
    const pending = await client.views.changeRequest({
      operation: "update",
      viewId: table.id,
      config: { fieldWidths: { title: 280 }, hiddenFieldSlugs: undefined },
      autoMerge: false,
    });
    if (pending.materialized) throw new Error("Expected a review request");
    expect(pending.operations[0]?.headCommit.payload).toMatchObject({
      config: { visibleFieldSlugs: ["title"], fieldWidths: { title: 280 } },
      configBase: { fieldWidths: { title: 180 } },
      configPatch: { fieldWidths: { title: 280 } },
    });
    expect(Object.keys(pending.operations[0]?.headCommit.payload.configBase ?? {})).toEqual([
      "fieldWidths",
    ]);
    expect(Object.keys(pending.operations[0]?.headCommit.payload.configPatch ?? {})).toEqual([
      "fieldWidths",
    ]);
    expect((await approve(pending.id)).results[0]?.ok).toBe(true);
    await client.views.changeRequest({
      operation: "update",
      viewId: table.id,
      config: { coverFieldSlug: null, filters: [], sorts: [] },
      autoMerge: true,
    });
    expect((await readView(base.id, table.id)).config).toMatchObject({
      coverFieldSlug: null,
      filters: [],
      sorts: [],
      visibleFieldSlugs: ["title"],
      fieldWidths: { title: 280 },
    });
  });

  it("continues to merge historical view commits without patch metadata", async () => {
    const base = await makeBase();
    const table = await makeView(base.id, "table", { visibleFieldSlugs: ["title"] });
    const pending = await client.views.changeRequest({
      operation: "update",
      viewId: table.id,
      config: { fieldWidths: { title: 280 } },
      autoMerge: false,
    });
    if (pending.materialized) throw new Error("Expected a review request");
    const head = pending.operations[0]?.headCommit;
    if (!head) throw new Error("Expected a head commit");
    const { configPatch: _patch, configBase: _baseline, ...historical } = head.payload;
    const db = await getDb();
    await db
      .update(busabaseCommits)
      .set({ payload: historical })
      .where(eq(busabaseCommits.id, head.id));
    expect((await approve(pending.id)).results[0]?.ok).toBe(true);
    expect((await readView(base.id, table.id)).config.fieldWidths).toEqual({ title: 280 });
  });

  it("does not rewrite an unchanged automatic origin but still announces its newly derived column", async () => {
    const base = await makeBase();
    const table = await makeView(base.id, "table", { autoShowNewFields: true });
    const observedQueries: string[] = [];
    const observedDb = drizzle(await getPgliteClient(), {
      schema,
      logger: { logQuery: (query) => observedQueries.push(query) },
    });
    const result = await runWithBusabaseContext(
      { db: observedDb, spaceId: LOCAL_SPACE_ID, isSpaceManager: true },
      () =>
        client.bases.fieldChangeRequest({
          operation: "create",
          baseId: base.id,
          slug: "unchanged_automatic_attachment",
          name: "Attachment",
          type: "attachment",
          originViewId: table.id,
          autoMerge: true,
        }),
    );
    expect(result.mergeSummary.viewIds).toContain(table.id);
    expect((await readView(base.id, table.id)).updatedAt).toBe(table.updatedAt);
    expect(await visible(base.id, table)).toContain("unchanged_automatic_attachment");
    expect(observedQueries.filter((query) => /^update "busabase_views"/i.test(query))).toHaveLength(
      0,
    );
  });

  it("keeps explicit full-snapshot writes conflict-aware instead of discarding caller intent", async () => {
    const base = await makeBase();
    const table = await makeView(base.id, "table", { visibleFieldSlugs: ["title"] });
    const pending = await client.views.changeRequest({
      operation: "update",
      viewId: table.id,
      config: { ...table.config, fieldWidths: { title: 280 } },
      autoMerge: false,
    });
    if (pending.materialized) throw new Error("Expected a pending width change");
    await add(base.id, "attachment", table.id);
    expect((await approve(pending.id)).results[0]).toMatchObject({ ok: false, code: "CONFLICT" });
    expect((await readView(base.id, table.id)).config.fieldWidths).not.toEqual({ title: 280 });
    expect(await visible(base.id, table)).toEqual(["title", "attachment"]);
  });

  it("rejects a conflicting pending visibility edit rather than silently hiding a concurrently added source field", async () => {
    const base = await makeBase();
    const table = await makeView(base.id, "table", { visibleFieldSlugs: ["title"] });
    const pending = await client.views.changeRequest({
      operation: "update",
      viewId: table.id,
      config: getViewConfigPatch(table.config, {
        ...table.config,
        visibleFieldSlugs: ["title", "status"],
      }),
      autoMerge: false,
    });
    if (pending.materialized) throw new Error("Expected a pending visibility change");
    await add(base.id, "attachment", table.id);
    expect((await approve(pending.id)).results[0]).toMatchObject({ ok: false, code: "CONFLICT" });
    expect(await visible(base.id, table)).toEqual(["title", "attachment"]);
  });

  it("announces source and legacy card view updates to connected clients after the field transaction commits", async () => {
    const base = await makeBase();
    const source = await makeView(base.id, "table", { visibleFieldSlugs: ["title"] });
    const legacyBoard = await makeView(base.id, "kanban");
    const db = await getDb();
    await db.update(busabaseViews).set({ config: {} }).where(eq(busabaseViews.id, legacyBoard.id));
    const signal = AbortSignal.timeout(5000);
    const observed = (async () => {
      for await (const event of subscribeBusabaseLiveEvents(LOCAL_SPACE_ID, signal)) {
        if (event.kind === "change_request.merged" && event.baseId === base.id) return event;
      }
      return undefined;
    })();
    const result = await client.bases.fieldChangeRequest({
      operation: "create",
      baseId: base.id,
      slug: "announced_attachment",
      name: "Attachment",
      type: "attachment",
      originViewId: source.id,
      autoMerge: true,
    });
    expect(result.mergeSummary.viewIds).toEqual(
      expect.arrayContaining([source.id, legacyBoard.id]),
    );
    expect((await observed)?.viewIds).toEqual(expect.arrayContaining([source.id, legacyBoard.id]));
  });
});
