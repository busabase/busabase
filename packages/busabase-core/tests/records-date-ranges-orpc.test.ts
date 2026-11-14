import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * `records.listPage`'s `dateRanges`: several date fields scoped at once, each
 * bound optional. A timeline asks for the records whose [start, end] span
 * overlaps a period [from, to) as `start < to` AND `end >= from`, so a task
 * that began before the period or runs past it still has its bar drawn.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

// Day values are stored at their own UTC midnight.
const FROM = "2026-11-01T00:00:00.000Z";
const TO = "2026-12-01T00:00:00.000Z";
const TASKS: Array<{ title: string; start?: string; end?: string; overlaps: boolean }> = [
  { title: "before", start: "2026-10-20", end: "2026-10-25", overlaps: false },
  { title: "ends on the first day", start: "2026-10-30", end: "2026-11-01", overlaps: true },
  { title: "crosses the start", start: "2026-10-28", end: "2026-11-03", overlaps: true },
  { title: "inside", start: "2026-11-10", end: "2026-11-12", overlaps: true },
  { title: "crosses the end", start: "2026-11-28", end: "2026-12-05", overlaps: true },
  { title: "starts the day after", start: "2026-12-01", end: "2026-12-02", overlaps: false },
  { title: "after", start: "2026-12-02", end: "2026-12-04", overlaps: false },
  { title: "spans the whole period", start: "2026-10-01", end: "2027-01-01", overlaps: true },
  { title: "start only", start: "2026-11-15", overlaps: false },
];

describe("records.listPage dateRanges (real PGLite)", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-date-ranges-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-date-ranges-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    const base = await client.bases.create({
      slug: "plan",
      name: "Plan",
      fields: [
        { slug: "title", name: "Title", type: "text", required: true, options: {} },
        { slug: "start", name: "Start", type: "date", required: false, options: {} },
        { slug: "end", name: "End", type: "date", required: false, options: {} },
      ],
      autoMerge: true,
    });
    baseId = base.id;
    await client.bases.createBulkChangeRequest({
      baseId,
      records: TASKS.map(({ title, start, end }) => ({
        title,
        ...(start ? { start } : {}),
        ...(end ? { end } : {}),
      })),
      autoMerge: true,
    });
  }, 120_000);

  afterAll(async () => {
    process.chdir(originalCwd);
    await rm(dataDir, { recursive: true, force: true });
    await rm(storageDir, { recursive: true, force: true });
  });

  const titles = (page: { records: Array<{ headCommit: { payload: Record<string, unknown> } }> }) =>
    page.records.map((record) => String(record.headCommit.payload.title)).sort();

  it("returns exactly the spans that overlap the period", async () => {
    const page = await client.records.listPage({
      baseId,
      pageSize: 100,
      dateRanges: [
        { fieldSlug: "start", lt: TO },
        { fieldSlug: "end", gte: FROM },
      ],
    });
    expect(titles(page)).toEqual(
      TASKS.filter((task) => task.overlaps)
        .map((task) => task.title)
        .sort(),
    );
    expect(page.total).toBe(TASKS.filter((task) => task.overlaps).length);
  });

  it("takes one-sided and two-sided ranges, together with dateRange", async () => {
    const startsInPeriod = await client.records.listPage({
      baseId,
      pageSize: 100,
      dateRanges: [{ fieldSlug: "start", gte: FROM, lt: TO }],
    });
    expect(titles(startsInPeriod)).toEqual(["crosses the end", "inside", "start only"]);
    const combined = await client.records.listPage({
      baseId,
      pageSize: 100,
      dateRange: { fieldSlug: "start", gte: FROM, lt: TO },
      dateRanges: [{ fieldSlug: "end", gte: "2026-12-01T00:00:00.000Z" }],
    });
    expect(titles(combined)).toEqual(["crosses the end"]);
  });

  it("refuses a range with no bound, an unknown field or a field that is not a date", async () => {
    await expect(
      client.records.listPage({ baseId, dateRanges: [{ fieldSlug: "start" }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      client.records.listPage({ baseId, dateRanges: [{ fieldSlug: "nope", lt: TO }] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      client.records.listPage({ baseId, dateRanges: [{ fieldSlug: "title", lt: TO }] }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});
