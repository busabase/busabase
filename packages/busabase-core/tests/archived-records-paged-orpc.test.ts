import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * `bases.listArchivedRecordsPaged` keyset-paginates the "trash" section so a Base
 * with a large soft-deleted history isn't loaded all at once. This pins the
 * keyset: page through every archived record with a small page size and assert no
 * dup / no drop across boundaries, complete coverage, and newest-first order.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const TOTAL = 25;

describe("listArchivedRecordsPaged — keyset pagination", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-archived-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-archived-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "trashy",
      name: "Trashy",
      fields: [{ slug: "name", name: "Name", type: "text", required: true, options: {} }],
      autoMerge: true,
    });
    baseId = base.id;

    const cr = await client.bases.createBulkChangeRequest({
      baseId,
      records: Array.from({ length: TOTAL }, (_, i) => ({ name: `r${i}` })),
      message: "seed",
    });
    await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
    await client.changeRequests.merge({ changeRequestId: cr.id });

    // Archive every record (soft delete) so they land in the trash section:
    // open a delete change request per record, then approve + merge it.
    const page = await client.records.listPaged({ baseId, limit: 100 });
    for (const record of page.records) {
      const deleteCr = await client.records.deleteChangeRequest({ recordId: record.id });
      await client.changeRequests.review({ changeRequestId: deleteCr.id, verdict: "approved" });
      await client.changeRequests.merge({ changeRequestId: deleteCr.id });
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

  const pageAll = async (limit: number) => {
    const collected: Awaited<ReturnType<Client["bases"]["listArchivedRecordsPaged"]>>["records"] =
      [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 50; guard++) {
      const page = await client.bases.listArchivedRecordsPaged({ baseId, limit, cursor });
      collected.push(...page.records);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    return collected;
  };

  it("pages through every archived record with no dup / no drop, newest-first", async () => {
    const rows = await pageAll(10);
    expect(rows.length).toBe(TOTAL);
    expect(new Set(rows.map((r) => r.id)).size).toBe(TOTAL);
    for (const record of rows) {
      expect(record.status).toBe("archived");
    }
    // createdAt is non-increasing across the whole paged stream.
    for (let i = 1; i < rows.length; i++) {
      expect(new Date(rows[i].createdAt).getTime()).toBeLessThanOrEqual(
        new Date(rows[i - 1].createdAt).getTime(),
      );
    }
  });

  it("returns identical results regardless of page size", async () => {
    const big = (await pageAll(100)).map((r) => r.id);
    const small = (await pageAll(3)).map((r) => r.id);
    expect(small).toEqual(big);
  });
});
