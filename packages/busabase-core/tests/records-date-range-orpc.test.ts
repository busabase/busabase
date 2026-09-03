import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * `listPage`'s `dateRange` scopes a read to `[gte, lt)` on a `date` field's
 * UTC instant — the primitive a Calendar month grid needs to fetch only its
 * own slice instead of the whole Base. Unlike the label-based filter
 * pushdown, this is a real timestamp comparison, so there is no client-parity
 * question to check — what matters is getting the boundary arithmetic right:
 * inclusive start, exclusive end, and no off-by-one at either edge.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("records.listPage dateRange — oRPC integration", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-date-range-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-date-range-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "events",
      name: "Events",
      fields: [
        { slug: "title", name: "Title", type: "text", required: true, options: {} },
        { slug: "when", name: "When", type: "date", required: false, options: {} },
        { slug: "notes", name: "Notes", type: "html", required: false, options: {} },
      ],
      autoMerge: true,
    });
    baseId = base.id;

    // Fixed seed spanning a month boundary in UTC. Two records land exactly on
    // the window edges to pin inclusive-start/exclusive-end, and one is
    // deliberately just outside each side.
    const records: Array<Record<string, unknown>> = [
      { title: "before-window", when: "2026-02-27T23:59:59.000Z" },
      { title: "on-gte-edge", when: "2026-02-28T00:00:00.000Z" },
      { title: "mid-window-1", when: "2026-03-15T12:00:00.000Z" },
      { title: "mid-window-2", when: "2026-03-31T23:00:00.000Z" },
      { title: "on-lt-edge", when: "2026-03-31T23:59:59.999Z" },
      { title: "at-lt-boundary-excluded", when: "2026-04-01T00:00:00.000Z" },
      { title: "after-window", when: "2026-04-02T00:00:00.000Z" },
      { title: "no-date-value", when: null },
    ];
    const bulk = await client.bases.createBulkChangeRequest({
      baseId,
      records,
      message: "Seed events",
    });
    await client.changeRequests.review({ changeRequestIds: [bulk.id], verdict: "approved" });
    await client.changeRequests.merge({ changeRequestIds: [bulk.id] });
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  const titlesFor = async (gte: string, lt: string): Promise<string[]> => {
    const page = await client.records.listPage({
      baseId,
      dateRange: { fieldSlug: "when", gte, lt },
      pageSize: 100,
    });
    return page.records.map((record) => String(record.headCommit.payload.title)).sort();
  };

  it("includes the gte edge and everything through the window, excludes lt", async () => {
    const titles = await titlesFor("2026-02-28T00:00:00.000Z", "2026-04-01T00:00:00.000Z");
    expect(titles).toEqual(["on-gte-edge", "mid-window-1", "mid-window-2", "on-lt-edge"].sort());
  });

  it("excludes a record exactly on the lt boundary (half-open interval)", async () => {
    const titles = await titlesFor("2026-04-01T00:00:00.000Z", "2026-04-02T00:00:00.000Z");
    expect(titles).toEqual(["at-lt-boundary-excluded"]);
    // The excluded-by-lt record from the window above must not leak in here
    // either — confirms it is genuinely excluded, not just sorted elsewhere.
    expect(titles).not.toContain("on-lt-edge");
  });

  it("excludes records with no value for the date field", async () => {
    // A window wide enough to contain every dated record.
    const titles = await titlesFor("2000-01-01T00:00:00.000Z", "2100-01-01T00:00:00.000Z");
    expect(titles).not.toContain("no-date-value");
    expect(titles).toHaveLength(7);
  });

  it("an empty window returns nothing, not everything", async () => {
    const titles = await titlesFor("2026-03-16T00:00:00.000Z", "2026-03-16T00:00:00.000Z");
    expect(titles).toEqual([]);
  });

  it("total and totalPages reflect only the windowed set, not the whole Base", async () => {
    const page = await client.records.listPage({
      baseId,
      dateRange: {
        fieldSlug: "when",
        gte: "2026-03-01T00:00:00.000Z",
        lt: "2026-04-01T00:00:00.000Z",
      },
      pageSize: 2,
    });
    // mid-window-1, mid-window-2, on-lt-edge = 3 records in March.
    expect(page.total).toBe(3);
    expect(page.totalPages).toBe(2);
  });

  it("dateRange composes with an ad-hoc filter (AND)", async () => {
    // html contains can never be pushed down, forcing the exact-eval path —
    // dateRange must still narrow correctly there too, since recordFilters is
    // shared by every branch of listRecordsPage.
    const page = await client.records.listPage({
      baseId,
      dateRange: {
        fieldSlug: "when",
        gte: "2026-03-01T00:00:00.000Z",
        lt: "2026-04-01T00:00:00.000Z",
      },
      filters: [{ fieldSlug: "notes", fieldType: "html", operator: "not_empty" }],
      pageSize: 100,
    });
    // None of the March records were given notes, so this must be empty —
    // proves the AND is real, not silently dropped.
    expect(page.records).toEqual([]);
  });

  it("rejects a dateRange field that isn't a date type", async () => {
    await expect(
      client.records.listPage({
        baseId,
        dateRange: {
          fieldSlug: "title",
          gte: "2026-01-01T00:00:00.000Z",
          lt: "2026-02-01T00:00:00.000Z",
        },
      }),
    ).rejects.toThrow(/Cannot scope by a text field/);
  });

  it("404s on a dateRange field the Base doesn't have", async () => {
    await expect(
      client.records.listPage({
        baseId,
        dateRange: {
          fieldSlug: "nope",
          gte: "2026-01-01T00:00:00.000Z",
          lt: "2026-02-01T00:00:00.000Z",
        },
      }),
    ).rejects.toThrow(/Field not found/);
  });
});
