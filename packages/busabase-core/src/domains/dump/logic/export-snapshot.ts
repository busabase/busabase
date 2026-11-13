import "server-only";

import { AsyncLocalStorage } from "node:async_hooks";
import { ORPCError } from "@orpc/server";
import {
  type DumpTable,
  DumpTableSchema,
  type ExportSnapshotEventVO,
  type ExportSnapshotInput,
  ExportSnapshotInputSchema,
} from "busabase-contract/domains/dump/types";
import type { SQL } from "drizzle-orm";
import { and, asc, eq, getTableColumns, getTableName, gt, inArray, ne, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { type BusabaseDatabase, getContextSpaceId, runWithSearchDatabase } from "../../../context";
import { getDb } from "../../../db";
import { attachments, busabaseAssets } from "../../../db/schema";
import { requireSpaceManagerForDump } from "./_guard";
import {
  type AssetAttachmentBackupAnchor,
  exportAssetAttachmentSnapshotDependency,
} from "./asset-attachment-backup";
import { prepareWebhookBackupRow } from "./row-policy";
import {
  DUMP_TABLE_REGISTRY,
  dumpIdentityColumn,
  dumpIdentityKey,
  dumpSpaceScope,
} from "./table-registry";

const EVENT_TARGET_BYTES = 1024 * 1024;
const STATEMENT_TIMEOUT_MS = 30_000;
/** The one statement per table that scans and sorts its identities. */
const IDENTITY_SCAN_TIMEOUT_MS = 300_000;
const IDENTITY_BATCH = 1000;
const SNAPSHOT_IDENTITY = "snapshot_identity";
const tables = [...DumpTableSchema.options];
type Event = ExportSnapshotEventVO;

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const asError = (error: unknown): Error =>
  error instanceof Error ? error : new Error("SQL snapshot stream failed", { cause: error });

/** One event may be delivered, but the producer cannot advance until next(). */
class SnapshotMailbox {
  private slot?: { event: Event; delivered: boolean; acknowledgement: ReturnType<typeof deferred> };
  private readable?: ReturnType<typeof deferred>;
  private failure?: Error;
  ended = false;

  async send(event: Event): Promise<void> {
    if (this.failure) throw this.failure;
    if (this.slot || this.ended)
      throw new Error("SQL snapshot producer exceeded its one-event mailbox");
    const acknowledgement = deferred();
    this.slot = { event, delivered: false, acknowledgement };
    this.readable?.resolve();
    await acknowledgement.promise;
    if (this.failure) throw this.failure;
  }

  async read(): Promise<IteratorResult<Event, void>> {
    if (this.slot?.delivered) {
      const previous = this.slot;
      this.slot = undefined;
      previous.acknowledgement.resolve();
    }
    for (;;) {
      if (this.failure) throw this.failure;
      if (this.slot) {
        this.slot.delivered = true;
        return { done: false, value: this.slot.event };
      }
      if (this.ended) return { done: true, value: undefined };
      this.readable = deferred();
      await this.readable.promise;
      this.readable = undefined;
    }
  }

  fail(error: unknown): void {
    this.failure ??= asError(error);
    this.slot?.acknowledgement.reject(this.failure);
    this.readable?.resolve();
  }

  finish(): void {
    this.ended = true;
    this.readable?.resolve();
  }
}

/** Reject unregistered physical columns instead of silently projecting them away. */
const assertPhysicalColumns = async (db: BusabaseDatabase): Promise<void> => {
  const names = tables.map((table) => getTableName(DUMP_TABLE_REGISTRY[table]));
  const result = await db.execute(sql`
    SELECT table_name AS "tableName", column_name AS "columnName"
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name IN (${sql.join(
      names.map((name) => sql`${name}`),
      sql`, `,
    )})
  `);
  const rows = (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as Array<{
    tableName: string;
    columnName: string;
  }>;
  for (const table of tables) {
    const actual = new Set(
      rows
        .filter((row) => row.tableName === getTableName(DUMP_TABLE_REGISTRY[table]))
        .map((row) => row.columnName),
    );
    const expected = new Set(
      Object.values(getTableColumns(DUMP_TABLE_REGISTRY[table] as never)).map(
        (column) => (column as { name: string }).name,
      ),
    );
    const missing = [...expected].filter((column) => !actual.has(column));
    const unknown = [...actual].filter((column) => !expected.has(column));
    if (missing.length || unknown.length)
      throw new ORPCError("PRECONDITION_FAILED", {
        message: `SQL snapshot schema differs for ${table}; align the server schema before backing up`,
        data: { table, missing, unknown },
      });
  }
};

const pageSize = (table: DumpTable, requested: number): number =>
  table === "commits"
    ? 1
    : Math.min(
        requested,
        [
          "operations",
          "changeRequests",
          "agentSessions",
          "agentSessionEvents",
          "agentSessionCommands",
          "webhookDeliveries",
        ].includes(table)
          ? 25
          : 500,
      );

/** Preserve PostgreSQL microseconds instead of routing timestamps through Date. */
const snapshotColumns = (table: DumpTable): Record<string, AnyPgColumn | SQL> =>
  Object.fromEntries(
    Object.entries(getTableColumns(DUMP_TABLE_REGISTRY[table] as never)).map(([name, value]) => {
      const column = value as AnyPgColumn;
      const type = column.getSQLType();
      if (type === "json" || type === "jsonb") return [name, sql<string | null>`${column}::text`];
      if (!type.startsWith("timestamp")) return [name, column];
      const utc = /with time zone$/.test(type) ? sql`${column} AT TIME ZONE 'UTC'` : sql`${column}`;
      return [
        name,
        sql<
          string | null
        >`CASE WHEN ${column} IS NULL THEN NULL WHEN isfinite(${column}) THEN to_char(${utc}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') ELSE ${column}::text END`,
      ];
    }),
  );

const resultRows = (result: unknown): Array<Record<string, unknown>> =>
  Array.isArray(result) ? result : (result as { rows: Array<Record<string, unknown>> }).rows;

/** Preserve SQL JSON text without expanding large payloads into another object tree. */
const serializeCursorRow = (table: DumpTable, row: Record<string, unknown>): string => {
  const columns = getTableColumns(DUMP_TABLE_REGISTRY[table] as never) as Record<
    string,
    AnyPgColumn
  >;
  const entries = Object.entries(columns).map(([key, column]) => {
    const value = row[key];
    const type = column.getSQLType();
    let encoded: string | undefined;
    if (type === "json" || type === "jsonb") {
      // PostgreSQL has already validated this JSON. Parsing/stringifying it
      // would keep decoded text and several wide copies of a 95 MiB payload
      // alive alongside the escaped SSE frame. The raw token also preserves
      // JSON strings that look like objects and legal special property names.
      if (value !== null && typeof value !== "string")
        throw new Error(`SQL snapshot ${table}.${key} returned invalid JSON text`);
      encoded = value ?? "null";
    } else {
      // FETCH uses the raw driver; retain every registered scalar mapper and
      // the exact timestamp text selected above.
      const mapped =
        value === null || type.startsWith("timestamp") ? value : column.mapFromDriverValue(value);
      if (
        typeof mapped === "number" &&
        (!Number.isFinite(mapped) ||
          (/^(smallint|integer|bigint|smallserial|serial|bigserial)\b/.test(column.getSQLType()) &&
            !Number.isSafeInteger(mapped)))
      )
        throw new ORPCError("PRECONDITION_FAILED", {
          message: `SQL snapshot ${table}.${key} cannot be represented as an exact JSON number`,
        });
      encoded = JSON.stringify(mapped);
    }
    if (encoded === undefined)
      throw new Error(`SQL snapshot ${table}.${key} returned a missing value`);
    return `${JSON.stringify(key)}:${encoded}`;
  });
  const json = `{${entries.join(",")}}`;
  // This table alone has a deliberate credential projection; all other JSON
  // columns remain opaque SQL text throughout the producer.
  return table === "webhookRules"
    ? JSON.stringify(prepareWebhookBackupRow(JSON.parse(json)))
    : json;
};

const readIdentityPage = async (
  tx: BusabaseDatabase,
  table: DumpTable,
  cursorName: ReturnType<typeof sql.identifier>,
  limit: number,
): Promise<string[]> => {
  const result = await tx.execute(sql`FETCH FORWARD ${sql.raw(String(limit))} FROM ${cursorName}`);
  return resultRows(result).map((row) => {
    const id = row[SNAPSHOT_IDENTITY];
    if (typeof id !== "string" || !id)
      throw new Error(`SQL snapshot ${table} returned a missing identity`);
    return id;
  });
};

/** Let the raw driver result go out of scope before awaiting HTTP backpressure. */
const readRowsByIdentity = async (
  tx: BusabaseDatabase,
  table: DumpTable,
  rowsFor: (ids: string[]) => { getSQL(): SQL },
  ids: string[],
) => {
  // Raw execution, like FETCH: serializeCursorRow applies the column mappers.
  const result = await tx.execute(rowsFor(ids).getSQL());
  const rows = resultRows(result).map((row) => ({
    id: row[dumpIdentityKey(table)],
    json: serializeCursorRow(table, row),
  }));
  if (rows.length !== ids.length || rows.some((row, index) => row.id !== ids[index]))
    throw new Error(`SQL snapshot ${table} rows differ from the identities in the same snapshot`);
  return rows;
};

/**
 * Capture auth/tenant ALS while the handler is executing, not when an SSE
 * consumer later calls next() outside the request middleware's context.
 */
export const exportSnapshot = (
  input: ExportSnapshotInput,
  options: { signal?: AbortSignal } = {},
): AsyncGenerator<Event, void, unknown> => {
  requireSpaceManagerForDump();
  const parsed = ExportSnapshotInputSchema.safeParse(input);
  if (!parsed.success)
    throw new ORPCError("BAD_REQUEST", {
      message: "Invalid SQL snapshot options",
      data: { issues: parsed.error.issues },
    });
  const spaceId = getContextSpaceId();
  const runInRequest = AsyncLocalStorage.snapshot();
  const mailbox = new SnapshotMailbox();
  const controller = new AbortController();
  let producer: Promise<void> | undefined;
  const cancel = (reason?: unknown) => {
    if (!controller.signal.aborted)
      controller.abort(
        reason ?? new DOMException("SQL snapshot consumption stopped", "AbortError"),
      );
    mailbox.fail(controller.signal.reason);
  };
  const onAbort = () => cancel(options.signal?.reason);
  if (options.signal?.aborted) onAbort();
  else options.signal?.addEventListener("abort", onAbort, { once: true });

  const produce = async () => {
    controller.signal.throwIfAborted();
    const db = await getDb();
    const counts = Object.fromEntries(tables.map((table) => [table, 0])) as Record<
      DumpTable,
      number
    >;
    let attachmentDependencies = 0;
    await db.transaction(
      async (transaction) =>
        runWithSearchDatabase(transaction as BusabaseDatabase, async () => {
          const tx = transaction as BusabaseDatabase;
          controller.signal.throwIfAborted();
          // Local to this read transaction. An in-flight PostgreSQL page is bounded
          // even if the disconnected caller cannot cancel the driver's Promise.
          await tx.execute(
            sql`SELECT set_config('statement_timeout', ${String(STATEMENT_TIMEOUT_MS)}, true)`,
          );
          // BEGIN alone does not establish a repeatable-read MVCC cut. This read
          // and the physical-column check precede the public start event.
          await tx.execute(sql`SELECT pg_current_snapshot()`);
          await assertPhysicalColumns(tx);
          const columns = Object.fromEntries(
            tables.map((table) => [
              table,
              Object.keys(getTableColumns(DUMP_TABLE_REGISTRY[table] as never)),
            ]),
          ) as Record<DumpTable, string[]>;
          await mailbox.send({
            type: "start",
            version: 1,
            spaceId,
            startedAt: new Date().toISOString(),
            tables,
            columns,
          });
          for (const table of tables) {
            const identity = dumpIdentityColumn(table);
            const ordering = sql`${identity} COLLATE "C"`;
            const cursorName = sql.identifier(`busabase_snapshot_${table}`);
            const selected = Object.fromEntries(
              Object.entries(snapshotColumns(table)).map(([key, value]) => [
                key,
                sql`${value}`.as(key),
              ]),
            );
            const identities = tx
              .select({ identity: sql<string>`${identity}`.as(SNAPSHOT_IDENTITY) })
              .from(DUMP_TABLE_REGISTRY[table] as never)
              .where(dumpSpaceScope(tx, table, spaceId))
              .orderBy(asc(ordering));
            // One server cursor performs each scan/sort once. A C-collated
            // keyset query per page could repeatedly sort a non-C PK index.
            // The cursor sorts identities only: projecting JSON as text before
            // the sort made the first FETCH detoast and sort every payload of a
            // table (212k commits: 23 s on en_US PostgreSQL; over the statement
            // timeout on Cloud's multi-tenant tables). Rows are then read by
            // primary key inside the same snapshot.
            await tx.execute(
              sql`DECLARE ${cursorName} NO SCROLL CURSOR FOR ${identities.getSQL()}`,
            );
            const rowsFor = (ids: string[]) =>
              tx
                .select(selected)
                .from(DUMP_TABLE_REGISTRY[table] as never)
                .where(and(dumpSpaceScope(tx, table, spaceId), inArray(identity, ids)))
                .orderBy(asc(ordering));
            let firstFetch = true;
            let cursor: string | undefined;
            let buffered: string[] = [];
            let bufferedBytes = 0;
            const flush = async () => {
              if (!buffered.length) return;
              const rows = buffered;
              buffered = [];
              bufferedBytes = 0;
              // SQL JSON is data, not an RPC object tree: the generic serde
              // deliberately removes __proto__ keys from nested objects.
              await mailbox.send({
                type: "rows",
                table,
                rowsJson: `[${rows.join(",")}]`,
                count: rows.length,
              });
            };
            for (;;) {
              controller.signal.throwIfAborted();
              // Only the first FETCH scans and sorts; it gets a wider, still
              // finite bound. Every later statement keeps the 30 s bound.
              if (firstFetch)
                await tx.execute(
                  sql`SELECT set_config('statement_timeout', ${String(IDENTITY_SCAN_TIMEOUT_MS)}, true)`,
                );
              const ids = await readIdentityPage(tx, table, cursorName, IDENTITY_BATCH);
              if (firstFetch) {
                await tx.execute(
                  sql`SELECT set_config('statement_timeout', ${String(STATEMENT_TIMEOUT_MS)}, true)`,
                );
                firstFetch = false;
              }
              const size = pageSize(table, parsed.data.limit);
              for (let at = 0; at < ids.length; at += size) {
                controller.signal.throwIfAborted();
                const values = await readRowsByIdentity(
                  tx,
                  table,
                  rowsFor,
                  ids.slice(at, at + size),
                );
                controller.signal.throwIfAborted();
                for (const original of values) {
                  const id = original.id;
                  if (
                    typeof id !== "string" ||
                    !id ||
                    (cursor !== undefined &&
                      Buffer.compare(Buffer.from(cursor), Buffer.from(id)) >= 0)
                  )
                    throw new Error(
                      `SQL snapshot ${table} returned a missing or unordered identity`,
                    );
                  cursor = id;
                  const row = original.json;
                  const bytes = Buffer.byteLength(row);
                  if (buffered.length && bufferedBytes + bytes > EVENT_TARGET_BYTES) await flush();
                  buffered.push(row);
                  bufferedBytes += bytes;
                  counts[table]++;
                  if (bufferedBytes >= EVENT_TARGET_BYTES) await flush();
                }
              }
              if (ids.length < IDENTITY_BATCH) break;
            }
            await tx.execute(sql`CLOSE ${cursorName}`);
            await flush();
            await mailbox.send({ type: "tableEnd", table, count: counts[table] });
          }
          // These are content projections, not raw foreign attachment rows. Pick
          // one deterministic readable-own-Asset anchor per dependency identity.
          const attachmentOrder = sql`${busabaseAssets.attachmentId} COLLATE "C"`;
          const assetOrder = sql`${busabaseAssets.id} COLLATE "C"`;
          let dependencyCursor: string | undefined;
          for (;;) {
            controller.signal.throwIfAborted();
            const anchors = await tx
              .selectDistinctOn([attachmentOrder], snapshotColumns("assets"))
              .from(busabaseAssets)
              .innerJoin(attachments, eq(attachments.id, busabaseAssets.attachmentId))
              .where(
                and(
                  eq(busabaseAssets.spaceId, spaceId),
                  ne(attachments.spaceId, spaceId),
                  dependencyCursor ? gt(attachmentOrder, dependencyCursor) : undefined,
                ),
              )
              .orderBy(asc(attachmentOrder), asc(assetOrder))
              .limit(Math.min(parsed.data.limit, 500));
            for (const asset of anchors as unknown as AssetAttachmentBackupAnchor[]) {
              controller.signal.throwIfAborted();
              const dependency = await exportAssetAttachmentSnapshotDependency(tx, asset);
              controller.signal.throwIfAborted();
              await mailbox.send({ type: "attachmentDependency", dependency });
              dependencyCursor = asset.attachmentId;
              attachmentDependencies++;
            }
            if (anchors.length < Math.min(parsed.data.limit, 500)) break;
          }
          controller.signal.throwIfAborted();
        }),
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
    // No success event until COMMIT has succeeded and the SQL connection is free.
    controller.signal.throwIfAborted();
    await mailbox.send({ type: "complete", tables: counts, attachmentDependencies });
    mailbox.finish();
  };

  const iterator = (async function* () {
    producer = runInRequest(produce).catch((error: unknown) => mailbox.fail(error));
    try {
      for (;;) {
        const next = await mailbox.read();
        if (next.done) return;
        yield next.value;
      }
    } finally {
      if (!mailbox.ended) cancel();
      await producer;
      options.signal?.removeEventListener("abort", onAbort);
    }
  })();
  // AsyncGenerator.return normally waits behind a pending next(). Abort the
  // mailbox first so HTTP body cancellation can wake that next immediately.
  const nativeReturn = iterator.return.bind(iterator);
  iterator.return = async (value) => {
    if (!mailbox.ended) cancel();
    options.signal?.removeEventListener("abort", onAbort);
    return nativeReturn(value);
  };
  const nativeThrow = iterator.throw.bind(iterator);
  iterator.throw = async (error) => {
    cancel(error);
    options.signal?.removeEventListener("abort", onAbort);
    return nativeThrow(error);
  };
  return iterator;
};
