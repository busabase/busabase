import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { getDb } from "../src/db";
import { busabaseAuditEvents, busabaseCommits, busabaseOperations } from "../src/db/schema";
import { buildActivityEventFromItem } from "../src/domains/dashboard/helpers/activity-events";
import { coreMessagesEn } from "../src/i18n/messages";
import { busabaseRouter } from "../src/router";

describe("record history: bounded preview and paged activity", () => {
  let originalCwd = "";
  let dataDir = "";
  let storageDir = "";
  const client = createRouterClient(busabaseRouter);
  let recordId = "";
  let otherRecordId = "";
  let nodeId = "";
  let initialOperationId = "";
  const historyIds: string[] = [];
  const tiedAt = new Date("2030-01-01T00:00:00.000Z");

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(path.resolve(__dirname, "../../../apps/busabase"));
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-record-history-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-record-history-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    const base = await client.bases.create({
      slug: "record-history",
      name: "Record history",
      fields: [
        { slug: "name", name: "Name", type: "text" },
        { slug: "body", name: "Body", type: "text" },
      ],
      autoMerge: true,
    });
    nodeId = base.nodeId;
    const initial = await client.bases.createBulkChangeRequest({
      baseId: base.id,
      records: Array.from({ length: 8 }, (_, index) => ({ name: `record-${index}` })),
      autoMerge: false,
    });
    await client.changeRequests.review({ changeRequestIds: [initial.id], verdict: "approved" });
    await client.changeRequests.merge({ changeRequestIds: [initial.id] });
    const merged = await client.changeRequests.get({ changeRequestId: initial.id });
    const operations = merged.operations;
    const target = operations[7].mergedRecordId;
    const other = operations[0].mergedRecordId;
    if (!target || !other) throw new Error("Expected merged bulk records");
    recordId = target;
    otherRecordId = other;
    initialOperationId = operations[7].id;
    historyIds.push(initial.id);
    for (let index = 0; index < 6; index++) {
      const changeRequest = await client.records.changeRequest({
        recordId,
        operation: "update",
        fields: { name: `updated-${index}` },
        autoMerge: false,
      });
      historyIds.push(changeRequest.id);
    }
    const db = await getDb();
    await db
      .update(busabaseOperations)
      .set({ updatedAt: tiedAt })
      .where(inArray(busabaseOperations.changeRequestId, historyIds));
    // Many operations in one CR must not consume the preview's five CR slots.
    const [operation] = await db
      .select()
      .from(busabaseOperations)
      .where(eq(busabaseOperations.changeRequestId, historyIds[historyIds.length - 1]))
      .limit(1);
    await db.insert(busabaseOperations).values(
      Array.from({ length: 12 }, (_, index) => ({
        ...operation,
        id: `opr_history_extra_${String(index).padStart(2, "0")}`,
        position: index + 1,
      })),
    );
    await db.insert(busabaseAuditEvents).values([
      ...Array.from({ length: 60 }, (_, index) => ({
        id: `aud_history_${String(index).padStart(2, "0")}`,
        spaceId: LOCAL_SPACE_ID,
        action: "record.viewed",
        actorId: "local-producer",
        baseId: base.id,
        recordId,
        createdAt: tiedAt,
      })),
      {
        id: "aud_other_record",
        spaceId: LOCAL_SPACE_ID,
        action: "record.viewed",
        actorId: "local-producer",
        baseId: base.id,
        recordId: otherRecordId,
        createdAt: tiedAt,
      },
      {
        id: "aud_other_space",
        spaceId: "spc_other",
        action: "record.viewed",
        actorId: "local-producer",
        baseId: base.id,
        recordId,
        createdAt: tiedAt,
      },
    ]);
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir])
      if (dir) await rm(dir, { recursive: true, force: true });
  });

  it("bounds distinct CRs before hydration and limits record operations", async () => {
    const all = await client.records.listChangeRequests({ recordId });
    expect(all).toHaveLength(7);
    const preview = await client.records.listChangeRequests({ recordId, limit: 5 });
    expect(preview.map((cr) => cr.id)).toEqual([...historyIds].sort().reverse().slice(0, 5));
    expect(new Set(preview.map((cr) => cr.id)).size).toBe(5);
    for (const cr of preview) {
      expect(cr.operations.length).toBeLessThanOrEqual(5);
      expect(
        cr.operations.every((op) =>
          [op.targetRecordId, op.sourceRecordId, op.mergedRecordId].includes(recordId),
        ),
      ).toBe(true);
    }
    const bulkPreview = await client.records.listChangeRequests({
      recordId: otherRecordId,
      limit: 5,
    });
    expect(bulkPreview[0].operationCount).toBe(8);
    expect(bulkPreview[0].operations).toHaveLength(1);
    expect(bulkPreview[0].reviews).toHaveLength(0);
    expect(all.find((cr) => cr.id === historyIds[0])?.reviews).toHaveLength(1);
  });

  const pageAll = async (limit: number) => {
    const items: Awaited<ReturnType<typeof client.activity.listForRecordPaged>>["items"] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 100; guard++) {
      const page = await client.activity.listForRecordPaged({ recordId, limit, cursor });
      expect(page.items.length).toBeLessThanOrEqual(limit);
      items.push(...page.items);
      if (!page.nextCursor) return items;
      expect(page.nextCursor).not.toBe(cursor);
      cursor = page.nextCursor;
    }
    throw new Error("Pagination did not terminate");
  };

  it("pages beyond 50 with stable ties, exact operation hydration and record/space isolation", async () => {
    const large = await pageAll(100);
    const small = await pageAll(7);
    const key = (item: (typeof small)[number]) =>
      item.kind === "operation"
        ? item.operationId
        : item.kind === "audit"
          ? item.auditEvent.id
          : "unexpected";
    expect(small.map(key)).toEqual(large.map(key));
    expect(small.length).toBeGreaterThan(50);
    expect(new Set(small.map(key)).size).toBe(small.length);
    expect(small.map(key)).toContain(initialOperationId);
    expect(small.map(key)).not.toContain("aud_other_record");
    expect(small.map(key)).not.toContain("aud_other_space");
    for (let index = 1; index < small.length; index++)
      expect(small[index].timestamp <= small[index - 1].timestamp).toBe(true);
    for (const item of small)
      if (item.kind === "operation") {
        expect(
          item.changeRequest.operations.some((operation) => operation.id === item.operationId),
        ).toBe(true);
        expect(item.changeRequest.operations.length).toBeLessThanOrEqual(7);
        expect(item.changeRequest.reviews).toHaveLength(0);
        if (item.operationId === initialOperationId)
          expect(item.changeRequest.operationCount).toBe(8);
      }
  });

  it("keeps audit pages compact for large records while retaining complete record reads", async () => {
    const fullRecord = await client.records.get({ recordId });
    const body = "Large record body. ".repeat(34_000);
    expect(Buffer.byteLength(body)).toBeGreaterThan(600_000);
    const db = await getDb();
    await db
      .update(busabaseCommits)
      .set({ payload: { ...fullRecord.headCommit.payload, body } })
      .where(eq(busabaseCommits.id, fullRecord.headCommitId));
    await db.insert(busabaseAuditEvents).values(
      Array.from({ length: 50 }, (_, index) => ({
        id: `aud_large_record_${String(index).padStart(2, "0")}`,
        spaceId: LOCAL_SPACE_ID,
        action: "record.viewed",
        actorId: "local-producer",
        baseId: fullRecord.baseId,
        recordId,
        createdAt: new Date("2031-01-01T00:00:00.000Z"),
      })),
    );
    const page = await client.activity.listForRecordPaged({ recordId, limit: 50 });
    expect(page.items).toHaveLength(50);
    expect(Buffer.byteLength(JSON.stringify(page))).toBeLessThan(200_000);
    for (const item of page.items) {
      expect(item.kind).toBe("audit");
      if (item.kind !== "audit") throw new Error("Expected only recent audits");
      expect(item.record?.base.slug).toBe("record-history");
      expect(item.record?.base.name).toBe("Record history");
      expect(item.record?.base.fields).toEqual([]);
      expect(item.record?.fieldUsers).toEqual({});
      expect(item.record?.headCommit.payload.body).not.toBe(body);
      expect(buildActivityEventFromItem(item, coreMessagesEn)?.href).toBe(
        `/base/record-history/${recordId}`,
      );
    }
    const fullAfter = await client.records.get({ recordId });
    expect(fullAfter.headCommit.payload.body).toBe(body);
    expect(fullAfter.base.fields.map((field) => field.slug)).toContain("body");
  });

  it("checks the record's node permission before returning any history", async () => {
    await client.nodes.updateVisibility({ nodeId, visibility: "private" });
    await runWithBusabaseContext(
      {
        spaceId: LOCAL_SPACE_ID,
        actorId: "history-member",
        isSpaceManager: false,
        permissionLevel: "read",
      },
      async () => {
        await expect(client.records.listChangeRequests({ recordId, limit: 5 })).rejects.toThrow();
        await expect(client.activity.listForRecordPaged({ recordId, limit: 5 })).rejects.toThrow();
      },
    );
    const db = await getDb();
    expect(
      await db
        .select()
        .from(busabaseOperations)
        .where(
          and(
            eq(busabaseOperations.spaceId, LOCAL_SPACE_ID),
            eq(busabaseOperations.mergedRecordId, recordId),
          ),
        ),
    ).not.toHaveLength(0);
  });
});
