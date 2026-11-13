import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DumpTableSchema, type ExportSnapshotEventVO } from "busabase-contract/domains/dump/types";
import { eq, sql } from "drizzle-orm";
import type { PgTransactionConfig } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { resetStorage, storage } from "openlib/storage";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createBusabaseClient } from "../../../apps/busabase-sdk/src/client";
import { type BusabaseDatabase, runWithBusabaseContext } from "../src/context";
import * as schema from "../src/db/schema";
import { exportSnapshot } from "../src/domains/dump/logic/export-snapshot";
import {
  seedSnapshotSpace,
  snapshotEventRows,
  snapshotHttpHost,
} from "./helpers/export-snapshot-fixture";

const adminUrl = process.env.BUSABASE_SNAPSHOT_PG_TEST_URL;
describe.skipIf(!adminUrl)("consistent SQL snapshot — real PostgreSQL writers", () => {
  const database = `busabase_snapshot_${randomUUID().replaceAll("-", "")}`;
  let admin: ReturnType<typeof postgres>;
  let readerSql: ReturnType<typeof postgres>;
  let writerSql: ReturnType<typeof postgres>;
  let db: BusabaseDatabase;
  let writer: BusabaseDatabase;
  let ids: Awaited<ReturnType<typeof seedSnapshotSpace>>;
  let directory: string;
  let host: Awaited<ReturnType<typeof snapshotHttpHost>>;
  const spaceId = "snapshot-pg";
  const application = `snapshot-reader-${database}`;
  beforeAll(async () => {
    if (!adminUrl) throw new Error("BUSABASE_SNAPSHOT_PG_TEST_URL is required");
    admin = postgres(adminUrl, { max: 1, prepare: false });
    await admin.unsafe(`CREATE DATABASE "${database}"`);
    const url = new URL(adminUrl);
    url.pathname = "/" + database;
    readerSql = postgres(url.toString(), {
      max: 1,
      prepare: false,
      connection: { application_name: application },
    });
    writerSql = postgres(url.toString(), { max: 1, prepare: false });
    const typed = drizzle(readerSql, { schema });
    db = typed;
    writer = drizzle(writerSql, { schema });
    await migrate(typed, {
      migrationsFolder: path.resolve(__dirname, "../../../apps/busabase/src/db/migrations"),
    });
    ids = await seedSnapshotSpace(db, spaceId);
    directory = await mkdtemp(path.join(tmpdir(), "busabase-snapshot-pg-storage-"));
    vi.stubEnv("STORAGE_URL", `local:${directory}?base_url=/api/storage`);
    resetStorage();
    const oldBytes = Buffer.from("snapshot original bytes\r\n");
    const newBytes = Buffer.from("replacement after SQL start\n");
    await storage.uploadFileToKey(oldBytes, "attachments/snapshot/old", "text/plain");
    await storage.uploadFileToKey(newBytes, "attachments/snapshot/new", "text/plain");
    await db.insert(schema.attachments).values([
      {
        id: "foreign-old",
        spaceId: "another-space",
        storageKey: "attachments/snapshot/old",
        fileName: "old.txt",
        mimeType: "text/plain",
        sizeBytes: oldBytes.length,
        contentHash: "sha256:" + createHash("sha256").update(oldBytes).digest("hex"),
        userId: "FOREIGN-PRIVATE-OWNER",
        metadata: { secret: "FOREIGN-PRIVATE-METADATA" },
      },
      {
        id: "foreign-new",
        spaceId: "another-space",
        storageKey: "attachments/snapshot/new",
        fileName: "new.txt",
        mimeType: "text/plain",
        sizeBytes: newBytes.length,
        contentHash: "sha256:" + createHash("sha256").update(newBytes).digest("hex"),
        userId: "FOREIGN-PRIVATE-OWNER",
      },
    ]);
    await db.insert(schema.busabaseAssets).values([
      {
        id: "a-own-anchor",
        spaceId,
        attachmentId: "foreign-old",
        name: "Own readable Asset",
        retainInLibrary: true,
        createdBy: "snapshot-owner",
      },
      {
        id: "z-second-anchor",
        spaceId,
        attachmentId: "foreign-old",
        name: "Same backing bytes",
        retainInLibrary: true,
        createdBy: "snapshot-owner",
      },
    ]);
    host = await snapshotHttpHost(db);
  }, 120_000);
  afterAll(async () => {
    await host?.close();
    await readerSql?.end({ timeout: 2 });
    await writerSql?.end({ timeout: 2 });
    if (admin) {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
      await admin.end({ timeout: 2 });
    }
    resetStorage();
    vi.unstubAllEnvs();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("keeps the old SQL cut and dependency anchor while a separate writer commits parent+child and replaces the Asset", async () => {
    const stream = await runWithBusabaseContext(
      { db, spaceId, actorId: "snapshot-owner", isSpaceManager: true },
      async () => exportSnapshot({ limit: 1 }),
    );
    expect((await stream.next()).value).toMatchObject({ type: "start", spaceId });
    const started = Date.now();
    await writer.transaction(async (tx) => {
      await tx.insert(schema.busabaseCommits).values({
        id: "after-start-commit",
        spaceId,
        baseId: ids.base,
        payload: { title: "after" },
        author: "snapshot-owner",
      });
      await tx.insert(schema.busabaseChangeRequests).values({
        id: "after-start-request",
        spaceId,
        baseId: ids.base,
        submittedBy: "snapshot-owner",
      });
      await tx.insert(schema.busabaseFieldValues).values({
        id: "after-start-cell",
        spaceId,
        baseId: ids.base,
        recordId: ids.record,
        changeRequestId: "after-start-request",
        commitId: "after-start-commit",
        fieldSlug: "title",
        fieldType: "text",
        valueText: "after",
      });
      await tx
        .update(schema.busabaseRecords)
        .set({ headCommitId: "after-start-commit" })
        .where(eq(schema.busabaseRecords.id, ids.record));
      await tx
        .update(schema.busabaseAssets)
        .set({ attachmentId: "foreign-new" })
        .where(eq(schema.busabaseAssets.id, "a-own-anchor"));
    });
    expect(Date.now() - started).toBeLessThan(3000);
    const events: ExportSnapshotEventVO[] = [];
    for await (const event of stream) events.push(event);
    const rows = (table: string) =>
      events.flatMap((event) =>
        event.type === "rows" && event.table === table ? snapshotEventRows(event) : [],
      );
    expect(rows("commits").map((row) => row.id)).toEqual([ids.commit]);
    expect(rows("changeRequests")).toEqual([]);
    expect(rows("fieldValues").map((row) => row.id)).toEqual([ids.cell]);
    expect(rows("records")[0].headCommitId).toBe(ids.commit);
    expect(rows("assets").find((row) => row.id === "a-own-anchor")?.attachmentId).toBe(
      "foreign-old",
    );
    expect(rows("attachments")).toEqual([]);
    const dependencies = events.filter((event) => event.type === "attachmentDependency");
    expect(dependencies).toHaveLength(1);
    expect(dependencies[0]).toMatchObject({
      dependency: {
        assetId: "a-own-anchor",
        attachmentId: "foreign-old",
        materializedAttachment: {
          spaceId,
          storageKey: "attachments/snapshot/old",
          userId: "snapshot-owner",
        },
      },
    });
    expect(JSON.stringify(dependencies)).not.toContain("FOREIGN-PRIVATE");
    if (dependencies[0].type !== "attachmentDependency") throw new Error("No dependency");
    expect(dependencies[0].dependency.materializedAttachment.createdAt).toBe(
      rows("assets").find((row) => row.id === "a-own-anchor")?.createdAt,
    );
    expect(events.at(-1)).toMatchObject({
      type: "complete",
      attachmentDependencies: 1,
      tables: { commits: 1, changeRequests: 0, fieldValues: 1, attachments: 0 },
    });
    expect(
      (
        await writer
          .select()
          .from(schema.busabaseRecords)
          .where(eq(schema.busabaseRecords.id, ids.record))
      )[0].headCommitId,
    ).toBe("after-start-commit");
  });

  it("preserves nonzero default-now microseconds that the legacy Date projection truncates", async () => {
    let id = "";
    let exact = "";
    for (let attempt = 0; attempt < 5; attempt++) {
      id = `precision-default-${attempt}`;
      const result =
        await writerSql`INSERT INTO busabase_nodes(id,space_id,type,slug,name) VALUES(${id},${spaceId},'doc',${id},'Default timestamp precision') RETURNING to_char(created_at,'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS exact`;
      exact = result[0].exact;
      if (!exact.endsWith("000Z")) break;
    }
    expect(exact).toMatch(/\.\d{6}Z$/);
    expect(exact.endsWith("000Z")).toBe(false);
    const legacy = (
      await writer.select().from(schema.busabaseNodes).where(eq(schema.busabaseNodes.id, id))
    )[0].createdAt as Date;
    expect(legacy.toISOString()).not.toBe(exact);
    const stream = await runWithBusabaseContext(
      { db, spaceId, actorId: "snapshot-owner", isSpaceManager: true },
      async () => exportSnapshot({ limit: 1 }),
    );
    let exported: unknown;
    for await (const event of stream)
      if (event.type === "rows" && event.table === "nodes")
        exported = snapshotEventRows(event).find((row) => row.id === id)?.createdAt ?? exported;
    expect(exported).toBe(exact);
    console.info(
      JSON.stringify({
        proof: "defaultNow-microseconds",
        sqlExact: exact,
        legacyDate: legacy.toISOString(),
        snapshotExact: exported,
      }),
    );
    if (process.env.BUSABASE_SNAPSHOT_PRECISION_PROOF)
      await writeFile(
        process.env.BUSABASE_SNAPSHOT_PRECISION_PROOF,
        JSON.stringify(
          {
            sqlExact: exact,
            legacyDate: legacy.toISOString(),
            snapshotExact: exported,
            legacyTruncatesNonzeroMicroseconds: true,
            snapshotPreservesAllSixDigits: true,
          },
          null,
          2,
        ) + "\n",
        { mode: 0o600 },
      );
  });

  it("sorts only identities in each server cursor and reads projected rows by primary key", async () => {
    // A cursor over projected rows made PostgreSQL detoast and sort every JSON
    // payload before the first FETCH; on Cloud that exceeded the 30 s timeout.
    if (!adminUrl) throw new Error("BUSABASE_SNAPSHOT_PG_TEST_URL is required");
    const statements: string[] = [];
    const url = new URL(adminUrl);
    url.pathname = "/" + database;
    const traced = postgres(url.toString(), {
      max: 1,
      prepare: false,
      debug: (_connection, query) => statements.push(query),
    });
    try {
      const stream = await runWithBusabaseContext(
        {
          db: drizzle(traced, { schema }),
          spaceId,
          actorId: "snapshot-owner",
          isSpaceManager: true,
        },
        async () => exportSnapshot({ limit: 500 }),
      );
      const exported: Record<string, number> = {};
      for await (const event of stream)
        if (event.type === "tableEnd") exported[event.table] = event.count;
      const cursors = statements.filter((query) => /^\s*declare\b/i.test(query));
      expect(cursors).toHaveLength(DumpTableSchema.options.length);
      for (const query of cursors) {
        expect(query).toMatch(/as "snapshot_identity"/i);
        expect(query).not.toMatch(/::text|to_char/);
      }
      const rowReads = statements.filter(
        (query) =>
          /^\s*select\b/i.test(query) &&
          /::text|to_char/.test(query) &&
          !/distinct on/i.test(query),
      );
      expect(rowReads.length).toBeGreaterThan(0);
      for (const query of rowReads) expect(query).toMatch(/ in \(/i);
      expect(exported.nodes).toBeGreaterThan(0);
      expect(exported.commits).toBeGreaterThan(0);
    } finally {
      await traced.end({ timeout: 2 });
    }
  });

  it("keeps each 95MiB commit in a separate rows event without accumulating the table", async () => {
    const size = 95 * 1024 * 1024;
    const payload = "x".repeat(size);
    const expectedHash = createHash("sha256").update(payload).digest("hex");
    for (const id of ["zz-big-0", "zz-big-1"])
      await writer.insert(schema.busabaseCommits).values({
        id,
        spaceId,
        baseId: ids.base,
        payload: { large: payload },
        author: "snapshot-owner",
      });
    const stream = await runWithBusabaseContext(
      { db, spaceId, actorId: "snapshot-owner", isSpaceManager: true },
      async () => exportSnapshot({ limit: 500 }),
    );
    let largeEvents = 0;
    for await (const event of stream)
      if (event.type === "rows" && event.table === "commits") {
        const rows = snapshotEventRows(event);
        if (!rows.some((row) => String(row.id).startsWith("zz-big-"))) continue;
        expect(rows.length).toBe(1);
        const actual = (rows[0].payload as { large: string }).large;
        expect(actual.length).toBe(size);
        expect(createHash("sha256").update(actual).digest("hex")).toBe(expectedHash);
        largeEvents++;
      }
    expect(largeEvents).toBe(2);
    await writerSql`DELETE FROM busabase_commits WHERE id IN ('zz-big-0','zz-big-1')`;
  }, 120_000);

  it("releases its PostgreSQL transaction after a real HTTP consumer aborts", async () => {
    const controller = new AbortController();
    const sdk = createBusabaseClient({ baseUrl: host.origin, spaceId });
    const stream = await sdk.dump.exportSnapshot({ limit: 1 }, { signal: controller.signal });
    expect((await stream.next()).value).toMatchObject({ type: "start" });
    controller.abort();
    await stream.return().catch(() => undefined);
    let remaining = -1;
    for (let attempt = 0; attempt < 100; attempt++) {
      const result =
        await admin`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=${database} AND application_name=${application} AND xact_start IS NOT NULL`;
      remaining = result[0].n;
      if (remaining === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(remaining).toBe(0);
    expect((await readerSql`SELECT 1 AS reusable`)[0].reusable).toBe(1);
    expect(host.errors).toEqual([]);
  });

  it("uses an actual READ ONLY PostgreSQL transaction that rejects an injected write", async () => {
    const instrumented = new Proxy(db, {
      get(target, key, receiver) {
        if (key === "transaction")
          return (work: (tx: BusabaseDatabase) => Promise<unknown>, config: PgTransactionConfig) =>
            target.transaction(async (tx) => {
              await tx.execute(
                sql`INSERT INTO busabase_nodes(id,space_id,type,slug,name) VALUES('readonly-write-probe',${spaceId},'doc','readonly-write-probe','must not be inserted')`,
              );
              return work(tx);
            }, config);
        const value = Reflect.get(target, key, receiver);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
    const stream = await runWithBusabaseContext(
      { db: instrumented, spaceId, isSpaceManager: true },
      async () => exportSnapshot({ limit: 1 }),
    );
    await expect(stream.next()).rejects.toMatchObject({ cause: { code: "25006" } });
    expect(
      (
        await writerSql`SELECT count(*)::int AS n FROM busabase_nodes WHERE id='readonly-write-probe'`
      )[0].n,
    ).toBe(0);
  });
});
