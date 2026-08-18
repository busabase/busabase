import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * An inbox page containing BULK change requests.
 *
 * A bulk change request carries up to 1000 record proposals as 1000 operations,
 * but a list row only ever renders a handful plus an "N operations" total. The
 * list used to read every operation of every change request on the page and then
 * slice in JS — so a page holding a few bulk imports pulled tens of thousands of
 * rows out of the database to display five of them each.
 *
 * The cap is now applied in SQL. This pins the two things that must survive that
 * change: the row still reports the TRUE operation total, and the embedded
 * operations are still the FIRST ones in (position, createdAt) order — a
 * top-N-per-group rewrite is exactly the kind of change that can silently
 * reorder or mix rows between groups.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const BULK_SIZE = 300;
const BULK_CRS = 3;

describe("inbox list with bulk change requests", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-bulk-ops-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-bulk-ops-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "bulk-ops",
      name: "Bulk Ops",
      fields: [
        { slug: "name", name: "Name", type: "text", required: true, options: {} },
        { slug: "seq", name: "Seq", type: "number", options: {} },
      ],
      autoMerge: true,
    });
    baseId = base.id;

    for (let c = 0; c < BULK_CRS; c++) {
      await client.bases.createBulkChangeRequest({
        baseId,
        records: Array.from({ length: BULK_SIZE }, (_, i) => ({
          name: `Bulk ${c}-${i}`,
          seq: i,
        })),
        message: `bulk ${c}`,
      });
    }
  }, 300_000);

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports the true operation total while embedding only a preview", async () => {
    const page = await client.changeRequests.list({ limit: 20 } as never);
    const bulk = page.changeRequests.filter((cr) => cr.operationCount >= BULK_SIZE);
    expect(bulk).toHaveLength(BULK_CRS);
    for (const cr of bulk) {
      // The badge the UI renders must be the real total, not the preview length.
      expect(cr.operationCount).toBe(BULK_SIZE);
      expect(cr.operations.length).toBeLessThanOrEqual(5);
      expect(cr.operations.length).toBeGreaterThan(0);
      expect(cr.primaryOperation?.id).toBe(cr.operations[0]?.id);
    }
  });

  it("previews the FIRST operations of each change request, not an arbitrary set", async () => {
    const page = await client.changeRequests.list({ limit: 20 } as never);
    const bulk = page.changeRequests.filter((cr) => cr.operationCount >= BULK_SIZE);
    for (const cr of bulk) {
      // Seeded in ascending `seq`, so the preview must start at 0 and stay in order.
      const seqs = cr.operations.map((op) => Number(op.headCommit?.payload?.seq));
      expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
      expect(seqs[0]).toBe(0);
      // Every previewed operation must belong to ITS OWN change request — the
      // failure mode a partition-by rewrite can introduce.
      for (const op of cr.operations) {
        expect(op.changeRequestId).toBe(cr.id);
      }
    }
  });

  it("the detail view still returns every operation", async () => {
    const page = await client.changeRequests.list({ limit: 20 } as never);
    const bulk = page.changeRequests.find((cr) => cr.operationCount >= BULK_SIZE);
    if (!bulk) throw new Error("no bulk change request found");
    const detail = await client.changeRequests.get({ changeRequestId: bulk.id } as never);
    expect(detail?.operations.length).toBe(BULK_SIZE);
    expect(detail?.operationCount).toBe(BULK_SIZE);
  });
});
