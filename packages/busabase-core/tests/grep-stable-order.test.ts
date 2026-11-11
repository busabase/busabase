import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb } from "../src/db";
import { busabaseNodes } from "../src/db/schema";
import { busabaseRecords } from "../src/domains/base/schema";
import { busabaseRouter } from "../src/router";

/**
 * Grep answers in a stable order.
 *
 * Records are listed newest-updated first, nodes by position then creation time.
 * Both tie often — a bulk sync stamps every record with one `updatedAt` — and
 * without a last sort key Postgres returned tied rows in whatever order its heap
 * held them, so the same grep answered in a different order from one call to the
 * next. The tests tie the rows on purpose and rewrite them in a shuffled order
 * (an UPDATE moves a row to a new heap position), so heap order and id order
 * disagree.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const SHUFFLE = [3, 0, 4, 1, 5, 2];

describe("grep — stable order for tied rows", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-grep-order-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-grep-order-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
  });

  afterAll(async () => {
    await (await import("../src/db")).closeDb();
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  const recordIds = (result: Awaited<ReturnType<Client["grep"]>>) =>
    result.matches.flatMap((match) => (match.source === "records" ? [match.recordId] : []));
  const nodeIds = (result: Awaited<ReturnType<Client["grep"]>>) =>
    result.matches.flatMap((match) => (match.source === "nodes" ? [match.nodeId] : []));

  it("returns records that share an updatedAt in descending id order, every time", async () => {
    const base = await client.bases.create({
      slug: "grep-order-records",
      name: "Order",
      fields: [{ slug: "title", name: "Title", type: "text" }],
      autoMerge: true,
    });
    if ("status" in base) throw new Error("Expected a materialized Base");
    const ids: string[] = [];
    for (let i = 0; i < SHUFFLE.length; i++) {
      const cr = await client.bases.createChangeRequest({
        baseId: base.id,
        fields: { title: `TIEORDER row ${i}` },
        submittedBy: "agent",
        autoMerge: false,
      });
      await client.changeRequests.review({ changeRequestIds: [cr.id], verdict: "approved" });
      const [merged] = (await client.changeRequests.merge({ changeRequestIds: [cr.id] })).results;
      if (!merged?.record) throw new Error("expected a created record");
      ids.push(merged.record.id);
    }
    const db = await getDb();
    const tied = new Date("2026-01-01T00:00:00.000Z");
    for (const index of SHUFFLE) {
      await db
        .update(busabaseRecords)
        .set({ updatedAt: tied })
        .where(eq(busabaseRecords.id, ids[index] as string));
    }

    const expected = [...ids].sort().reverse();
    for (let run = 0; run < 3; run++) {
      const result = await client.grep({
        pattern: "TIEORDER",
        sources: ["records"],
        scope: { records: { baseIds: [base.id] } },
      });
      expect(recordIds(result)).toEqual(expected);
    }
  });

  it("returns nodes that share a position and creation time in ascending id order, every time", async () => {
    const ids: string[] = [];
    for (let i = 0; i < SHUFFLE.length; i++) {
      const doc = await client.docs.create({
        slug: `grep-order-doc-${i}`,
        name: `Order doc ${i}`,
        body: "NODETIE body\n",
        autoMerge: true,
      });
      if (!("node" in doc) || !doc.node) throw new Error("Expected a materialized Doc");
      ids.push(doc.node.id);
    }
    const db = await getDb();
    const tied = new Date("2026-01-01T00:00:00.000Z");
    for (const index of SHUFFLE) {
      await db
        .update(busabaseNodes)
        .set({ position: 7, createdAt: tied })
        .where(eq(busabaseNodes.id, ids[index] as string));
    }
    const rows = await db
      .select({ id: busabaseNodes.id })
      .from(busabaseNodes)
      .where(inArray(busabaseNodes.id, ids));
    expect(rows).toHaveLength(ids.length);

    const expected = [...ids].sort();
    for (let run = 0; run < 3; run++) {
      const result = await client.grep({
        pattern: "NODETIE",
        sources: ["nodes"],
        scope: { nodes: { nodeIds: ids } },
      });
      expect(nodeIds(result)).toEqual(expected);
    }
  });
});
