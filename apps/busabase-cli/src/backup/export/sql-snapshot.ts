import { type DumpTable, DumpTableSchema } from "busabase-contract/domains/dump/types";
import type { BusabaseClient } from "busabase-sdk";
import { isSafeNodeIdentity } from "../node-identity.js";

export type SnapshotRow = Record<string, unknown>;
export type SnapshotDependency = {
  assetId: string;
  attachmentId: string;
  downloadUrl: string;
  materializedAttachment: SnapshotRow;
};
export type SqlCapture = {
  version: 1;
  mode: "repeatable-read" | "legacy-paginated";
  startedAt?: string;
  completedAt: string;
  tables: Record<string, number>;
};
export class SnapshotProtocolError extends Error {
  constructor(message: string) {
    super(`Invalid SQL snapshot: ${message}. No archive was published.`);
    this.name = "SnapshotProtocolError";
  }
}
class SnapshotInterruptedError extends Error {}
const TABLES = [...DumpTableSchema.options];
const identity = (table: DumpTable) =>
  table === "spaceInstructions" || table === "spaceWelcome" ? "spaceId" : "id";
const object = (value: unknown): value is SnapshotRow =>
  !!value &&
  typeof value === "object" &&
  !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;
function fail(message: string): never {
  throw new SnapshotProtocolError(message);
}
const exactKeys = (value: SnapshotRow, keys: string[], label: string) => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, i) => key !== expected[i]))
    fail(`${label} has missing or unknown fields`);
};
function validateJson(value: unknown, ancestors = new Set<object>()): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number" && Number.isFinite(value)) return;
  if (value instanceof Date && Number.isFinite(value.getTime())) return;
  if (!value || typeof value !== "object" || ancestors.has(value))
    fail("row contains a non-JSON value or cycle");
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (!Object.hasOwn(value, i)) fail("row contains a sparse array");
      validateJson(value[i], ancestors);
    }
  } else if (object(value)) {
    for (const child of Object.values(value)) validateJson(child, ancestors);
  } else fail("row contains a non-JSON object");
  ancestors.delete(value);
}

const count = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const status = (error: unknown) =>
  object(error) ? Number(error.status) : Number((error as { status?: number } | undefined)?.status);
export function isUnsupportedSnapshot(error: unknown): boolean {
  const info = error as { code?: unknown; status?: unknown; message?: unknown } | undefined;
  if (Number(info?.status) === 401 || Number(info?.status) === 403) return false;
  return (
    Number(info?.status) === 404 ||
    Number(info?.status) === 501 ||
    info?.code === "NOT_FOUND" ||
    info?.code === "NOT_IMPLEMENTED" ||
    /^(?:HTTP 404|not found|endpoint not found|unknown procedure(?: .*)?|no procedure(?: .*)?|cannot post .*)$/i.test(
      String(info?.message ?? ""),
    )
  );
}
const isPermanent = (error: unknown) =>
  error instanceof SnapshotProtocolError || [400, 401, 403, 409, 422].includes(status(error));

type CaptureOptions = {
  client: BusabaseClient;
  spaceId: string;
  limit: number;
  retries: number;
  reset: () => Promise<void>;
  rows: (table: DumpTable, rows: SnapshotRow[]) => Promise<void>;
  tableEnd: (table: DumpTable, count: number) => Promise<void>;
  dependency: (value: SnapshotDependency) => Promise<void>;
  legacy: () => Promise<Record<string, number>>;
  log: (message: string) => void;
  retryDelayMs?: number;
};

/** Each failed attempt is discarded in full; only verified content blobs resume. */
export async function captureSqlSnapshot(options: CaptureOptions): Promise<SqlCapture> {
  const method = (
    options.client.dump as unknown as {
      exportSnapshot?: (input: { limit: number }) => Promise<AsyncIterable<unknown>>;
    }
  ).exportSnapshot;
  let observed = false;
  const legacy = async () => {
    options.log(
      "WARNING: server has no SQL snapshot endpoint; legacy pagination is not a consistent point-in-time view. Concurrent changes can alter or invalidate this backup. Upgrade the server for repeatable-read SQL capture.",
    );
    await options.reset();
    const tables = await options.legacy();
    return {
      version: 1 as const,
      mode: "legacy-paginated" as const,
      completedAt: new Date().toISOString(),
      tables,
    };
  };
  if (typeof method !== "function") return legacy();
  for (let attempt = 0; ; attempt++) {
    await options.reset();
    try {
      const stream = await method({ limit: options.limit });
      if (!stream || typeof stream[Symbol.asyncIterator] !== "function")
        fail("endpoint did not return an event iterator");
      let started = false,
        completed = false,
        tableIndex = 0,
        tableCount = 0;
      let lastId: string | undefined, lastDependencyId: string | undefined;
      let dependencyCount = 0,
        startedAt = "";
      const counts: Record<string, number> = {};
      const columns: Record<string, string[]> = {};
      for await (const input of stream) {
        observed = true;
        if (!object(input) || typeof input.type !== "string") fail("event is not a typed object");
        if (completed) fail("event occurred after complete");
        if (input.type === "start") {
          if (started) fail("duplicate start event");
          exactKeys(
            input,
            ["type", "version", "spaceId", "startedAt", "tables", "columns"],
            "start",
          );
          if (
            input.version !== 1 ||
            input.spaceId !== options.spaceId ||
            typeof input.startedAt !== "string" ||
            !Number.isFinite(Date.parse(input.startedAt))
          )
            fail("unsupported version, source space or start timestamp");
          if (
            !Array.isArray(input.tables) ||
            input.tables.length !== TABLES.length ||
            input.tables.some((table, i) => table !== TABLES[i])
          )
            fail("table registry or order differs; update the CLI");
          if (!object(input.columns)) fail("missing table column inventory");
          exactKeys(input.columns, TABLES, "column inventory");
          for (const table of TABLES) {
            const names = input.columns[table];
            if (
              !Array.isArray(names) ||
              names.length === 0 ||
              names.some((name) => typeof name !== "string" || !name) ||
              new Set(names).size !== names.length ||
              !names.includes(identity(table))
            )
              fail(`invalid ${table} columns`);
            columns[table] = names as string[];
          }
          started = true;
          startedAt = input.startedAt;
          continue;
        }
        if (!started) fail("event preceded start");
        if (input.type === "rows") {
          exactKeys(input, ["type", "table", "rowsJson", "count"], "rows");
          const table = TABLES[tableIndex];
          if (
            !table ||
            input.table !== table ||
            typeof input.rowsJson !== "string" ||
            !count(input.count) ||
            input.count === 0
          )
            fail("rows are empty or outside the current table");
          let rows: unknown;
          try {
            rows = JSON.parse(input.rowsJson);
          } catch {
            fail(`${table} rowsJson is not valid JSON`);
          }
          if (!Array.isArray(rows) || rows.length !== input.count)
            fail(`${table} rowsJson is not an array matching its declared count`);
          for (const row of rows) {
            if (!object(row)) fail(`${table} row is not an object`);
            exactKeys(row, columns[table], `${table} row`);
            validateJson(row);
            const id = row[identity(table)];
            if (
              typeof id !== "string" ||
              !id ||
              (lastId !== undefined && Buffer.compare(Buffer.from(lastId), Buffer.from(id)) >= 0)
            )
              fail(`${table} row identity is duplicate or non-advancing`);
            if (table === "nodes" && !isSafeNodeIdentity(id))
              fail("node id is not a safe single segment");
            lastId = id;
          }
          await options.rows(table, rows as SnapshotRow[]);
          tableCount += rows.length;
          continue;
        }
        if (input.type === "tableEnd") {
          exactKeys(input, ["type", "table", "count"], "tableEnd");
          const table = TABLES[tableIndex];
          if (!table || input.table !== table || !count(input.count) || input.count !== tableCount)
            fail("table end sequence or row count differs");
          counts[table] = tableCount;
          await options.tableEnd(table, tableCount);
          tableIndex++;
          tableCount = 0;
          lastId = undefined;
          continue;
        }
        if (input.type === "attachmentDependency") {
          exactKeys(input, ["type", "dependency"], "attachmentDependency");
          if (tableIndex !== TABLES.length || !object(input.dependency))
            fail("attachment dependency preceded table completion");
          const value = input.dependency;
          exactKeys(
            value,
            ["assetId", "attachmentId", "downloadUrl", "materializedAttachment"],
            "dependency",
          );
          if (
            typeof value.assetId !== "string" ||
            !value.assetId ||
            typeof value.attachmentId !== "string" ||
            !value.attachmentId ||
            typeof value.downloadUrl !== "string" ||
            !value.downloadUrl ||
            !object(value.materializedAttachment)
          )
            fail("malformed attachment dependency");
          if (
            lastDependencyId !== undefined &&
            Buffer.compare(Buffer.from(lastDependencyId), Buffer.from(value.attachmentId)) >= 0
          )
            fail("duplicate or non-advancing attachment dependency");
          lastDependencyId = value.attachmentId;
          dependencyCount++;
          await options.dependency(value as SnapshotDependency);
          continue;
        }
        if (input.type === "complete") {
          exactKeys(input, ["type", "tables", "attachmentDependencies"], "complete");
          if (
            tableIndex !== TABLES.length ||
            !object(input.tables) ||
            !count(input.attachmentDependencies) ||
            input.attachmentDependencies !== dependencyCount
          )
            fail("capture completed before all tables/dependencies");
          exactKeys(input.tables, TABLES, "complete table counts");
          for (const table of TABLES)
            if (!count(input.tables[table]) || input.tables[table] !== counts[table])
              fail(`complete count differs for ${table}`);
          completed = true;
          continue;
        }
        fail(`unknown event type ${input.type}`);
      }
      if (!completed)
        throw new SnapshotInterruptedError("SQL snapshot stream ended without its complete marker");
      return {
        version: 1,
        mode: "repeatable-read",
        startedAt,
        completedAt: new Date().toISOString(),
        tables: counts,
      };
    } catch (error) {
      if (!observed && isUnsupportedSnapshot(error)) return legacy();
      if (isPermanent(error) || attempt >= options.retries) throw error;
      options.log(
        `retrying the entire SQL snapshot (${attempt + 1}/${options.retries}); discarded all rows from the interrupted attempt: ${error instanceof Error ? error.message : String(error)}`,
      );
      await new Promise((resolve) =>
        setTimeout(resolve, (options.retryDelayMs ?? 1000) * (attempt + 1)),
      );
    }
  }
}
