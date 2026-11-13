import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { createRouterClient } from "@orpc/server";
import type { DumpTable, ImportTablesVO } from "busabase-contract/domains/dump/types";
import { eq, sql } from "drizzle-orm";
import { resetStorage, storage } from "openlib/storage";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import { closeDb, getDb } from "../src/db";
import { busabaseNodes, busabaseRecords, busabaseViews } from "../src/db/schema";
import { datePreservingColumns } from "../src/domains/dump/logic/import-row-values";
import {
  isRestoreAutomationBlocked,
  markRestoreRootImported,
  restoreActivityKey,
} from "../src/domains/dump/logic/restore-activity";
import {
  RESTORE_BLOB_PART_BYTES,
  RestoreBlobParts,
} from "../src/domains/dump/logic/restore-blob-parts";
import { folderReadmeKey } from "../src/domains/folder/handlers";
import { rootNodeIdForSpace } from "../src/logic/kernel";
import { busabaseRouter } from "../src/router";
import { createExactDumpReplayFixture } from "./helpers/exact-dump-replay";

type Row = Record<string, unknown>;
const sourceTime = "2024-01-02T03:04:05.123456Z";
const archives = new Map<string, ReturnType<typeof createExactDumpReplayFixture>>();
const archiveFor = (spaceId: string) => {
  const archive = archives.get(spaceId);
  if (!archive) throw new Error("Missing frozen source fixture");
  return archive;
};
const preflight = (spaceId: string, sessionId: string) =>
  inSpace(spaceId, () => archiveFor(spaceId).preflight(client, sessionId));
const client = createRouterClient(busabaseRouter);
const inSpace = <T>(spaceId: string, work: () => Promise<T>) =>
  runWithBusabaseContext({ spaceId }, work);
const begin = (
  spaceId: string,
  sourceSpaceId: string,
  resume = false,
  preserveViewMetadata = true,
) => {
  const archive = archiveFor(spaceId);
  if (archive.beginInput().sourceSpaceId !== sourceSpaceId)
    throw new Error("Source fixture identity mismatch");
  return inSpace(spaceId, () => archive.begin(client, { resume, preserveViewMetadata }));
};
const readRoot = async (spaceId: string): Promise<Row> => {
  const db = await getDb();
  const [root] = await db
    .select(datePreservingColumns(busabaseNodes))
    .from(busabaseNodes)
    .where(eq(busabaseNodes.id, rootNodeIdForSpace(spaceId)));
  return root;
};

describe("exact import replay, microsecond dates and guarded root initialization", () => {
  let cwd: string;
  let dataDir: string;
  let storageDir: string;
  let sequence = 0;
  beforeAll(async () => {
    cwd = process.cwd();
    process.chdir(path.resolve(__dirname, "../../../apps/busabase"));
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-replay-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-replay-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    resetStorage();
  });
  afterAll(async () => {
    await closeDb();
    resetStorage();
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    process.chdir(cwd);
    await rm(dataDir, { recursive: true, force: true });
    await rm(storageDir, { recursive: true, force: true });
  });

  const rootArchive = async () => {
    const target = `replay-target-${++sequence}`;
    const source = `replay-source-${sequence}`;
    await inSpace(target, () => client.nodes.list({}));
    const root = {
      ...(await readRoot(target)),
      id: rootNodeIdForSpace(source),
      spaceId: source,
      createdAt: sourceTime,
      updatedAt: sourceTime,
    };
    archives.set(
      target,
      createExactDumpReplayFixture({ sourceSpaceId: source, rows: { nodes: [root] } }),
    );
    return { source, target, root };
  };

  const fixture = async (preserveViewMetadata = true) => {
    const base = await rootArchive();
    const prefix = `replay-${sequence}`;
    const node = `${prefix}-base-node`,
      emptyNode = `${prefix}-empty-node`;
    const baseId = `${prefix}-base`,
      emptyBase = `${prefix}-empty-base`;
    const commitId = `${prefix}-commit`,
      recordId = `${prefix}-record`;
    const rows: Partial<Record<DumpTable, Row[]>> = {
      nodes: [
        base.root,
        ...[node, emptyNode].map((id) => ({
          id,
          spaceId: base.source,
          parentId: base.root.id,
          type: "base",
          slug: id,
          name: id,
          metadata: { nested: { value: 1, nullable: null }, ordered: ["first", "second"] },
          createdAt: sourceTime,
          updatedAt: sourceTime,
        })),
      ],
      bases: [
        [baseId, node],
        [emptyBase, emptyNode],
      ].map(([id, nodeId]) => ({
        id,
        spaceId: base.source,
        nodeId,
        slug: id,
        name: id,
        createdAt: sourceTime,
      })),
      views: [0, 1].map((index) => ({
        id: `${prefix}-view-${index}`,
        spaceId: base.source,
        baseId,
        slug: `view-${index}`,
        name: `View ${index}`,
        position: 0,
        createdBy: "fixture",
        createdAt: sourceTime,
        updatedAt: sourceTime,
      })),
      commits: [
        {
          id: commitId,
          spaceId: base.source,
          baseId,
          targetType: "base",
          operation: "record_create",
          author: "fixture",
          payload: { value: "original" },
          createdAt: sourceTime,
        },
      ],
      records: [
        {
          id: recordId,
          spaceId: base.source,
          baseId,
          headCommitId: commitId,
          status: "active",
          createdBy: "fixture",
          createdAt: sourceTime,
          updatedAt: sourceTime,
        },
      ],
    };
    archives.set(base.target, createExactDumpReplayFixture({ sourceSpaceId: base.source, rows }));
    const initial = await begin(base.target, base.source, false, preserveViewMetadata);
    for (const [table, batch] of Object.entries(rows))
      await inSpace(base.target, () =>
        client.dump.importTables({
          sessionId: initial.sessionId,
          table: table as DumpTable,
          rows: batch,
        }),
      );
    expect(
      (await inSpace(base.target, () => client.dump.importCommit({ sessionId: initial.sessionId })))
        .ok,
    ).toBe(true);
    return { ...base, node, baseId, emptyBase, recordId, rows, preserveViewMetadata };
  };

  it("replays unchanged records and JSON idempotently, retaining source view positions and absent defaults", async () => {
    const data = await fixture();
    const resumed = await begin(data.target, data.source, true);
    await preflight(data.target, resumed.sessionId);
    for (const [table, rows] of Object.entries(data.rows))
      expect(
        await inSpace(data.target, () =>
          client.dump.importTables({
            sessionId: resumed.sessionId,
            table: table as DumpTable,
            rows,
          }),
        ),
      ).toEqual({ inserted: 0 });
    expect(
      (await inSpace(data.target, () => client.dump.importCommit({ sessionId: resumed.sessionId })))
        .ok,
    ).toBe(true);
    const db = await getDb();
    expect(
      (await db.select().from(busabaseViews).where(eq(busabaseViews.baseId, data.baseId))).map(
        (view) => view.position,
      ),
    ).toEqual([0, 0]);
    expect(
      await db.select().from(busabaseViews).where(eq(busabaseViews.baseId, data.emptyBase)),
    ).toEqual([]);
    expect((await readRoot(data.target)).createdAt).toBe(sourceTime);
  });

  it("preserves literal constructor, __proto__ and toJSON keys during exact JSON replay", async () => {
    // Build a separate source fixture before its first begin, rather than
    // deriving expected data from a resumed target.
    const next = await rootArchive();
    const payload = JSON.parse(
      '{"constructor":{"type":"user"},"__proto__":{"kept":true},"toJSON":"literal","nested":[null,{"x":1}]}',
    );
    const root = { ...next.root, metadata: payload };
    const archive = createExactDumpReplayFixture({
      sourceSpaceId: next.source,
      rows: { nodes: [root] },
    });
    archives.set(next.target, archive);
    const api = new OpenAPIHandler(busabaseRouter);
    const opaque = async (
      input: Parameters<typeof client.dump.importTables>[0],
    ): Promise<ImportTablesVO> => {
      const { rows, ...rest } = input;
      const handled = await inSpace(next.target, () =>
        api.handle(
          new Request("http://test/api/v1/dump/import/tables", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...rest, rowsJson: JSON.stringify(rows ?? []) }),
          }),
          { context: {} },
        ),
      );
      if (!handled.matched) throw new Error("Opaque import route did not match");
      const body = await handled.response.json();
      expect(handled.response.status, JSON.stringify(body)).toBe(200);
      return body as ImportTablesVO;
    };
    const first = await begin(next.target, next.source);
    await opaque({ sessionId: first.sessionId, table: "nodes", rows: archive.rows.nodes });
    await inSpace(next.target, () => client.dump.importCommit({ sessionId: first.sessionId }));
    const resumed = await begin(next.target, next.source, true);
    await archive.preflightWith(opaque, resumed.sessionId);
    expect(
      await opaque({ sessionId: resumed.sessionId, table: "nodes", rows: archive.rows.nodes }),
    ).toEqual({
      inserted: 0,
    });
    await inSpace(next.target, () => client.dump.importCommit({ sessionId: resumed.sessionId }));
    const actual = (await readRoot(next.target)).metadata as Record<string, unknown>;
    expect(actual).toEqual(payload);
    expect(Object.hasOwn(actual, "__proto__")).toBe(true);
  });

  it.each([
    ["scalar string versus array", "source scalar", ["source scalar"]],
    ["array versus object", ["source scalar"], { value: "source scalar" }],
  ] as const)("keeps JSON %s distinct during replay", async (_label, original, changed) => {
    const data = await rootArchive(),
      root = { ...data.root, metadata: original };
    const archive = createExactDumpReplayFixture({
      sourceSpaceId: data.source,
      rows: { nodes: [root] },
    });
    archives.set(data.target, archive);
    const first = await begin(data.target, data.source);
    await inSpace(data.target, () => archive.offerRoot(client, first.sessionId));
    expect(
      (await inSpace(data.target, () => client.dump.importCommit({ sessionId: first.sessionId })))
        .ok,
    ).toBe(true);
    const same = await begin(data.target, data.source, true);
    await preflight(data.target, same.sessionId);
    await inSpace(data.target, () => archive.offerRoot(client, same.sessionId));
    await inSpace(data.target, () => client.dump.importCommit({ sessionId: same.sessionId }));
    expect((await readRoot(data.target)).metadata).toEqual(original);
    const db = await getDb();
    await db.execute(
      sql`UPDATE ${busabaseNodes} SET metadata=${JSON.stringify(changed)}::jsonb WHERE id=${rootNodeIdForSpace(data.target)}`,
    );
    const resumed = await begin(data.target, data.source, true);
    await expect(preflight(data.target, resumed.sessionId)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect((await readRoot(data.target)).metadata).toEqual(changed);
    await inSpace(data.target, () => client.dump.importAbort({ sessionId: resumed.sessionId }));
  });

  it.each([
    ["record scalar", "records"],
    ["nested JSON scalar", "nodes"],
    ["JSON missing key versus null", "nodes"],
    ["JSON array order", "nodes"],
    ["JSON scalar type", "nodes"],
    ["one microsecond", "records"],
  ] as const)(
    "refuses a same-id replay after changing %s without rewriting target data",
    async (kind, table) => {
      const data = await fixture();
      const db = await getDb();
      if (kind === "record scalar")
        await db
          .update(busabaseRecords)
          .set({ status: "archived" })
          .where(eq(busabaseRecords.id, data.recordId));
      else if (kind === "one microsecond")
        await db.execute(
          sql`UPDATE ${busabaseRecords} SET created_at = created_at + interval '1 microsecond' WHERE id = ${data.recordId}`,
        );
      else {
        const metadata: Record<string, unknown> = {
          nested: { value: 1, nullable: null },
          ordered: ["first", "second"],
        };
        if (kind === "nested JSON scalar") metadata.nested = { value: 2, nullable: null };
        if (kind === "JSON missing key versus null") metadata.nested = { value: 1 };
        if (kind === "JSON array order") metadata.ordered = ["second", "first"];
        if (kind === "JSON scalar type") metadata.nested = { value: "1", nullable: null };
        await db.update(busabaseNodes).set({ metadata }).where(eq(busabaseNodes.id, data.node));
      }
      const rowTable = table === "nodes" ? busabaseNodes : busabaseRecords;
      const rowId = table === "nodes" ? data.node : data.recordId;
      const before = await db
        .select(datePreservingColumns(rowTable))
        .from(rowTable)
        .where(eq(rowTable.id, rowId));
      const resumed = await begin(data.target, data.source, true);
      await expect(preflight(data.target, resumed.sessionId)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      await inSpace(data.target, () => client.dump.importAbort({ sessionId: resumed.sessionId }));
      expect(
        await db
          .select(datePreservingColumns(rowTable))
          .from(rowTable)
          .where(eq(rowTable.id, rowId)),
      ).toEqual(before);
    },
  );

  it.each(["createdAt", "updatedAt", "createdBy"] as const)(
    "does not overwrite a changed root %s after a completed restore",
    async (column) => {
      const data = await fixture();
      const db = await getDb();
      if (column === "createdBy")
        await db
          .update(busabaseNodes)
          .set({ createdBy: "changed-author" })
          .where(eq(busabaseNodes.id, rootNodeIdForSpace(data.target)));
      else
        await db.execute(
          sql`UPDATE ${busabaseNodes} SET ${column === "createdAt" ? sql`created_at` : sql`updated_at`} = ${column === "createdAt" ? sql`created_at` : sql`updated_at`} + interval '1 microsecond' WHERE id = ${rootNodeIdForSpace(data.target)}`,
        );
      const before = await readRoot(data.target);
      const resumed = await begin(data.target, data.source, true);
      await expect(preflight(data.target, resumed.sessionId)).rejects.toMatchObject({
        code: "CONFLICT",
      });
      expect(await readRoot(data.target)).toEqual(before);
      await inSpace(data.target, () => client.dump.importAbort({ sessionId: resumed.sessionId }));
    },
  );

  it("preserves six decimals while normalizing legacy offset timestamps to UTC", async () => {
    const data = await rootArchive();
    const root = { ...data.root, createdAt: "2024-01-02T11:04:05.123456+08:00" };
    archives.set(
      data.target,
      createExactDumpReplayFixture({ sourceSpaceId: data.source, rows: { nodes: [root] } }),
    );
    const started = await begin(data.target, data.source);
    await inSpace(data.target, () =>
      client.dump.importTables({ sessionId: started.sessionId, table: "nodes", rows: [root] }),
    );
    expect((await readRoot(data.target)).createdAt).toBe(sourceTime);
    await inSpace(data.target, () => client.dump.importCommit({ sessionId: started.sessionId }));
    const resumed = await begin(data.target, data.source, true);
    await preflight(data.target, resumed.sessionId);
    expect(
      await inSpace(data.target, () =>
        client.dump.importTables({ sessionId: resumed.sessionId, table: "nodes", rows: [root] }),
      ),
    ).toEqual({ inserted: 0 });
    await inSpace(data.target, () => client.dump.importAbort({ sessionId: resumed.sessionId }));
  });

  it("allows first root initialization after a blob interruption with an explicit untouched marker", async () => {
    const data = await rootArchive();
    const bytes = Buffer.alloc(RESTORE_BLOB_PART_BYTES + 1, 4);
    const key = `attachments/${data.target}-interrupted.bin`;
    const hash = createHash("sha256").update(bytes).digest("hex");
    const attachment = {
      id: `${data.target}-attachment`,
      spaceId: data.source,
      storageKey: key,
      fileName: "interrupted.bin",
      mimeType: "application/octet-stream",
      sizeBytes: bytes.length,
      contentHash: `sha256:${hash}`,
      userId: "fixture",
      createdAt: sourceTime,
      updatedAt: sourceTime,
    };
    archives.set(
      data.target,
      createExactDumpReplayFixture({
        sourceSpaceId: data.source,
        rows: { nodes: [data.root], attachments: [attachment] },
        blobs: [{ key, bytes }],
      }),
    );
    const first = await begin(data.target, data.source);
    await inSpace(data.target, () =>
      client.dump.importTables({
        sessionId: first.sessionId,
        table: "attachmentBlobs",
        rows: [
          {
            storageKey: key,
            base64: bytes.subarray(0, RESTORE_BLOB_PART_BYTES).toString("base64"),
            chunk: {
              partNumber: 1,
              totalParts: 2,
              sizeBytes: bytes.length,
              sha256: hash,
            },
          },
        ],
      }),
    );
    const resumed = await begin(data.target, data.source, true);
    await preflight(data.target, resumed.sessionId);
    for (let partNumber = 1; partNumber <= 2; partNumber++)
      await inSpace(data.target, () =>
        client.dump.importTables({
          sessionId: resumed.sessionId,
          table: "attachmentBlobs",
          rows: [
            {
              storageKey: key,
              base64: bytes
                .subarray(
                  (partNumber - 1) * RESTORE_BLOB_PART_BYTES,
                  partNumber * RESTORE_BLOB_PART_BYTES,
                )
                .toString("base64"),
              chunk: { partNumber, totalParts: 2, sizeBytes: bytes.length, sha256: hash },
            },
          ],
        }),
      );
    await inSpace(data.target, () =>
      client.dump.importTables({ sessionId: resumed.sessionId, table: "nodes", rows: [data.root] }),
    );
    expect((await readRoot(data.target)).createdAt).toBe(sourceTime);
    await inSpace(data.target, () =>
      client.dump.importTables({
        sessionId: resumed.sessionId,
        table: "attachments",
        rows: [attachment],
      }),
    );
    expect(
      (await inSpace(data.target, () => client.dump.importCommit({ sessionId: resumed.sessionId })))
        .ok,
    ).toBe(true);
  });

  it("fails closed in the marker-before-copy crash window and permits an explicit abort/fresh retry", async () => {
    const data = await rootArchive();
    const first = await begin(data.target, data.source);
    await markRestoreRootImported(await getDb(), {
      spaceId: data.target,
      sessionId: first.sessionId,
    });
    const before = await readRoot(data.target);
    const resumed = await begin(data.target, data.source, true);
    await expect(preflight(data.target, resumed.sessionId)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(await readRoot(data.target)).toEqual(before);
    await inSpace(data.target, () => client.dump.importAbort({ sessionId: resumed.sessionId }));
    expect(await isRestoreAutomationBlocked(data.target)).toBe(false);
    const fresh = await begin(data.target, data.source);
    await inSpace(data.target, () =>
      client.dump.importTables({ sessionId: fresh.sessionId, table: "nodes", rows: [data.root] }),
    );
    await inSpace(data.target, () => client.dump.importCommit({ sessionId: fresh.sessionId }));
    expect((await readRoot(data.target)).createdAt).toBe(sourceTime);
  });

  it("does not infer root initialization permission from an older unknown marker", async () => {
    const data = await rootArchive();
    await begin(data.target, data.source);
    const key = restoreActivityKey(data.target),
      marker = JSON.parse((await storage.getObject(key)).toString("utf8"));
    delete marker.rootImported;
    await storage.uploadFileToKey(Buffer.from(JSON.stringify(marker)), key, "application/json");
    const resumed = await begin(data.target, data.source, true);
    await expect(preflight(data.target, resumed.sessionId)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await inSpace(data.target, () => client.dump.importAbort({ sessionId: resumed.sessionId }));
  });

  it("keeps legacy view migration explicit and refuses to call changed positions an unchanged replay", async () => {
    const data = await fixture(false);
    const db = await getDb();
    expect(
      (await db.select().from(busabaseViews).where(eq(busabaseViews.baseId, data.baseId)))
        .map((view) => view.position)
        .sort(),
    ).toEqual([0, 1]);
    await expect(begin(data.target, data.source, true, false)).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("rejects a different completed archive before publishing an activity or touching readme bytes", async () => {
    const data = await fixture();
    const key = folderReadmeKey(rootNodeIdForSpace(data.target));
    const current = Buffer.from("Current target readme");
    await storage.uploadFileToKey(current, key, "text/markdown");
    const original = archiveFor(data.target);
    const changed = createExactDumpReplayFixture({
      sourceSpaceId: data.source,
      rows: {
        ...original.rows,
        records: original.rows.records.map((row) => ({ ...row, status: "archived" })),
      },
    });
    expect(changed.sourceArchiveChecksum).not.toBe(original.sourceArchiveChecksum);
    await expect(
      inSpace(data.target, () => changed.begin(client, { resume: true })),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await isRestoreAutomationBlocked(data.target)).toBe(false);
    expect(await storage.getObject(key)).toEqual(current);
  });

  it("detects an extra target id even when its row count equals the archive", async () => {
    const data = await fixture(),
      db = await getDb();
    await db.execute(
      sql`UPDATE ${busabaseRecords} SET id = ${`${data.recordId}-extra`} WHERE id = ${data.recordId}`,
    );
    const key = folderReadmeKey(rootNodeIdForSpace(data.target)),
      current = Buffer.from("Preserved target readme");
    await storage.uploadFileToKey(current, key, "text/markdown");
    const resumed = await begin(data.target, data.source, true);
    await expect(preflight(data.target, resumed.sessionId)).rejects.toThrow(/extra or unvalidated/);
    await expect(
      inSpace(data.target, () =>
        client.dump.importTables({
          sessionId: resumed.sessionId,
          table: "docBodies",
          rows: [{ nodeId: rootNodeIdForSpace(data.target), markdown: "Must not write" }],
        }),
      ),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(await storage.getObject(key)).toEqual(current);
    await inSpace(data.target, () => client.dump.importAbort({ sessionId: resumed.sessionId }));
  });

  it("does not mistake a truncated table or missing empty-table end for complete preflight", async () => {
    const data = await fixture(),
      resumed = await begin(data.target, data.source, true);
    const rows = archiveFor(data.target).rows.nodes;
    const input = {
      sessionId: resumed.sessionId,
      table: "nodes" as const,
      rows: rows.slice(0, 1),
      validateOnly: true,
    };
    expect((await inSpace(data.target, () => client.dump.importTables(input))).validatedRows).toBe(
      1,
    );
    expect((await inSpace(data.target, () => client.dump.importTables(input))).validatedRows).toBe(
      1,
    );
    await expect(
      inSpace(data.target, () =>
        client.dump.importTables({
          sessionId: resumed.sessionId,
          table: "nodes",
          rows: [],
          validateOnly: true,
          validationComplete: true,
        }),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      inSpace(data.target, () => client.dump.importCommit({ sessionId: resumed.sessionId })),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await inSpace(data.target, () => client.dump.importAbort({ sessionId: resumed.sessionId }));
  });

  it("protects a restored root-only no-history workspace from a later fresh restore", async () => {
    const data = await rootArchive();
    const root = {
      ...data.root,
      metadata: { valuable: "Root-only content" },
      settings: { legacySetting: { kept: true } },
    };
    archives.set(
      data.target,
      createExactDumpReplayFixture({ sourceSpaceId: data.source, rows: { nodes: [root] } }),
    );
    const first = await begin(data.target, data.source);
    await inSpace(data.target, () =>
      client.dump.importTables({ sessionId: first.sessionId, table: "nodes", rows: [root] }),
    );
    await inSpace(data.target, () =>
      client.dump.importTables({
        sessionId: first.sessionId,
        table: "docBodies",
        rows: [{ nodeId: root.id, markdown: "Valuable root-only readme" }],
      }),
    );
    expect(
      (await inSpace(data.target, () => client.dump.importCommit({ sessionId: first.sessionId })))
        .ok,
    ).toBe(true);
    const before = await readRoot(data.target),
      key = folderReadmeKey(rootNodeIdForSpace(data.target)),
      bytes = await storage.getObject(key);
    await expect(
      inSpace(data.target, () => client.dump.importBegin({ sourceSpaceId: "another-archive" })),
    ).rejects.toThrow(/seed root|readme/);
    expect(await readRoot(data.target)).toEqual(before);
    expect(await storage.getObject(key)).toEqual(bytes);
  });

  it("keeps normal root metadata changes protected by their real audit records", async () => {
    const data = await rootArchive(),
      id = rootNodeIdForSpace(data.target);
    await inSpace(data.target, () =>
      client.nodes.updateMetadata({ nodeId: id, metadata: { note: "User metadata" } }),
    );
    const before = await readRoot(data.target);
    await expect(
      inSpace(data.target, () => client.dump.importBegin({ sourceSpaceId: data.source })),
    ).rejects.toThrow(/not empty/);
    expect(await readRoot(data.target)).toEqual(before);
  });

  it("rolls back only its own newly written root readme so a failed fresh import remains retryable", async () => {
    const data = await rootArchive(),
      first = await begin(data.target, data.source);
    await inSpace(data.target, () =>
      client.dump.importTables({ sessionId: first.sessionId, table: "nodes", rows: [data.root] }),
    );
    await inSpace(data.target, () =>
      client.dump.importTables({
        sessionId: first.sessionId,
        table: "docBodies",
        rows: [{ nodeId: data.root.id, markdown: "Incomplete imported root readme" }],
      }),
    );
    const key = folderReadmeKey(rootNodeIdForSpace(data.target));
    expect(await storage.getObject(key)).toEqual(Buffer.from("Incomplete imported root readme"));
    await inSpace(data.target, () => client.dump.importAbort({ sessionId: first.sessionId }));
    expect(await storage.getObjectMetadata(key)).toBeNull();
    const retry = await begin(data.target, data.source);
    await inSpace(data.target, () => client.dump.importAbort({ sessionId: retry.sessionId }));
  });

  it("does not let a stale fresh abort delete rows or restore the root after resume takes ownership", async () => {
    const data = await rootArchive(),
      ids = [`${data.target}-one`, `${data.target}-two`];
    const nodes = [
      data.root,
      ...ids.map((id) => ({
        id,
        spaceId: data.source,
        parentId: data.root.id,
        type: "folder",
        slug: id,
        name: id,
        createdAt: sourceTime,
        updatedAt: sourceTime,
      })),
    ];
    const archive = createExactDumpReplayFixture({ sourceSpaceId: data.source, rows: { nodes } });
    archives.set(data.target, archive);
    const first = await begin(data.target, data.source);
    await inSpace(data.target, () =>
      client.dump.importTables({
        sessionId: first.sessionId,
        table: "nodes",
        rows: nodes.slice(0, 2),
      }),
    );
    const before = await readRoot(data.target);
    let release!: () => void, enteredA!: () => void, enteredB!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstCleanup = new Promise<void>((resolve) => {
      enteredA = resolve;
    });
    const secondCleanup = new Promise<void>((resolve) => {
      enteredB = resolve;
    });
    const cleanup = RestoreBlobParts.prototype.cleanup;
    let calls = 0;
    const held = vi.spyOn(RestoreBlobParts.prototype, "cleanup").mockImplementation(async function (
      this: RestoreBlobParts,
    ) {
      if (++calls <= 2) {
        if (calls === 1) enteredA();
        else enteredB();
        await gate;
      }
      return cleanup.call(this);
    });
    const aborting = inSpace(data.target, () =>
      client.dump.importAbort({ sessionId: first.sessionId }),
    ).then(
      () => null,
      (error) => error,
    );
    await firstCleanup;
    const resuming = begin(data.target, data.source, true);
    await secondCleanup;
    release();
    let resumed: Awaited<typeof resuming>;
    try {
      resumed = await resuming;
      expect(await aborting).toMatchObject({ code: "CONFLICT" });
    } finally {
      held.mockRestore();
      release();
    }
    expect(await readRoot(data.target)).toEqual(before);
    const db = await getDb();
    expect(await db.select().from(busabaseNodes).where(eq(busabaseNodes.id, ids[0]))).toHaveLength(
      1,
    );
    await preflight(data.target, resumed.sessionId);
    await inSpace(data.target, () =>
      client.dump.importTables({ sessionId: resumed.sessionId, table: "nodes", rows: nodes }),
    );
    expect(
      (await inSpace(data.target, () => client.dump.importCommit({ sessionId: resumed.sessionId })))
        .ok,
    ).toBe(true);
    expect(await db.select().from(busabaseNodes).where(eq(busabaseNodes.id, ids[1]))).toHaveLength(
      1,
    );
  });
});
