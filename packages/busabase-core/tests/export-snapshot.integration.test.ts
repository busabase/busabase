import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { DumpTableSchema, type ExportSnapshotEventVO } from "busabase-contract/domains/dump/types";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { resetStorage } from "openlib/storage";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createBusabaseClient } from "../../../apps/busabase-sdk/src/client";
import { type BusabaseDatabase, runWithBusabaseContext } from "../src/context";
import * as schema from "../src/db/schema";
import { exportSnapshot } from "../src/domains/dump/logic/export-snapshot";
import {
  seedAllSnapshotTables,
  seedSnapshotSpace,
  snapshotEventRows,
  snapshotHttpHost,
} from "./helpers/export-snapshot-fixture";

const migrationsFolder = path.resolve(__dirname, "../../../apps/busabase/src/db/migrations");
describe("consistent SQL export — real PGlite and HTTP", () => {
  let client: PGlite;
  let db: BusabaseDatabase;
  let directory: string;
  let host: Awaited<ReturnType<typeof snapshotHttpHost>>;
  const queries: string[] = [];
  beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "busabase-snapshot-storage-"));
    vi.stubEnv("STORAGE_URL", `local:${directory}?base_url=/api/storage`);
    resetStorage();
    client = await PGlite.create({ extensions: { pg_trgm } });
    const typed = drizzle({ client, schema, logger: { logQuery: (query) => queries.push(query) } });
    await migrate(typed, { migrationsFolder });
    db = typed;
    await seedSnapshotSpace(db, "snapshot-a");
    await seedSnapshotSpace(db, "snapshot-b");
    await db.insert(schema.busabaseSpaceInstructions).values([
      { spaceId: "snapshot-a", body: "A instructions" },
      { spaceId: "snapshot-b", body: "FOREIGN instructions" },
    ]);
    await db.insert(schema.busabaseWebhookRules).values({
      id: "snapshot-a-hook",
      spaceId: "snapshot-a",
      baseId: "snapshot-a-base",
      name: "Preserve policy",
      eventType: "record.updated",
      actionKind: "webhook",
      createdBy: "snapshot-owner",
      enabled: true,
      config: { secret: "dedicated-secret", url: "https://example.test/hook" },
    });
    host = await snapshotHttpHost(db);
  });
  afterAll(async () => {
    await host?.close();
    await client?.close();
    resetStorage();
    vi.unstubAllEnvs();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it("streams all 35 tables after ALS exits, preserving tenant scope, columns and webhook policy", async () => {
    const sdk = createBusabaseClient({ baseUrl: host.origin, spaceId: "snapshot-a" });
    const stream = await sdk.dump.exportSnapshot({ limit: 1 });
    const events: ExportSnapshotEventVO[] = [];
    for await (const event of stream) events.push(event);
    const start = events[0];
    expect(start.type).toBe("start");
    if (start.type !== "start") throw new Error("No start event");
    expect(start.spaceId).toBe("snapshot-a");
    expect(start.tables).toEqual(DumpTableSchema.options);
    const ends = events.filter((event) => event.type === "tableEnd");
    expect(ends.map((event) => event.table)).toEqual(DumpTableSchema.options);
    for (const event of events)
      if (event.type === "rows") {
        expect(Object.keys(snapshotEventRows(event)[0]).sort()).toEqual(
          [...start.columns[event.table]].sort(),
        );
        expect(JSON.stringify(snapshotEventRows(event))).not.toContain("snapshot-b");
      }
    const instructions = events.flatMap((event) =>
      event.type === "rows" && event.table === "spaceInstructions" ? snapshotEventRows(event) : [],
    );
    expect(instructions).toMatchObject([{ spaceId: "snapshot-a", body: "A instructions" }]);
    const webhook = events.flatMap((event) =>
      event.type === "rows" && event.table === "webhookRules" ? snapshotEventRows(event) : [],
    )[0];
    expect(webhook.enabled).toBe(false);
    expect(JSON.stringify(webhook)).not.toContain("dedicated-secret");
    expect(webhook.config).toMatchObject({
      __busabaseBackup: { secretOmitted: true, requiresReconnect: true },
    });
    expect(events.at(-1)).toMatchObject({ type: "complete", attachmentDependencies: 0 });
    expect(host.errors).toEqual([]);
  });

  it("authenticates before SSE and rejects a caller-supplied space override", async () => {
    const forbidden = await fetch(`${host.origin}/api/v1/dump/export/snapshot`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-busabase-space": "snapshot-a",
        "x-test-manager": "no",
      },
      body: "{}",
    });
    expect(forbidden.status).toBe(403);
    const spoof = await fetch(`${host.origin}/api/v1/dump/export/snapshot`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-busabase-space": "snapshot-a" },
      body: JSON.stringify({ limit: 1, spaceId: "snapshot-b" }),
    });
    expect(spoof.status).toBe(400);
  });

  it("preserves legal special JSON keys and scalar strings in the actual HTTP SSE bytes", async () => {
    const metadata = JSON.parse(
      '{"__proto__":{"safe":true},"constructor":"root-data","toJSON":{"literal":true},"nested":{"__proto__":[1,2],"constructor":{"value":"nested"},"toJSON":"not-a-function"},"array":[{"__proto__":"array-data","constructor":"array-constructor","toJSON":{"kept":true}}]}',
    );
    await db
      .update(schema.busabaseNodes)
      .set({ metadata })
      .where(eq(schema.busabaseNodes.id, "snapshot-a-node"));
    await client.query("UPDATE busabase_field_values SET value_json=$1::jsonb WHERE id=$2", [
      JSON.stringify("[1,2]"),
      "snapshot-a-cell",
    ]);
    const response = await fetch(`${host.origin}/api/v1/dump/export/snapshot`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-busabase-space": "snapshot-a" },
      body: JSON.stringify({ limit: 1 }),
    });
    expect(response.status).toBe(200);
    const wire = await response.text();
    const events = wire.split(/\r?\n\r?\n/).flatMap((frame) => {
      if (!frame.startsWith("event: message\n")) return [];
      const data = frame.split("\n").find((line) => line.startsWith("data: "));
      if (!data) throw new Error("Missing raw SSE data line");
      return [JSON.parse(data.slice(6)) as ExportSnapshotEventVO];
    });
    const nodes = events.flatMap((event) =>
      event.type === "rows" && event.table === "nodes" ? snapshotEventRows(event) : [],
    );
    const values = events.flatMap((event) =>
      event.type === "rows" && event.table === "fieldValues" ? snapshotEventRows(event) : [],
    );
    expect(nodes[0].metadata).toEqual(metadata);
    expect(Object.hasOwn(nodes[0].metadata as object, "__proto__")).toBe(true);
    expect(Object.hasOwn((nodes[0].metadata as Record<string, object>).nested, "__proto__")).toBe(
      true,
    );
    expect(values[0].valueJson).toBe("[1,2]");
    expect(wire).toContain('\\"__proto__\\"');
  });

  it("isolates every one of the 35 tables, including singleton and parent-scoped children", async () => {
    await seedAllSnapshotTables(db, "tenant-a", "tenant-a");
    await seedAllSnapshotTables(db, "tenant-b", "tenant-b");
    const stream = await runWithBusabaseContext(
      { db, spaceId: "tenant-a", isSpaceManager: true },
      async () => exportSnapshot({ limit: 1 }),
    );
    const seen = new Set<string>();
    for await (const event of stream) {
      expect(JSON.stringify(event)).not.toContain("tenant-b");
      if (event.type === "rows") seen.add(event.table);
      if (event.type === "tableEnd") expect(event.count).toBeGreaterThan(0);
    }
    expect([...seen]).toEqual(DumpTableSchema.options);
  });

  it("keeps SQL JSON payloads opaque inside the producer", async () => {
    const metadata = JSON.parse(
      '{"marker":"snapshot-json-opaque-never-parse","__proto__":{"kept":true},"constructor":"data","toJSON":"data","nested":["[1,2]",{"中文":"\\\\path\\nquoted\\""}]}',
    );
    await db
      .update(schema.busabaseNodes)
      .set({ metadata })
      .where(eq(schema.busabaseNodes.id, "snapshot-a-node"));
    const parse = JSON.parse;
    const spy = vi.spyOn(JSON, "parse").mockImplementation((value, reviver) => {
      if (typeof value === "string" && value.includes("snapshot-json-opaque-never-parse"))
        throw new Error("The producer parsed an opaque SQL JSON payload");
      return parse(value, reviver);
    });
    let nodesJson = "";
    try {
      const stream = await runWithBusabaseContext(
        { db, spaceId: "snapshot-a", isSpaceManager: true },
        async () => exportSnapshot({ limit: 1 }),
      );
      for await (const event of stream)
        if (event.type === "rows" && event.table === "nodes") nodesJson = event.rowsJson;
    } finally {
      spy.mockRestore();
    }
    expect(JSON.parse(nodesJson)[0].metadata).toEqual(metadata);
  });

  it("does not fetch data ahead of demand and releases the PGlite client on return", async () => {
    const stream = await runWithBusabaseContext(
      { db, spaceId: "snapshot-a", isSpaceManager: true },
      async () => exportSnapshot({ limit: 1 }),
    );
    const before = queries.length;
    expect((await stream.next()).value).toMatchObject({ type: "start", spaceId: "snapshot-a" });
    expect(queries.slice(before).some((query) => /from "busabase_nodes"/i.test(query))).toBe(false);
    await stream.return();
    expect((await client.query("SELECT 1 AS released")).rows).toEqual([{ released: 1 }]);
  });

  it("preserves jsonb strings that look like JSON, own prototype keys, booleans and bigint-number columns", async () => {
    await db.insert(schema.attachments).values({
      id: "snapshot-a-bigint",
      spaceId: "snapshot-a",
      userId: "snapshot-owner",
      fileName: "large.bin",
      mimeType: "application/octet-stream",
      storageKey: "attachments/large",
      sizeBytes: 5 * 1024 * 1024 * 1024,
    });
    await client.query("UPDATE busabase_field_values SET value_json = $1::jsonb WHERE id=$2", [
      JSON.stringify("[1,2]"),
      "snapshot-a-cell",
    ]);
    const metadata = JSON.parse(
      '{"__proto__":{"kept":true},"constructor":"own","ordered":[3,null,true,"中文"]}',
    );
    await db
      .update(schema.busabaseNodes)
      .set({ metadata })
      .where(eq(schema.busabaseNodes.id, "snapshot-a-node"));
    const stream = await runWithBusabaseContext(
      { db, spaceId: "snapshot-a", isSpaceManager: true },
      async () => exportSnapshot({ limit: 1 }),
    );
    for await (const event of stream)
      if (event.type === "rows") {
        if (event.table === "fieldValues")
          expect(snapshotEventRows(event)[0].valueJson).toBe("[1,2]");
        if (event.table === "nodes") {
          expect(snapshotEventRows(event)[0].metadata).toEqual(metadata);
          expect(Object.hasOwn(snapshotEventRows(event)[0].metadata as object, "__proto__")).toBe(
            true,
          );
          expect(snapshotEventRows(event)[0].effectivePublicRequiresPassword).toBe(false);
        }
        if (event.table === "attachments")
          expect(snapshotEventRows(event)[0].sizeBytes).toBe(5 * 1024 * 1024 * 1024);
      }
  });

  it("fails closed on an unsafe integer column instead of rounding its driver value", async () => {
    await client.query(
      "UPDATE attachments SET size_bytes=9007199254740993 WHERE id='snapshot-a-bigint'",
    );
    try {
      const stream = await runWithBusabaseContext(
        { db, spaceId: "snapshot-a", isSpaceManager: true },
        async () => exportSnapshot({ limit: 1 }),
      );
      const consume = async () => {
        for await (const _event of stream) {
          /* exercise the real driver cursor */
        }
      };
      await expect(consume()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    } finally {
      await client.query(
        "UPDATE attachments SET size_bytes=5368709120 WHERE id='snapshot-a-bigint'",
      );
    }
  });

  it("aborts a pending next without deadlocking the one-client transaction queue", async () => {
    const controller = new AbortController();
    const stream = await runWithBusabaseContext(
      { db, spaceId: "snapshot-a", isSpaceManager: true },
      async () => exportSnapshot({ limit: 1 }, { signal: controller.signal }),
    );
    await stream.next();
    const pending = stream.next();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await stream.return();
    expect((await client.query("SELECT 2 AS released")).rows).toEqual([{ released: 2 }]);
  });

  it("rejects an unknown physical column instead of projecting it out", async () => {
    await client.exec("ALTER TABLE busabase_nodes ADD COLUMN unknown_backup_column text");
    try {
      const stream = await runWithBusabaseContext(
        { db, spaceId: "snapshot-a", isSpaceManager: true },
        async () => exportSnapshot({ limit: 1 }),
      );
      await expect(stream.next()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    } finally {
      await client.exec("ALTER TABLE busabase_nodes DROP COLUMN unknown_backup_column");
    }
  });
});
