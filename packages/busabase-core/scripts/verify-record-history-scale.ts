import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRouterClient } from "@orpc/server";
import { and, eq, sql } from "drizzle-orm";

const main = async () => {
  const fixtureDir = await mkdtemp(path.join(os.tmpdir(), "busabase-history-scale-"));
  process.chdir(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../apps/busabase"),
  );
  process.env.PG_DATABASE_URL = `pglite://${fixtureDir}/db`;
  process.env.STORAGE_URL = `local:${fixtureDir}/storage?base_url=/api/storage`;
  const [{ busabaseRouter }, { getDb, getPgliteClient }, tables, { runWithBusabaseContext }] =
    await Promise.all([
      import("../src/router"),
      import("../src/db"),
      import("../src/db/schema"),
      import("../src/context"),
    ]);
  const client = createRouterClient(busabaseRouter);
  const db = await getDb();
  const pglite = await getPgliteClient();
  const historyCount = 10_000;
  try {
    await runWithBusabaseContext({ actorId: "scale-reviewer", isSpaceManager: true }, async () => {
      const base = await client.bases.create({
        slug: "history-scale",
        name: "Customer history acceptance",
        fields: [
          { slug: "name", name: "Name", type: "text", required: true },
          { slug: "revision", name: "Revision", type: "number" },
          { slug: "note", name: "Note", type: "longtext" },
        ],
        autoMerge: true,
      });
      assert("fields" in base, "Create must materialize a base");
      const record = await client.bases.createChangeRequest({
        baseId: base.id,
        fields: { name: "Scale customer", revision: 0, note: "Acceptance fixture" },
        autoMerge: true,
      });
      assert("headCommit" in record, "Create must materialize a record");
      const template = await client.records.changeRequest({
        recordId: record.id,
        operation: "update",
        fields: { revision: 1, note: "Large historical note. ".repeat(800) },
        autoMerge: false,
      });
      const [cr] = await db
        .select()
        .from(tables.busabaseChangeRequests)
        .where(eq(tables.busabaseChangeRequests.id, template.id));
      const [operation] = await db
        .select()
        .from(tables.busabaseOperations)
        .where(eq(tables.busabaseOperations.changeRequestId, template.id));
      const [commit] = await db
        .select()
        .from(tables.busabaseCommits)
        .where(eq(tables.busabaseCommits.id, operation.headCommitId));
      const startedAt = Date.now();
      const key = (index: number) => String(index).padStart(5, "0");
      // Clone a production-written graph into a synthetic read-load fixture.
      // This measures history reads, not the throughput of 10,000 merge writes.
      for (let offset = 1; offset < historyCount; offset += 250) {
        const indices = Array.from(
          { length: Math.min(250, historyCount - offset) },
          (_, index) => offset + index,
        );
        const timestamp = (index: number) => new Date(startedAt + Math.floor(index / 3));
        await db.transaction(async (tx) => {
          await tx.insert(tables.busabaseChangeRequests).values(
            indices.map((index) => ({
              ...cr,
              id: `crq_scale_${key(index)}`,
              status: "merged" as const,
              reviewedAt: timestamp(index),
              mergedAt: timestamp(index),
              createdAt: timestamp(index),
              updatedAt: timestamp(index),
              mergeSummary: { recordIds: [record.id] },
            })),
          );
          await tx.insert(tables.busabaseCommits).values(
            indices.map((index) => ({
              ...commit,
              id: `cmt_scale_${key(index)}`,
              operationId: `opr_scale_${key(index)}`,
              parentCommitId: index === 1 ? record.headCommitId : `cmt_scale_${key(index - 1)}`,
              payload: { ...record.headCommit.payload, ...commit.payload, revision: index },
              message: `Update customer revision ${index}`,
              createdAt: timestamp(index),
            })),
          );
          await tx.insert(tables.busabaseOperations).values(
            indices.map((index) => ({
              ...operation,
              id: `opr_scale_${key(index)}`,
              changeRequestId: `crq_scale_${key(index)}`,
              status: "merged",
              mergedRecordId: record.id,
              headCommitId: `cmt_scale_${key(index)}`,
              baseCommitId: index === 1 ? record.headCommitId : `cmt_scale_${key(index - 1)}`,
              createdAt: timestamp(index),
              updatedAt: timestamp(index),
            })),
          );
          await tx.insert(tables.busabaseReviews).values(
            indices.map((index) => ({
              id: `rev_scale_${key(index)}`,
              spaceId: cr.spaceId,
              changeRequestId: `crq_scale_${key(index)}`,
              reviewerId: "scale-reviewer",
              verdict: "approved" as const,
              reason: "Acceptance fixture approval",
              createdAt: timestamp(index),
            })),
          );
        });
        if (offset % 2500 === 1) console.log(`Seeded ${Math.min(offset + 249, 9999)} updates`);
      }
      await db
        .delete(tables.busabaseChangeRequests)
        .where(eq(tables.busabaseChangeRequests.id, cr.id));
      await db
        .update(tables.busabaseRecords)
        .set({
          headCommitId: "cmt_scale_09999",
          updatedAt: new Date(startedAt + 3333),
        })
        .where(eq(tables.busabaseRecords.id, record.id));
      await db
        .update(tables.busabaseFieldValues)
        .set({ valueNumber: 9999, valueText: "9999" })
        .where(
          and(
            eq(tables.busabaseFieldValues.recordId, record.id),
            eq(tables.busabaseFieldValues.fieldSlug, "revision"),
          ),
        );
      await db.execute(sql`analyze busabase_operations`);
      await db.execute(sql`analyze busabase_change_requests`);
      const count = await db
        .select({
          count: sql<number>`count(distinct ${tables.busabaseOperations.changeRequestId})::int`,
        })
        .from(tables.busabaseOperations)
        .where(orRecord(tables.busabaseOperations, record.id));
      assert.equal(count[0].count, historyCount);

      const measure = async <T>(read: () => Promise<T>) => {
        const start = performance.now();
        const output = await read();
        return {
          ms: Math.round((performance.now() - start) * 10) / 10,
          bytes: Buffer.byteLength(JSON.stringify(output)),
          output,
        };
      };
      const preview = await measure(() =>
        client.records.listChangeRequests({ recordId: record.id, limit: 5 }),
      );
      assert.deepEqual(
        preview.output.map((item) => item.id),
        [9999, 9998, 9997, 9996, 9995].map((index) => `crq_scale_${key(index)}`),
      );
      assert(preview.bytes < 100_000, "Preview must not transfer historical field bodies");
      assert(
        preview.output.every((item) => item.operations.length === 1 && item.reviews.length === 0),
      );
      const warmPreviewMs: number[] = [];
      for (let run = 0; run < 10; run++)
        warmPreviewMs.push(
          (
            await measure(() =>
              client.records.listChangeRequests({ recordId: record.id, limit: 5 }),
            )
          ).ms,
        );
      const firstPage = await measure(() =>
        client.activity.listForRecordPaged({ recordId: record.id, limit: 50 }),
      );
      assert.equal(firstPage.output.items.length, 50);
      assert(firstPage.bytes < 1_000_000, "Activity must transfer only page summaries");
      const warmPageMs: number[] = [];
      for (let run = 0; run < 10; run++)
        warmPageMs.push(
          (
            await measure(() =>
              client.activity.listForRecordPaged({ recordId: record.id, limit: 50 }),
            )
          ).ms,
        );

      const seen = new Set<string>();
      const operations = new Set<string>();
      let cursor: string | undefined;
      let pages = 0;
      const walkStartedAt = performance.now();
      for (; pages < 250; pages++) {
        const page = await client.activity.listForRecordPaged({
          recordId: record.id,
          limit: 100,
          cursor,
        });
        if (pages % 20 === 0) console.log(`Verified activity page ${pages + 1}`);
        assert(page.items.length <= 100);
        for (const item of page.items) {
          const id =
            item.kind === "operation"
              ? item.operationId
              : item.kind === "audit"
                ? item.auditEvent.id
                : "unexpected";
          const eventKey = `${item.kind}:${id}`;
          assert(!seen.has(eventKey), `Repeated event: ${eventKey}`);
          seen.add(eventKey);
          if (item.kind === "operation") operations.add(item.operationId);
        }
        if (!page.nextCursor) break;
        assert.notEqual(page.nextCursor, cursor);
        cursor = page.nextCursor;
      }
      assert(pages < 250, "Pagination must terminate");
      assert.equal(operations.size, historyCount);
      assert(record.headCommit.operationId);
      assert(operations.has(record.headCommit.operationId));
      for (let index = 1; index < historyCount; index++)
        assert(operations.has(`opr_scale_${key(index)}`));
      const results = {
        method: "Synthetic rows cloned from a real router write; real PGlite/router reads",
        fixtureDir,
        databaseUrl: process.env.PG_DATABASE_URL,
        baseSlug: base.slug,
        baseId: base.id,
        recordId: record.id,
        historyCount,
        historicalBodyBytes: Buffer.byteLength(String(commit.payload.note)),
        preview: {
          rows: preview.output.length,
          bytes: preview.bytes,
          firstReadMs: preview.ms,
          warmMs: warmPreviewMs,
        },
        activity: {
          rows: firstPage.output.items.length,
          bytes: firstPage.bytes,
          firstReadMs: firstPage.ms,
          warmMs: warmPageMs,
        },
        walk: {
          pages: pages + 1,
          events: seen.size,
          operations: operations.size,
          ms: Math.round(performance.now() - walkStartedAt),
          duplicates: 0,
          missingOperations: 0,
        },
      };
      console.log(JSON.stringify(results, null, 2));
      if (process.env.HISTORY_VERIFY_OUTPUT)
        await writeFile(process.env.HISTORY_VERIFY_OUTPUT, `${JSON.stringify(results, null, 2)}\n`);
    });
  } finally {
    await pglite.close();
    if (process.env.HISTORY_KEEP_FIXTURE !== "1")
      await rm(fixtureDir, { recursive: true, force: true });
  }
};

const orRecord = (
  operations: typeof import("../src/db/schema").busabaseOperations,
  recordId: string,
) =>
  sql`(${operations.targetRecordId} = ${recordId} or ${operations.sourceRecordId} = ${recordId} or ${operations.mergedRecordId} = ${recordId})`;

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
