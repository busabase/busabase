import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * Large-dataset guard for the record read paths.
 *
 * `scripts/bench-records.ts` measures how these paths scale; this file pins the
 * behaviour that made the optimisations safe, so a future change cannot buy
 * speed back by quietly returning the wrong records:
 *
 *  - a saved view with a filter/sort is evaluated over the WHOLE Base before the
 *    page is cut, so `total` and every page reflect all matching records — not
 *    just the ones that happened to land in one SQL page;
 *  - the fast path (evaluate lightweight rows, hydrate only the page) and the
 *    lookup fallback path (hydrate everything first) agree;
 *  - a page of a big Base does not materialise the whole Base in memory.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
/** Comfortably more than one page, small enough to seed inside a test run. */
const RECORD_COUNT = 600;
const STATUSES = ["draft", "review", "approved", "archived"];
const APPROVED_COUNT = RECORD_COUNT / STATUSES.length;

describe("records — large dataset read paths", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";
  let filteredViewId = "";
  let sortedViewId = "";
  let lookupBaseId = "";
  let lookupSortedViewId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-large-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-large-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const importBulk = async (targetBaseId: string, records: unknown[]) => {
      const cr = await client.bases.createBulkChangeRequest({
        baseId: targetBaseId,
        records: records as never,
        message: "seed",
      });
      await client.changeRequests.review({ changeRequestIds: [cr.id], verdict: "approved" });
      await client.changeRequests.merge({ changeRequestIds: [cr.id] });
    };
    const createView = async (
      targetBaseId: string,
      slug: string,
      config: { filters?: unknown[]; sorts?: unknown[] },
    ) => {
      await client.views.changeRequest({
        operation: "create",
        baseId: targetBaseId,
        slug,
        name: slug,
        config: { filters: [], sorts: [], ...config } as never,
        autoMerge: true,
      });
      const views = await client.bases.listViews({ baseId: targetBaseId });
      const view = views.find((candidate) => candidate.slug === slug);
      if (!view) throw new Error(`view ${slug} was not created`);
      return view.id;
    };

    const base = await client.bases.create({
      slug: "large-contacts",
      name: "Large Contacts",
      fields: [
        { slug: "name", name: "Name", type: "text", required: true, options: {} },
        { slug: "score", name: "Score", type: "number", options: {} },
        { slug: "status", name: "Status", type: "text", options: {} },
      ],
      autoMerge: true,
    });
    baseId = base.id;
    await importBulk(
      baseId,
      Array.from({ length: RECORD_COUNT }, (_, i) => ({
        name: `Contact ${i}`,
        // Descending score against ascending insertion order, so a correct sort
        // cannot be produced by accidentally keeping insertion order.
        score: RECORD_COUNT - i,
        status: STATUSES[i % STATUSES.length],
      })),
    );
    filteredViewId = await createView(baseId, "only-approved", {
      filters: [{ fieldSlug: "status", operator: "equals", value: "approved" }],
    });
    sortedViewId = await createView(baseId, "by-score", {
      sorts: [{ fieldSlug: "score", direction: "asc" }],
    });

    // A second Base whose view sorts by a `lookup` field — the one case that
    // cannot be evaluated before hydration, so it takes the fallback path.
    const companies = await client.bases.create({
      slug: "large-companies",
      name: "Large Companies",
      fields: [
        { slug: "name", name: "Name", type: "text", required: true, options: {} },
        { slug: "revenue", name: "Revenue", type: "number", options: {} },
      ],
      autoMerge: true,
    });
    await importBulk(
      companies.id,
      Array.from({ length: 20 }, (_, i) => ({ name: `Company ${i}`, revenue: i * 10 })),
    );
    const companyIds = (await client.records.list({ baseId: companies.id, limit: 100 })).records
      .map((record) => record.id)
      .reverse();
    const deals = await client.bases.create({
      slug: "large-deals",
      name: "Large Deals",
      fields: [
        { slug: "name", name: "Name", type: "text", required: true, options: {} },
        {
          slug: "company",
          name: "Company",
          type: "relation",
          options: { targetBaseId: companies.id, multiple: true },
        },
        {
          slug: "company_revenue",
          name: "Company Revenue",
          type: "lookup",
          options: {
            lookup: {
              relationFieldSlug: "company",
              targetFieldSlug: "revenue",
              rollup: "sum",
              limit: "first",
            },
          },
        },
      ],
      autoMerge: true,
    });
    lookupBaseId = deals.id;
    await importBulk(
      lookupBaseId,
      Array.from({ length: 20 }, (_, i) => ({
        name: `Deal ${i}`,
        company: [companyIds[i % companyIds.length]],
      })),
    );
    lookupSortedViewId = await createView(lookupBaseId, "by-company-revenue", {
      sorts: [{ fieldSlug: "company_revenue", direction: "desc" }],
    });
  }, 300_000);

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("seeded the whole dataset", async () => {
    const { total } = await client.records.count({ baseId });
    expect(total).toBe(RECORD_COUNT);
  });

  it("a filtered view reports the total across the WHOLE base, not one SQL page", async () => {
    const page = await client.records.listPage({
      baseId,
      viewId: filteredViewId,
      page: 1,
      pageSize: 50,
    });
    expect(page.total).toBe(APPROVED_COUNT);
    expect(page.records).toHaveLength(50);
    for (const record of page.records) {
      expect(record.headCommit.fields.status).toBe("approved");
    }
  });

  it("paging a filtered view yields every matching record exactly once", async () => {
    const seen = new Set<string>();
    const totalPages = Math.ceil(APPROVED_COUNT / 50);
    for (let page = 1; page <= totalPages; page++) {
      const result = await client.records.listPage({
        baseId,
        viewId: filteredViewId,
        page,
        pageSize: 50,
      });
      for (const record of result.records) {
        expect(record.headCommit.fields.status).toBe("approved");
        expect(seen.has(record.id)).toBe(false);
        seen.add(record.id);
      }
    }
    expect(seen.size).toBe(APPROVED_COUNT);
  });

  it("a sorted view orders across the whole base and pages consistently", async () => {
    const first = await client.records.listPage({
      baseId,
      viewId: sortedViewId,
      page: 1,
      pageSize: 50,
    });
    expect(first.total).toBe(RECORD_COUNT);
    const scores = first.records.map((record) => Number(record.headCommit.fields.score));
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
    // Ascending by score means the page-1 rows are the globally smallest, which
    // is only true if the sort ran over the whole Base before the page was cut.
    expect(Math.max(...scores)).toBeLessThanOrEqual(50);

    const second = await client.records.listPage({
      baseId,
      viewId: sortedViewId,
      page: 2,
      pageSize: 50,
    });
    const secondScores = second.records.map((record) => Number(record.headCommit.fields.score));
    expect(Math.min(...secondScores)).toBeGreaterThan(Math.max(...scores));
  });

  it("a view sorted by a lookup field still sorts by the resolved value", async () => {
    const page = await client.records.listPage({
      baseId: lookupBaseId,
      viewId: lookupSortedViewId,
      page: 1,
      pageSize: 50,
    });
    expect(page.total).toBe(20);
    const revenues = page.records.map((record) =>
      Number(record.headCommit.fields.company_revenue ?? 0),
    );
    expect(revenues).toEqual([...revenues].sort((a, b) => b - a));
    expect(revenues[0]).toBeGreaterThan(revenues[revenues.length - 1]);
  });

  it("keyset listing sorted by a number field pushes the sort down and stays ordered", async () => {
    const page = await client.records.list({
      baseId,
      limit: 50,
      sort: { fieldSlug: "score", fieldType: "number", direction: "asc" },
    } as never);
    const scores = page.records.map((record) => Number(record.headCommit.fields.score));
    expect(scores).toHaveLength(50);
    expect(scores).toEqual([...scores].sort((a, b) => a - b));
    expect(Math.max(...scores)).toBeLessThanOrEqual(50);
  });

  // The load-bearing guard. `listPage` no longer hydrates the whole Base before
  // applying a saved view; it evaluates lightweight rows and hydrates only the
  // page. That is only safe if it produces EXACTLY what evaluating the fully
  // hydrated set would have produced — so this recomputes the old semantics
  // client-side (hydrate everything, then `applyViewConfigToRecords`, which is
  // literally the function the fallback path still calls) and compares ids.
  it.each([
    ["filtered", () => filteredViewId],
    ["sorted", () => sortedViewId],
  ])("a %s view returns exactly what whole-base evaluation would return", async (_label, getId) => {
    const viewId = getId();
    const view = (await client.bases.listViews({ baseId })).find(
      (candidate) => candidate.id === viewId,
    );
    if (!view) throw new Error("view not found");

    const all: Awaited<ReturnType<Client["records"]["list"]>>["records"] = [];
    let cursor: string | undefined;
    for (;;) {
      const page = await client.records.list({ baseId, limit: 100, cursor });
      all.push(...page.records);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    expect(all).toHaveLength(RECORD_COUNT);

    const { applyViewConfigToRecords } = await import("../src/domains/base/utils/view-records");
    const expected = applyViewConfigToRecords(all, view.config);

    for (const page of [1, 2, 3]) {
      const actual = await client.records.listPage({ baseId, viewId, page, pageSize: 50 });
      expect(actual.total).toBe(expected.length);
      expect(actual.records.map((record) => record.id)).toEqual(
        expected.slice((page - 1) * 50, page * 50).map((record) => record.id),
      );
    }
  });
});
