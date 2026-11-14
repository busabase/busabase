import { createRouterClient } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { busabaseFieldValues } from "../src/db/schema";
import { busabaseRouter } from "../src/router";
import { seedScenario } from "./helpers/seed-scenario";

/** The indexed time-window path preserves latest-date and stable-page semantics. */
describe("chronological scoped pages — real PGlite/oRPC", () => {
  it("keeps stable pages in both directions and scopes only the newest active projection", async () => {
    const { db } = await seedScenario("scoped-date-sort");
    const client = createRouterClient(busabaseRouter);
    const base = await client.bases.create({
      autoMerge: true,
      slug: "dated",
      name: "Dated",
      fields: [
        { slug: "title", name: "Title", type: "text" },
        { slug: "start", name: "Start", type: "date" },
        { slug: "end", name: "End", type: "date" },
        { slug: "included", name: "Included", type: "checkbox" },
      ],
    });
    await client.bases.createBulkChangeRequest({
      baseId: base.id,
      autoMerge: true,
      records: Array.from({ length: 31 }, (_, index) => ({
        title: `Task ${index}`,
        start: `2026-11-0${(index % 4) + 1}`,
        end: "2026-11-30",
        included: index % 3 !== 0,
      })),
    });
    const all = (await client.records.list({ baseId: base.id, limit: 100 })).records;
    for (const direction of ["asc", "desc"] as const) {
      for (const filtered of [false, true]) {
        const expected = [...all]
          .filter((record) => !filtered || record.headCommit.payload.included)
          .sort((a, b) => {
            const dateOrder = String(a.headCommit.payload.start).localeCompare(
              String(b.headCommit.payload.start),
            );
            return (direction === "asc" ? dateOrder : -dateOrder) || a.id.localeCompare(b.id);
          });
        const ids: string[] = [];
        for (let page = 1; page <= Math.ceil(expected.length / 7); page++) {
          const response = await client.records.listPage({
            baseId: base.id,
            dateRanges: [
              { fieldSlug: "start", lt: "2026-12-01T00:00:00Z" },
              { fieldSlug: "end", gte: "2026-11-01T00:00:00Z" },
            ],
            sort: { fieldSlug: "start", fieldType: "date", direction },
            ...(filtered
              ? { filters: [{ fieldSlug: "included", operator: "is_true" as const }] }
              : {}),
            page,
            pageSize: 7,
          });
          ids.push(...response.records.map((record) => record.id));
          expect(response.total).toBe(expected.length);
        }
        expect(ids).toEqual(expected.map((record) => record.id));
      }
    }
    const target = all[0];
    if (!target) throw new Error("No target record");
    const [projection] = await db
      .select()
      .from(busabaseFieldValues)
      .where(
        and(
          eq(busabaseFieldValues.recordId, target.id),
          eq(busabaseFieldValues.fieldSlug, "start"),
        ),
      );
    if (!projection) throw new Error("No date projection");
    const idsInMonth = async (month: "10" | "11" | "12", plural: boolean) => {
      const range = {
        fieldSlug: "start",
        gte: `2026-${month}-01T00:00:00Z`,
        lt: month === "12" ? "2027-01-01T00:00:00Z" : `2026-${Number(month) + 1}-01T00:00:00Z`,
      };
      return (
        await client.records.listPage({
          baseId: base.id,
          pageSize: 100,
          ...(plural ? { dateRanges: [range] } : { dateRange: range }),
          sort: { fieldSlug: "start", fieldType: "date", direction: "asc" },
        })
      ).records.map((record) => record.id);
    };
    await db.insert(busabaseFieldValues).values({
      ...projection,
      id: "stale_start",
      valueDate: new Date("2026-10-01T00:00:00Z"),
      createdAt: new Date(projection.createdAt.getTime() - 1_000),
    });
    for (const plural of [false, true]) {
      expect(await idsInMonth("10", plural)).not.toContain(target.id);
      expect(await idsInMonth("11", plural)).toContain(target.id);
    }
    await db.insert(busabaseFieldValues).values({
      ...projection,
      id: "newest_start",
      valueDate: new Date("2026-12-15T00:00:00Z"),
      createdAt: new Date(projection.createdAt.getTime() + 1_000),
    });
    for (const plural of [false, true]) {
      expect(await idsInMonth("11", plural)).not.toContain(target.id);
      expect(await idsInMonth("12", plural)).toEqual([target.id]);
    }
    await db
      .update(busabaseFieldValues)
      .set({ deletedAt: new Date() })
      .where(eq(busabaseFieldValues.id, "newest_start"));
    expect(await idsInMonth("11", true)).toContain(target.id);
    await db.insert(busabaseFieldValues).values({
      ...projection,
      id: "null_latest_start",
      valueDate: null,
      createdAt: new Date(projection.createdAt.getTime() + 2_000),
    });
    expect(await idsInMonth("11", true)).not.toContain(target.id);
    const unscoped = await client.records.listPage({
      baseId: base.id,
      pageSize: 100,
      sort: { fieldSlug: "start", fieldType: "date", direction: "asc" },
    });
    expect(unscoped.records.at(-1)?.id).toBe(target.id);
  });
});

it("refills ordered batches after stale dates and duplicate end projections without losing or repeating records", async () => {
  const { db } = await seedScenario("scoped-date-sort-refill");
  const client = createRouterClient(busabaseRouter);
  const base = await client.bases.create({
    autoMerge: true,
    slug: "refill",
    name: "Refill",
    fields: [
      { slug: "title", name: "Title", type: "text" },
      { slug: "start", name: "Start", type: "date" },
      { slug: "end", name: "End", type: "date" },
    ],
  });
  await client.bases.createBulkChangeRequest({
    baseId: base.id,
    autoMerge: true,
    records: Array.from({ length: 331 }, (_, index) => ({
      title: `Task ${index}`,
      start: index < 31 ? `2026-11-${String(index + 1).padStart(2, "0")}` : "2026-12-05",
      end: "2026-12-20",
    })).filter((record) => record.start !== "2026-11-31"),
  });
  const all: Awaited<ReturnType<typeof client.records.list>>["records"] = [];
  let cursor: string | undefined;
  do {
    const response = await client.records.list({ baseId: base.id, limit: 100, cursor });
    all.push(...response.records);
    cursor = response.nextCursor ?? undefined;
  } while (cursor);
  const expected = all
    .filter((record) => String(record.headCommit.payload.start).startsWith("2026-11"))
    .sort(
      (a, b) =>
        String(a.headCommit.payload.start).localeCompare(String(b.headCommit.payload.start)) ||
        a.id.localeCompare(b.id),
    );
  const projections = await db
    .select()
    .from(busabaseFieldValues)
    .where(eq(busabaseFieldValues.baseId, base.id));
  const staleIds = new Set(
    all
      .filter((record) => String(record.headCommit.payload.start).startsWith("2026-12"))
      .map((record) => record.id),
  );
  const staleStarts = projections.filter(
    (row) => row.fieldSlug === "start" && row.recordId && staleIds.has(row.recordId),
  );
  await db.insert(busabaseFieldValues).values(
    staleStarts.map((row, index) => ({
      ...row,
      id: `stale_refill_${index}`,
      valueDate: new Date("2026-11-01T00:00:00Z"),
      createdAt: new Date(row.createdAt.getTime() - 1_000),
    })),
  );
  const firstEnd = projections.find(
    (row) => row.recordId === expected[0]?.id && row.fieldSlug === "end",
  );
  if (!firstEnd) throw new Error("No first task end projection");
  await db.insert(busabaseFieldValues).values(
    Array.from({ length: 300 }, (_, index) => ({
      ...firstEnd,
      id: `duplicate_end_${index}`,
      createdAt: new Date(firstEnd.createdAt.getTime() - 1_000),
    })),
  );
  const ids: string[] = [];
  for (const page of [1, 2]) {
    const response = await client.records.listPage({
      baseId: base.id,
      page,
      pageSize: 20,
      sort: { fieldSlug: "start", fieldType: "date", direction: "asc" },
      dateRanges: [
        { fieldSlug: "start", lt: "2026-12-01T00:00:00Z" },
        { fieldSlug: "end", gte: "2026-11-01T00:00:00Z" },
      ],
    });
    expect(response.total).toBe(30);
    ids.push(...response.records.map((record) => record.id));
  }
  expect(ids).toEqual(expected.map((record) => record.id));
  expect(new Set(ids).size).toBe(30);
});
