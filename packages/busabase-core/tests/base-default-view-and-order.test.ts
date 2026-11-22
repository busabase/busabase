import { createRouterClient } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { busabaseCommits, busabaseOperations, busabaseViews } from "../src/db/schema";
import { listViews } from "../src/domains/base/handlers";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

/**
 * View model for Bases: every Base keeps at least one real
 * saved view (a new one gets "Grid view"), views carry a shared `position`
 * order whose leftmost entry is what the Base opens on, and the last view
 * cannot be deleted — not at proposal time, and not by two pending deletes
 * racing to merge either.
 */

type RawClient = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const LAST_VIEW_MESSAGE =
  "A Base must keep at least one view. Create another view before deleting this one.";

const createBase = async (raw: RawClient, slug: string, extra: { defaultView?: boolean } = {}) => {
  const base = await raw.bases.create({
    autoMerge: true,
    slug,
    name: slug,
    fields: [
      { slug: "title", name: "Title", type: "text" },
      { slug: "status", name: "Status", type: "text" },
    ],
    ...extra,
  });
  if (!base.materialized) throw new Error("expected a materialized Base");
  return base;
};

const createView = async (raw: RawClient, baseId: string, name: string) => {
  const view = await raw.views.changeRequest({
    operation: "create",
    baseId,
    name,
    config: { filters: [], sorts: [] },
    autoMerge: true,
  });
  if (!view.materialized) throw new Error("expected a materialized view");
  return view;
};

const approveAndMerge = async (raw: RawClient, changeRequestId: string) => {
  await raw.changeRequests.review({ changeRequestIds: [changeRequestId], verdict: "approved" });
  const [result] = (await raw.changeRequests.merge({ changeRequestIds: [changeRequestId] }))
    .results;
  return result;
};

const viewNames = async (raw: RawClient, baseId: string) =>
  (await raw.bases.listViews({ baseId })).map((view) => view.name);

describe("a new Base opens on a real Grid view", () => {
  it("bases.create adds exactly one table view at position 0 showing every field", async () => {
    await seedScenario("default-grid-view-immediate");
    const raw: RawClient = createRouterClient(busabaseRouter);
    const base = await createBase(raw, "deals");

    const views = await raw.bases.listViews({ baseId: base.id });
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({
      name: "Grid view",
      slug: "grid-view",
      type: "table",
      status: "active",
      position: 0,
      config: { filters: [], sorts: [] },
    });
    // No column list: every field shows, in Base field order, like the old "All" grid.
    expect(views[0].config.visibleFieldSlugs ?? null).toBeNull();
  });

  it("defaultView: false creates the Base with no view, for callers adding their own", async () => {
    await seedScenario("default-grid-view-opt-out");
    const raw: RawClient = createRouterClient(busabaseRouter);
    const base = await createBase(raw, "bare", { defaultView: false });
    expect(await raw.bases.listViews({ baseId: base.id })).toEqual([]);
  });

  it("the review-first bases.create path gets the Grid view when the proposal merges", async () => {
    await seedScenario("default-grid-view-review-first");
    const raw: RawClient = createRouterClient(busabaseRouter);

    const pending = await raw.bases.create({
      autoMerge: false,
      slug: "reviewed",
      name: "Reviewed",
    });
    if (pending.materialized) throw new Error("expected a pending change request");
    const optedOut = await raw.bases.create({
      autoMerge: false,
      slug: "reviewed-bare",
      name: "Reviewed bare",
      defaultView: false,
    });
    if (optedOut.materialized) throw new Error("expected a pending change request");
    expect((await approveAndMerge(raw, pending.id))?.ok).toBe(true);
    expect((await approveAndMerge(raw, optedOut.id))?.ok).toBe(true);

    const reviewed = await raw.bases.get({ baseId: "reviewed" });
    expect(await viewNames(raw, reviewed.id)).toEqual(["Grid view"]);
    const bare = await raw.bases.get({ baseId: "reviewed-bare" });
    expect(await viewNames(raw, bare.id)).toEqual([]);
  });

  it("a Base created through nodes.createChangeRequest gets the Grid view at merge", async () => {
    await seedScenario("default-grid-view-node-cr");
    const raw: RawClient = createRouterClient(busabaseRouter);
    const changeRequest = await raw.nodes.createChangeRequest({
      autoMerge: false,
      operations: [{ kind: "create", nodeType: "base", slug: "tree-base", name: "Tree base" }],
    });
    expect((await approveAndMerge(raw, changeRequest.id))?.ok).toBe(true);
    const base = await raw.bases.get({ baseId: "tree-base" });
    const views = await raw.bases.listViews({ baseId: base.id });
    expect(views.map((view) => [view.name, view.type, view.position])).toEqual([
      ["Grid view", "table", 0],
    ]);
  });
});

describe("views keep a shared order", () => {
  it("new views join the end; update with position moves one and renumbers the rest", async () => {
    const { db } = await seedScenario("view-order-reorder");
    const raw: RawClient = createRouterClient(busabaseRouter);
    const base = await createBase(raw, "tasks");
    const board = await createView(raw, base.id, "Board");
    const open = await createView(raw, base.id, "Open");

    const initial = await raw.bases.listViews({ baseId: base.id });
    expect(initial.map((view) => [view.name, view.position])).toEqual([
      ["Grid view", 0],
      ["Board", 1],
      ["Open", 2],
    ]);
    const gridBefore = initial[0];

    // Move "Open" to the front: it becomes the view the Base opens on.
    const moved = await raw.views.changeRequest({
      operation: "update",
      viewId: open.id,
      position: 0,
      autoMerge: true,
    });
    expect(moved.materialized).toBe(true);
    const afterMove = await raw.bases.listViews({ baseId: base.id });
    expect(afterMove.map((view) => [view.name, view.position])).toEqual([
      ["Open", 0],
      ["Grid view", 1],
      ["Board", 2],
    ]);
    // A pure reorder leaves the view's content alone…
    expect(afterMove.find((view) => view.id === gridBefore.id)?.config).toEqual(gridBefore.config);
    // …and records only the move, so the review diff shows just that.
    const [operation] = await db
      .select({ headCommitId: busabaseOperations.headCommitId })
      .from(busabaseOperations)
      .where(
        and(
          eq(busabaseOperations.targetViewId, open.id),
          eq(busabaseOperations.operation, "view_update"),
        ),
      );
    const [commit] = await db
      .select({ payload: busabaseCommits.payload })
      .from(busabaseCommits)
      .where(eq(busabaseCommits.id, operation.headCommitId));
    expect(commit.payload).toEqual({ position: 0 });

    // Out-of-range clamps to the end.
    await raw.views.changeRequest({
      operation: "update",
      viewId: open.id,
      position: 99,
      autoMerge: true,
    });
    expect(await viewNames(raw, base.id)).toEqual(["Grid view", "Board", "Open"]);

    // A view created after a reorder still lands at the end.
    await createView(raw, base.id, "Later");
    const final = await raw.bases.listViews({ baseId: base.id });
    expect(final.map((view) => [view.name, view.position])).toEqual([
      ["Grid view", 0],
      ["Board", 1],
      ["Open", 2],
      ["Later", 3],
    ]);
    // The space-wide listing keeps each Base's views in the same order.
    const spaceWide = (await listViews()).filter((view) => view.baseId === base.id);
    expect(spaceWide.map((view) => view.id)).toEqual(final.map((view) => view.id));
    expect(final[1].id).toBe(board.id);
  });

  it("a reorder combined with a content edit applies both", async () => {
    await seedScenario("view-order-combined");
    const raw: RawClient = createRouterClient(busabaseRouter);
    const base = await createBase(raw, "combined");
    const second = await createView(raw, base.id, "Second");
    await raw.views.changeRequest({
      operation: "update",
      viewId: second.id,
      name: "Renamed",
      position: 0,
      autoMerge: true,
    });
    expect(await viewNames(raw, base.id)).toEqual(["Renamed", "Grid view"]);
  });
});

describe("a Base keeps at least one view", () => {
  it("rejects deleting the last view when it is proposed", async () => {
    const { db } = await seedScenario("last-view-propose");
    const raw: RawClient = createRouterClient(busabaseRouter);
    const base = await createBase(raw, "solo");
    const [onlyView] = await raw.bases.listViews({ baseId: base.id });

    for (const autoMerge of [false, true]) {
      await expect(
        raw.views.changeRequest({ operation: "delete", viewId: onlyView.id, autoMerge }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST", message: LAST_VIEW_MESSAGE });
    }
    // Nothing was proposed.
    expect(
      await db
        .select({ id: busabaseOperations.id })
        .from(busabaseOperations)
        .where(eq(busabaseOperations.targetViewId, onlyView.id)),
    ).toEqual([]);

    // With a second view in place the first one can go.
    const other = await createView(raw, base.id, "Other");
    const deleted = await raw.views.changeRequest({
      operation: "delete",
      viewId: onlyView.id,
      autoMerge: true,
    });
    expect(deleted.materialized).toBe(true);
    expect(await viewNames(raw, base.id)).toEqual(["Other"]);
    // …and now "Other" is the last one.
    await expect(
      raw.views.changeRequest({ operation: "delete", viewId: other.id, autoMerge: false }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects the second of two pending deletes that would empty the Base at merge time", async () => {
    const { db } = await seedScenario("last-view-merge-race");
    const raw: RawClient = createRouterClient(busabaseRouter);
    const base = await createBase(raw, "pair");
    const second = await createView(raw, base.id, "Second");
    const [grid] = await raw.bases.listViews({ baseId: base.id });

    // Both proposals pass the propose-time check: each sees the other view.
    const deleteGrid = await raw.views.changeRequest({
      operation: "delete",
      viewId: grid.id,
      autoMerge: false,
    });
    const deleteSecond = await raw.views.changeRequest({
      operation: "delete",
      viewId: second.id,
      autoMerge: false,
    });
    if (deleteGrid.materialized || deleteSecond.materialized) {
      throw new Error("expected pending change requests");
    }

    expect((await approveAndMerge(raw, deleteGrid.id))?.ok).toBe(true);
    const refused = await approveAndMerge(raw, deleteSecond.id);
    if (!refused || refused.ok) throw new Error("expected the second delete to be refused");
    expect(refused.error).toContain(LAST_VIEW_MESSAGE);

    const remaining = await db
      .select({ id: busabaseViews.id })
      .from(busabaseViews)
      .where(and(eq(busabaseViews.baseId, base.id), eq(busabaseViews.status, "active")));
    expect(remaining).toEqual([{ id: second.id }]);
  });
});
