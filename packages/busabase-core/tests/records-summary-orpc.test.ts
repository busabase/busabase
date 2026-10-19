import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { createRouterClient, implement } from "@orpc/server";
import { busabaseContract } from "busabase-contract/contract/busabase";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LIST_OMITTED_LONG_TEXT_VALUE } from "../src/domains/dashboard/utils/list-payload-preview";
import { busabaseRouter } from "../src/router";

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const HUGE_BODY = "x".repeat(200_000);

describe("records.list summary projection", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-record-summary-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-record-summary-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "reports",
      name: "Reports",
      fields: [
        { slug: "name", name: "Name", type: "text", required: true, options: {} },
        { slug: "body", name: "Body", type: "longtext", options: {} },
        { slug: "rank", name: "Rank", type: "number", options: {} },
      ],
      autoMerge: true,
    });
    baseId = base.id;

    const changeRequest = await client.bases.createBulkChangeRequest({
      baseId,
      records: [
        { name: "First", body: HUGE_BODY, rank: 2 },
        { name: "Second", body: HUGE_BODY, rank: 1 },
        { name: "Archived", body: HUGE_BODY, rank: 3 },
      ],
      message: "Seed reports",
    });
    await client.changeRequests.review({
      changeRequestIds: [changeRequest.id],
      verdict: "approved",
    });
    await client.changeRequests.merge({ changeRequestIds: [changeRequest.id] });

    const all = await client.records.list({ baseId, limit: 10 });
    const archived = all.records.find((record) => record.headCommit.payload.name === "Archived");
    if (!archived) throw new Error("Archived fixture missing");
    const deleteRequest = await client.records.changeRequest({
      operation: "delete",
      recordId: archived.id,
    });
    await client.changeRequests.review({
      changeRequestIds: [deleteRequest.id],
      verdict: "approved",
    });
    await client.changeRequests.merge({ changeRequestIds: [deleteRequest.id] });
  }, 180_000);

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("preserves complete values by default and makes opted-in active pages compact", async () => {
    const full = await client.records.list({ baseId, limit: 10 });
    const summary = await client.records.list({ baseId, limit: 10, summary: true });
    const explicitFull = await client.records.list({ baseId, limit: 10, summary: false });

    expect(full.records).toHaveLength(2);
    expect(summary.records.map((record) => record.id)).toEqual(
      full.records.map((record) => record.id),
    );
    expect(explicitFull).toEqual(full);
    expect(full.records[0]?.headCommit.payload.body).toBe(HUGE_BODY);
    expect(full.records[0]?.base.fields.length).toBe(3);
    expect(JSON.stringify(full).length).toBeGreaterThan(400_000);
    expect(JSON.stringify(summary).length).toBeLessThan(20_000);
    for (const record of summary.records) {
      expect(record.headCommit.payload.body).toBe(LIST_OMITTED_LONG_TEXT_VALUE);
      expect(record.headCommit.payload.name).toMatch(/First|Second/);
      expect(record.base.fields).toEqual([]);
      expect((await client.records.get({ recordId: record.id })).headCommit.payload.body).toBe(
        HUGE_BODY,
      );
    }
  }, 120_000);

  it("uses the same projection for the sorted and archived list paths", async () => {
    const sorted = await client.records.list({
      baseId,
      limit: 10,
      summary: true,
      sort: { fieldSlug: "rank", fieldType: "number", direction: "asc" },
    });
    expect(sorted.records.map((record) => record.headCommit.payload.name)).toEqual([
      "Second",
      "First",
    ]);
    expect(
      sorted.records.every(
        (record) => record.headCommit.payload.body === LIST_OMITTED_LONG_TEXT_VALUE,
      ),
    ).toBe(true);

    const archivedFull = await client.records.list({ baseId, status: "archived", limit: 10 });
    const archivedSummary = await client.records.list({
      baseId,
      status: "archived",
      limit: 10,
      summary: true,
    });
    expect(archivedFull.records).toHaveLength(1);
    expect(archivedFull.records[0]?.headCommit.payload.body).toBe(HUGE_BODY);
    expect(archivedSummary.records[0]?.headCommit.payload.body).toBe(LIST_OMITTED_LONG_TEXT_VALUE);
    expect(JSON.stringify(archivedSummary).length).toBeLessThan(10_000);
  }, 120_000);

  it("parses summary=true and summary=false through the public GET query", async () => {
    let parsedSummary: boolean | undefined;
    const handler = new OpenAPIHandler({
      records: {
        list: implement(busabaseContract).records.list.handler(async ({ input }) => {
          parsedSummary = input.summary;
          return { records: [], nextCursor: null };
        }),
      },
    });
    const fetchPage = async (summary: string) => {
      const request = new Request(
        `http://localhost/api/v1/records?baseId=${baseId}&limit=10&summary=${summary}`,
      );
      const result = await handler.handle(request, { context: {} });
      if (!result.matched) throw new Error("GET /records did not match");
      expect(result.response.status).toBe(200);
      expect(await result.response.json()).toEqual({ records: [], nextCursor: null });
      return parsedSummary;
    };

    expect(await fetchPage("true")).toBe(true);
    expect(await fetchPage("false")).toBe(false);
  }, 120_000);
});
