import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";
import { busabaseDemoRouter } from "../src/router-demo";

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
type ListedRecord = { id: string; headCommit: { payload: Record<string, unknown> } };

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

// Created one at a time in THIS order, so the default order (createdAt desc) is
// neither ascending nor descending by date — a sort that silently does nothing
// cannot pass for either direction. The last one has no date at all.
const MEETINGS: { title: string; meetingAt?: string }[] = [
  { title: "third", meetingAt: "2026-11-03T09:00:00.000Z" },
  { title: "first", meetingAt: "2026-11-01T09:00:00.000Z" },
  { title: "fourth", meetingAt: "2026-11-04T09:00:00.000Z" },
  { title: "second", meetingAt: "2026-11-02T09:00:00.000Z" },
  { title: "undated" },
];
const ASC = ["first", "second", "third", "fourth", "undated"];
const DESC = ["fourth", "third", "second", "first", "undated"];
const CREATED_DESC = ["undated", "second", "fourth", "first", "third"];

const titles = (records: ListedRecord[]) =>
  records.map((record) => record.headCommit.payload.title);

/**
 * An explicit `sort` with no `fieldType` — the shape the AirApp docs show — used
 * to come back in the default createdAt order for BOTH directions, with no error,
 * on `records.list` and `records.listPage` alike. The type now comes from the
 * Base's schema, and a field the Base does not have is a 400.
 */
describe("records sort without fieldType - oRPC integration (PGLite)", () => {
  let client: Client;
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-sort-field-type-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-sort-field-type-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "meetings",
      name: "Meetings",
      fields: [
        { slug: "title", name: "Title", type: "text", required: true, options: {} },
        // Hyphenated on purpose: the reported field was `meeting-at`.
        { slug: "meeting-at", name: "Meeting at", type: "date", required: false, options: {} },
      ],
      autoMerge: true,
    });
    baseId = base.id;

    for (const meeting of MEETINGS) {
      const cr = await client.bases.createBulkChangeRequest({
        baseId,
        records: [
          {
            title: meeting.title,
            ...(meeting.meetingAt ? { "meeting-at": meeting.meetingAt } : {}),
          },
        ],
        message: `Seed ${meeting.title}`,
      });
      await client.changeRequests.review({ changeRequestIds: [cr.id], verdict: "approved" });
      await client.changeRequests.merge({ changeRequestIds: [cr.id] });
      // Distinct createdAt per record, so the default order is the creation order.
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("the seed's default order is neither date order (guards the test itself)", async () => {
    expect(titles((await client.records.list({ baseId })).records)).toEqual(CREATED_DESC);
  });

  for (const [direction, expected] of [
    ["asc", ASC],
    ["desc", DESC],
  ] as const) {
    it(`records.list sorts a date field ${direction} when fieldType is omitted`, async () => {
      const page = await client.records.list({
        baseId,
        sort: { fieldSlug: "meeting-at", direction },
      });
      expect(titles(page.records)).toEqual(expected);
    });

    it(`records.list keyset-pages a date sort ${direction} with fieldType omitted`, async () => {
      const seen: unknown[] = [];
      let cursor: string | undefined;
      for (let guard = 0; guard < 10; guard++) {
        const page = await client.records.list({
          baseId,
          limit: 2,
          cursor,
          sort: { fieldSlug: "meeting-at", direction },
        });
        seen.push(...titles(page.records));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }
      expect(seen).toEqual(expected);
    });

    it(`records.listPage sorts a date field ${direction} when fieldType is omitted`, async () => {
      const page = await client.records.listPage({
        baseId,
        sort: { fieldSlug: "meeting-at", direction },
      });
      expect(titles(page.records)).toEqual(expected);
    });
  }

  it("omitting fieldType gives exactly what passing the real type gives", async () => {
    for (const direction of ["asc", "desc"] as const) {
      const omitted = await client.records.listPage({
        baseId,
        sort: { fieldSlug: "meeting-at", direction },
      });
      const explicit = await client.records.listPage({
        baseId,
        sort: { fieldSlug: "meeting-at", fieldType: "date", direction },
      });
      expect(omitted.records.map((record) => record.id)).toEqual(
        explicit.records.map((record) => record.id),
      );
    }
  });

  it("a caller-supplied fieldType still wins over the schema's", async () => {
    // How a formula with numeric results gets sorted: its caller says "number"
    // and the schema says "formula". Here a text override leaves the default
    // order, exactly as an unsortable type always has.
    const page = await client.records.listPage({
      baseId,
      sort: { fieldSlug: "meeting-at", fieldType: "text", direction: "asc" },
    });
    expect(titles(page.records)).toEqual(CREATED_DESC);
  });

  it("an unknown sort field is a 400 on records.list and records.listPage, not the default order", async () => {
    const sort = { fieldSlug: "meeting_at", direction: "asc" as const };
    await expect(client.records.list({ baseId, sort })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining('no field "meeting_at"'),
    });
    await expect(client.records.listPage({ baseId, sort })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("meeting-at"),
    });
    // ...even with a fieldType: the field is still not there to sort by.
    await expect(
      client.records.list({ baseId, sort: { ...sort, fieldType: "date" } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("records.list across the whole space needs fieldType, since a slug names no single field", async () => {
    await expect(
      client.records.list({ sort: { fieldSlug: "meeting-at", direction: "asc" } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("baseId") });
    const withType = await client.records.list({
      limit: 100,
      sort: { fieldSlug: "meeting-at", fieldType: "date", direction: "asc" },
    });
    // Other Bases' records (if the space has any) have no such field and trail.
    expect(titles(withType.records.filter((record) => record.baseId === baseId))).toEqual(ASC);
  });
});

describe("records.listPage sort without fieldType - demo mode", () => {
  const client = createRouterClient(busabaseDemoRouter);

  it("resolves the type from the demo Base's schema, and rejects an unknown field", async () => {
    const bases = await client.bases.list({});
    // Any demo Base with a number field whose values are not already in order.
    let checked = false;
    for (const base of bases) {
      const numberField = base.fields.find((field) => field.type === "number");
      if (!numberField) continue;
      const plain = await client.records.listPage({ baseId: base.id, pageSize: 100 });
      const values = plain.records
        .map((record) => record.headCommit.payload[numberField.slug])
        .filter((value): value is number => typeof value === "number");
      const ascending = [...values].sort((a, b) => a - b);
      if (values.length < 3 || JSON.stringify(values) === JSON.stringify(ascending)) continue;

      const sorted = await client.records.listPage({
        baseId: base.id,
        pageSize: 100,
        sort: { fieldSlug: numberField.slug, direction: "asc" },
      });
      const sortedValues = sorted.records
        .map((record) => record.headCommit.payload[numberField.slug])
        .filter((value): value is number => typeof value === "number");
      expect(sortedValues).toEqual(ascending);

      await expect(
        client.records.listPage({
          baseId: base.id,
          sort: { fieldSlug: "no-such-field", direction: "asc" },
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      checked = true;
      break;
    }
    expect(checked).toBe(true);
  });
});
