import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildActivityItemsFromVOs } from "../src/logic/activity";
import { busabaseRouter } from "../src/router";

/**
 * `activity.listPaged` must keyset-paginate the merged activity feed (change
 * requests + operations + records + audit events) WITHOUT dropping, duplicating,
 * or reordering events across page boundaries — reproducing exactly the set the
 * old client-side `buildActivityEvents` produced. This is the safety net for the
 * 4-source keyset + stable merge.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type AnyItem = Awaited<ReturnType<Client["activity"]["listPaged"]>>["items"][number];

// Stable identity for one feed event — a minimal structural view that both the
// paged output items (z.output) and the reference items (z.input) satisfy.
type FeedItem =
  | { kind: "change_request"; timestamp: string; changeRequest: { id: string } }
  | { kind: "operation"; timestamp: string; operationId: string }
  | { kind: "record"; timestamp: string; record: { id: string } }
  | { kind: "audit"; timestamp: string; auditEvent: { id: string } };
const keyOf = (item: FeedItem): string => {
  if (item.kind === "change_request") return `cr:${item.changeRequest.id}`;
  if (item.kind === "operation") return `op:${item.operationId}`;
  if (item.kind === "record") return `record:${item.record.id}`;
  return `audit:${item.auditEvent.id}`;
};

describe("activity.listPaged — keyset merge parity", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-activity-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-activity-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "log",
      name: "Log",
      fields: [
        { slug: "name", name: "Name", type: "text", required: true, options: {} },
        { slug: "score", name: "Score", type: "number", required: false, options: {} },
      ],
      autoMerge: true,
    });
    baseId = base.id;

    // CR1: bulk-create 6 records → merge (1 CR, 6 operations, 6 records + audit).
    const cr1 = await client.bases.createBulkChangeRequest({
      baseId,
      records: Array.from({ length: 6 }, (_, i) => ({ name: `r${i}`, score: i })),
      message: "seed",
    });
    await client.changeRequests.review({ changeRequestId: cr1.id, verdict: "approved" });
    await client.changeRequests.merge({ changeRequestId: cr1.id });

    // CR2: one more record via a single-record CR → merge (1 CR, 1 operation).
    const cr2 = await client.bases.createChangeRequest({ baseId, fields: { name: "extra" } });
    await client.changeRequests.review({ changeRequestId: cr2.id, verdict: "approved" });
    await client.changeRequests.merge({ changeRequestId: cr2.id });

    // Read a couple records → record.viewed audit events (more feed variety).
    const page = await client.records.listPaged({ baseId, limit: 100 });
    for (const record of page.records.slice(0, 2)) {
      await client.records.get({ recordId: record.id });
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

  const pageAll = async (limit: number): Promise<AnyItem[]> => {
    const collected: AnyItem[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 100; guard++) {
      const page = await client.activity.listPaged({ limit, cursor });
      collected.push(...page.items);
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }
    return collected;
  };

  it("pages through the whole feed with no dup, no drop, newest-first", async () => {
    // Reference: the full feed built from the complete (active) VO set.
    const [changeRequests, recordsPage, auditEvents] = await Promise.all([
      client.changeRequests.list({}),
      client.records.listPaged({ baseId, limit: 100 }),
      client.auditEvents.list({}),
    ]);
    const referenceKeys = new Set(
      buildActivityItemsFromVOs(changeRequests, recordsPage.records, auditEvents).map(keyOf),
    );
    expect(referenceKeys.size).toBeGreaterThan(10); // sanity: a real feed

    const paged = await pageAll(5); // small page → forces many keyset boundaries
    const pagedKeys = paged.map(keyOf);

    // 1. No duplicate across page boundaries.
    expect(pagedKeys.length).toBe(new Set(pagedKeys).size);
    // 2. Complete + no extra: the paged set equals the reference set.
    expect(new Set(pagedKeys)).toEqual(referenceKeys);
    // 3. Newest-first: timestamps are non-increasing.
    for (let i = 1; i < paged.length; i++) {
      expect(new Date(paged[i].timestamp).getTime()).toBeLessThanOrEqual(
        new Date(paged[i - 1].timestamp).getTime(),
      );
    }
  });

  it("returns identical results regardless of page size", async () => {
    const big = (await pageAll(100)).map(keyOf); // one page (seed < 100 events)
    const small = (await pageAll(3)).map(keyOf);
    // Same events in the same order, whether one page or many.
    expect(small).toEqual(big);
  });
});
