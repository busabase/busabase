import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

/** A board's saved filters/sorts stay authoritative within each bounded column. */
describe("bounded Kanban columns — real PGlite/oRPC", () => {
  it("pages sorted, filtered columns and the unset bucket without duplicates or incorrect totals", async () => {
    await seedScenario("kanban-bounded-columns");
    const client = createRouterClient(busabaseRouter);
    const base = await client.bases.create({
      autoMerge: true,
      slug: "column-sort",
      name: "Column sort",
      fields: [
        { slug: "title", name: "Title", type: "text" },
        {
          slug: "state",
          name: "State",
          type: "select",
          options: {
            choices: [
              { id: "todo", name: "To do" },
              { id: "done", name: "Done" },
            ],
          },
        },
        { slug: "score", name: "Score", type: "number" },
        { slug: "due", name: "Due", type: "date" },
        { slug: "included", name: "Included", type: "checkbox" },
      ],
    });
    const seed = Array.from({ length: 80 }, (_, index) => ({
      title: `Task ${index}`,
      ...(index < 75 ? { state: index < 60 ? "todo" : "done" } : {}),
      score: (index * 17) % 83,
      due: `2026-11-0${(index % 3) + 1}`,
      included: index % 3 !== 0,
    }));
    const bulk = await client.bases.createBulkChangeRequest({ baseId: base.id, records: seed });
    await client.changeRequests.review({ changeRequestIds: [bulk.id], verdict: "approved" });
    await client.changeRequests.merge({ changeRequestIds: [bulk.id] });
    const viewCr = await client.views.changeRequest({
      operation: "create",
      baseId: base.id,
      slug: "sorted-board",
      name: "Sorted board",
      type: "kanban",
      autoMerge: false,
      config: {
        stackByFieldSlug: "state",
        filters: [{ fieldSlug: "included", operator: "is_true" }],
        sorts: [
          { fieldSlug: "due", direction: "asc" },
          { fieldSlug: "score", direction: "desc" },
        ],
      },
    });
    await client.changeRequests.review({ changeRequestIds: [viewCr.id], verdict: "approved" });
    const merged = await client.changeRequests.merge({ changeRequestIds: [viewCr.id] });
    const result = merged.results[0];
    if (!result?.ok || !result.view) throw new Error("View was not materialized");

    for (const column of ["todo", "done", undefined]) {
      const expected = seed
        .filter((record) => record.included && record.state === column)
        .sort((a, b) => a.due.localeCompare(b.due) || b.score - a.score)
        .map((record) => record.title);
      const loaded: string[] = [];
      let page = 1;
      let lastTotal = 0;
      for (;;) {
        const response = await client.records.listPage({
          baseId: base.id,
          viewId: result.view.id,
          filters: [
            column === undefined
              ? { fieldSlug: "state", fieldType: "select", operator: "is_empty" }
              : { fieldSlug: "state", fieldType: "select", operator: "equals", value: column },
          ],
          page,
          pageSize: 20,
          totalLimit: page * 20 + 1,
        });
        loaded.push(...response.records.map((record) => String(record.headCommit.payload.title)));
        lastTotal = response.total;
        if (page >= response.totalPages) {
          expect(response.totalCapped ?? false).toBe(false);
          break;
        }
        expect(response.totalCapped).toBe(true);
        expect(response.total).toBe(page * 20 + 1);
        page += 1;
      }
      expect(loaded).toEqual(expected);
      expect(new Set(loaded).size).toBe(expected.length);
      expect(lastTotal).toBe(expected.length);
    }
  });
});
