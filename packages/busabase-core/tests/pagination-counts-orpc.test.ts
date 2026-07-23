import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * Pagination + counts: the dashboard must be able to see EVERY record / change
 * request, not just the first page, and its inbox tab badges must reflect the
 * whole space (not a capped page). Exercises records.count / records.listPaged
 * and changeRequests.counts / changeRequests.listPaged through the real router.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("Pagination & counts — oRPC integration", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-paging-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-paging-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    const base = await client.bases.create({
      slug: "contacts",
      name: "Contacts",
      fields: [{ slug: "name", name: "Name", type: "text", required: true, options: {} }],
      autoMerge: true,
    });
    baseId = base.id;
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  // Submit as the local editor — the same submittedBy the dashboard sends, so
  // these change requests land in the "created" (mine) bucket like real ones.
  const proposeRecord = async (name: string): Promise<string> => {
    const cr = await client.bases.createChangeRequest({
      baseId,
      fields: { name },
      submittedBy: "local-editor",
      autoMerge: false,
    });
    return cr.id;
  };

  it("counts every record and pages through all of them via the cursor", async () => {
    // One bulk CR carrying 120 record creates, merged as a unit → 120 records,
    // which is more than a single 50-record page.
    const records = Array.from({ length: 120 }, (_, index) => ({ name: `Contact ${index + 1}` }));
    const cr = await client.bases.createBulkChangeRequest({
      baseId,
      records,
      message: "Import 120",
    });
    await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
    await client.changeRequests.merge({ changeRequestId: cr.id });

    const { total } = await client.records.count({ baseId });
    expect(total).toBe(120);

    const seen = new Set<string>();
    const pageSizes: number[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 10; guard++) {
      const page = await client.records.listPaged({ baseId, limit: 50, cursor });
      pageSizes.push(page.records.length);
      for (const record of page.records) {
        seen.add(record.id);
      }
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    // Every record reachable; pages are 50 / 50 / 20 with a null cursor at the end.
    expect(seen.size).toBe(120);
    expect(pageSizes).toEqual([50, 50, 20]);
  });

  it("counts change requests per inbox tab as they move through the workflow", async () => {
    const before = await client.changeRequests.counts();
    const a = await proposeRecord("A"); // stays in_review
    const b = await proposeRecord("B"); // approved → merged
    const c = await proposeRecord("C"); // review "rejected" == request changes
    const d = await proposeRecord("D"); // closed → terminal rejected
    await client.changeRequests.review({ changeRequestId: b, verdict: "approved" });
    // A "rejected" review verdict requests changes (status: changes_requested);
    // terminal rejection is a close.
    await client.changeRequests.review({ changeRequestId: c, verdict: "rejected" });
    await client.changeRequests.close({ changeRequestId: d });

    const after = await client.changeRequests.counts();
    expect(after.review).toBe(before.review + 1); // only a
    expect(after.approved).toBe(before.approved + 1); // b
    expect(after.changes).toBe(before.changes + 1); // c
    expect(after.rejected).toBe(before.rejected + 1); // d (closed)
    // `created` is scoped to the acting user (local editor) — a, b, c, d count.
    expect(after.created).toBe(before.created + 4);

    await client.changeRequests.merge({ changeRequestId: b });
    const merged = await client.changeRequests.counts();
    expect(merged.approved).toBe(before.approved);
    expect(merged.merged).toBe(before.merged + 1);
    // `a` is intentionally left in_review for the pagination test below.
    void a;
  });

  it("pages a status-filtered change request list until the cursor runs out", async () => {
    // 30 more in_review change requests (plus `a` from the previous test).
    for (let index = 0; index < 30; index++) {
      await proposeRecord(`Queue ${index}`);
    }
    const counts = await client.changeRequests.counts();

    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let guard = 0; guard < 20; guard++) {
      const page = await client.changeRequests.listPaged({
        status: ["in_review"],
        limit: 12,
        cursor,
      });
      for (const changeRequest of page.changeRequests) {
        expect(changeRequest.status).toBe("in_review");
        seen.add(changeRequest.id);
      }
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    // Paging the filter reaches exactly the in_review total (>1 page).
    expect(seen.size).toBe(counts.review);
    expect(seen.size).toBeGreaterThan(12);
  });
});
