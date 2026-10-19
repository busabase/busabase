import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
type PageRecord = Awaited<ReturnType<Client["records"]["listPage"]>>["records"][number];

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

const RECORD_COUNT = 21;
const PAGE_SIZE = 7; // → exactly 3 pages
const PAGES = [1, 2, 3];

// Heavy ties on purpose: 4 distinct scores and 4 distinct dates across 21
// records, plus empty values. Without a stable tiebreaker OFFSET paging over
// these could repeat or drop records between pages.
const scoreFor = (index: number): number | null => (index % 5 === 4 ? null : (index % 4) * 10);
const followUpFor = (index: number): string | null =>
  index % 6 === 5 ? null : `2026-10-0${(index % 4) + 1}T09:00:00.000Z`;

/**
 * records.listPage `sort` — the AirApp numbered-pager case: page N of
 * "newest follow-up first" in ONE request, with no saved View and no cursor
 * walk, and pages that tile the whole Base exactly.
 */
describe("records.listPage sort - oRPC integration (PGLite)", () => {
  let client: Client;
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let baseId = "";
  let filteredViewId = "";
  let sortOnlyViewId = "";

  const createView = async (
    slug: string,
    config: {
      filters: { fieldSlug: string; operator: "equals"; value: string }[];
      sorts: { fieldSlug: string; direction: "asc" | "desc" }[];
    },
  ): Promise<string> => {
    const viewCr = await client.views.changeRequest({
      operation: "create",
      baseId,
      slug,
      name: slug,
      config,
      autoMerge: false,
    });
    await client.changeRequests.review({ changeRequestIds: [viewCr.id], verdict: "approved" });
    const merged = await client.changeRequests.merge({ changeRequestIds: [viewCr.id] });
    const result = merged.results[0];
    if (!result?.ok || !result.view) throw new Error(result?.error ?? "View merge failed");
    return result.view.id;
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-record-page-sort-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-record-page-sort-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "sorted-leads",
      name: "Sorted leads",
      fields: [
        { slug: "name", name: "Name", type: "text", required: true, options: {} },
        { slug: "score", name: "Score", type: "number", required: false, options: {} },
        { slug: "follow_up", name: "Follow up", type: "date", required: false, options: {} },
        { slug: "owner", name: "Owner", type: "text", required: false, options: {} },
      ],
      autoMerge: true,
    });
    baseId = base.id;

    const records = Array.from({ length: RECORD_COUNT }, (_, index) => {
      const score = scoreFor(index);
      const followUp = followUpFor(index);
      return {
        name: `Lead ${String(index + 1).padStart(2, "0")}`,
        owner: index % 2 === 0 ? "ann" : "bob",
        ...(score === null ? {} : { score }),
        ...(followUp === null ? {} : { follow_up: followUp }),
      };
    });
    const bulk = await client.bases.createBulkChangeRequest({
      baseId,
      records,
      message: "Seed sorted pagination",
    });
    await client.changeRequests.review({ changeRequestIds: [bulk.id], verdict: "approved" });
    await client.changeRequests.merge({ changeRequestIds: [bulk.id] });

    filteredViewId = await createView("ann-by-name", {
      filters: [{ fieldSlug: "owner", operator: "equals", value: "ann" }],
      sorts: [{ fieldSlug: "name", direction: "desc" }],
    });
    sortOnlyViewId = await createView("all-by-name", {
      filters: [],
      sorts: [{ fieldSlug: "name", direction: "asc" }],
    });
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  const fetchAllPages = async (extra: Parameters<Client["records"]["listPage"]>[0]) => {
    const pages = [];
    for (const page of PAGES) {
      pages.push(await client.records.listPage({ ...extra, page, pageSize: PAGE_SIZE }));
    }
    return pages;
  };

  const keyOf = (record: PageRecord, slug: "score" | "follow_up"): number | null => {
    const raw = record.headCommit.payload[slug];
    if (raw === null || raw === undefined || raw === "") return null;
    return slug === "score" ? Number(raw) : new Date(String(raw)).getTime();
  };

  const allIds = async (): Promise<string[]> => {
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.records.list({ baseId, limit: 100, cursor });
      ids.push(...page.records.map((record) => record.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return ids;
  };

  for (const [slug, fieldType] of [
    ["score", "number"],
    ["follow_up", "date"],
  ] as const) {
    for (const direction of ["asc", "desc"] as const) {
      it(`pages 1..3 by ${fieldType} ${direction} form one total order: no overlap, no skip`, async () => {
        const sort = { fieldSlug: slug, fieldType, direction };
        const pages = await fetchAllPages({ baseId, sort });

        for (const page of pages) {
          expect(page.total).toBe(RECORD_COUNT);
          expect(page.totalPages).toBe(3);
          expect(page.records).toHaveLength(PAGE_SIZE);
        }
        const ordered = pages.flatMap((page) => page.records);
        const ids = ordered.map((record) => record.id);
        // No overlap and no skip: the three pages tile the Base exactly.
        expect(new Set(ids).size).toBe(RECORD_COUNT);
        expect([...ids].sort()).toEqual([...(await allIds())].sort());

        // Values are monotone in the requested direction, empties last.
        const keys = ordered.map((record) => keyOf(record, slug));
        const firstNull = keys.indexOf(null);
        expect(firstNull).toBeGreaterThan(0);
        expect(keys.slice(firstNull).every((key) => key === null)).toBe(true);
        const present = keys.slice(0, firstNull) as number[];
        for (let i = 1; i < present.length; i += 1) {
          const prev = present[i - 1] as number;
          const next = present[i] as number;
          if (direction === "asc") expect(next).toBeGreaterThanOrEqual(prev);
          else expect(next).toBeLessThanOrEqual(prev);
        }
        // Ties really exist, so the test exercises the tiebreaker.
        expect(new Set(present).size).toBeLessThan(present.length);

        // Deterministic: asking again returns the identical sequence.
        const again = (await fetchAllPages({ baseId, sort })).flatMap((page) =>
          page.records.map((record) => record.id),
        );
        expect(again).toEqual(ids);
      });
    }
  }

  it("an explicit sort replaces the View's sort but keeps its filters", async () => {
    const sort = { fieldSlug: "score", fieldType: "number", direction: "desc" } as const;
    const withView = await client.records.listPage({
      baseId,
      viewId: filteredViewId,
      sort,
      page: 1,
      pageSize: 100,
    });
    const annCount = Array.from({ length: RECORD_COUNT }, (_, i) => i).filter(
      (i) => i % 2 === 0,
    ).length;
    expect(withView.total).toBe(annCount);
    expect(withView.records.every((record) => record.headCommit.payload.owner === "ann")).toBe(
      true,
    );
    // Order is the score sort, not the View's name-desc sort: it equals the
    // unfiltered score-desc order restricted to ann's records.
    const unfiltered = await client.records.listPage({ baseId, sort, page: 1, pageSize: 100 });
    const expected = unfiltered.records
      .filter((record) => record.headCommit.payload.owner === "ann")
      .map((record) => record.id);
    expect(withView.records.map((record) => record.id)).toEqual(expected);

    // Without `sort` the same View still orders by its own name-desc sort.
    const viewOnly = await client.records.listPage({
      baseId,
      viewId: filteredViewId,
      page: 1,
      pageSize: 100,
    });
    const names = viewOnly.records.map((record) => String(record.headCommit.payload.name));
    expect(names).toEqual([...names].sort().reverse());
  });

  it("an explicit sort over a sort-only View pages across 1..3 the same as no View", async () => {
    const sort = { fieldSlug: "follow_up", fieldType: "date", direction: "desc" } as const;
    const viaView = (await fetchAllPages({ baseId, viewId: sortOnlyViewId, sort })).flatMap(
      (page) => page.records.map((record) => record.id),
    );
    const plain = (await fetchAllPages({ baseId, sort })).flatMap((page) =>
      page.records.map((record) => record.id),
    );
    expect(viaView).toEqual(plain);
  });

  it("omitting sort keeps today's default order exactly (records.list's createdAt desc, id desc)", async () => {
    const paged = (await fetchAllPages({ baseId })).flatMap((page) =>
      page.records.map((record) => record.id),
    );
    expect(paged).toEqual(await allIds());
  });

  it("a sort on a non number/date field is ignored, like records.list", async () => {
    const paged = (
      await fetchAllPages({
        baseId,
        sort: { fieldSlug: "name", fieldType: "text", direction: "asc" },
      })
    ).flatMap((page) => page.records.map((record) => record.id));
    expect(paged).toEqual(await allIds());

    // ...and it still REPLACES a View's sort: a name-asc View asked for a text
    // sort comes back in the default order, not the View's.
    const overView = (
      await fetchAllPages({
        baseId,
        viewId: sortOnlyViewId,
        sort: { fieldSlug: "owner", fieldType: "text", direction: "asc" },
      })
    ).flatMap((page) => page.records.map((record) => record.id));
    expect(overView).toEqual(await allIds());
  });
});
