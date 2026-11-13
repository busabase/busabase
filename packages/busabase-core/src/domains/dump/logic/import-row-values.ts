import "server-only";

import { ORPCError } from "@orpc/server";
import type { DumpTable } from "busabase-contract/domains/dump/types";
import { and, eq, getTableColumns, is, or, SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { BusabaseDatabase } from "../../../context";
import {
  DUMP_TABLE_REGISTRY,
  dumpIdentityColumn,
  dumpIdentityKey,
  dumpSpaceScope,
} from "./table-registry";

type Row = Record<string, unknown>;
type DumpPgTable = (typeof DUMP_TABLE_REGISTRY)[DumpTable];

/** Preserve PostgreSQL microseconds and normalize legacy offsets without JS Date. */
export const coerceDateColumns = <T extends Row>(table: DumpPgTable, row: T): T => {
  const columns = getTableColumns(table as never) as Record<string, AnyPgColumn>;
  const coerced: Row = { ...row };
  for (const [key, column] of Object.entries(columns)) {
    const value = coerced[key];
    if (column.dataType !== "date" || !(typeof value === "string" || value instanceof Date))
      continue;
    if (value instanceof Date && !Number.isFinite(value.getTime()))
      throw new ORPCError("BAD_REQUEST", { message: "Archive contains an invalid timestamp" });
    const text = typeof value === "string" ? value : value.toISOString();
    if (
      (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(text) &&
        text !== "infinity" &&
        text !== "-infinity") ||
      !column.getSQLType().startsWith("timestamp")
    )
      throw new ORPCError("BAD_REQUEST", {
        message: "Archive timestamps must use ISO time with an offset and at most six decimals",
      });
    coerced[key] = column.getSQLType().includes("with time zone")
      ? sql`${text}::timestamptz`
      : sql`(${text}::timestamptz AT TIME ZONE 'UTC')`;
  }
  return coerced as T;
};

/** Exact timestamps are also needed when retaining a pre-import root for rollback. */
export const datePreservingColumns = (table: DumpPgTable): Record<string, AnyPgColumn | SQL> =>
  Object.fromEntries(
    Object.entries(getTableColumns(table as never)).map(([name, value]) => {
      const column = value as AnyPgColumn;
      if (!column.getSQLType().startsWith("timestamp")) return [name, column];
      const utc = column.getSQLType().includes("with time zone")
        ? sql`${column} AT TIME ZONE 'UTC'`
        : sql`${column}`;
      return [
        name,
        sql<
          string | null
        >`CASE WHEN ${column} IS NULL THEN NULL WHEN isfinite(${column}) THEN to_char(${utc}, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') ELSE ${column}::text END`,
      ];
    }),
  );

/**
 * Reuse only rows whose offered columns still match the same archive. JSONB
 * compares object keys semantically while preserving arrays, types and nulls;
 * timestamp SQL expressions retain all six decimals. No target row is updated.
 */
export const assertImportReplayRowsMatch = async (
  db: BusabaseDatabase,
  tableName: DumpTable,
  spaceId: string,
  rows: Row[],
  options: { revokedByRestore?: ReadonlySet<string> } = {},
): Promise<void> => {
  const table = DUMP_TABLE_REGISTRY[tableName];
  const columns = getTableColumns(table as never) as Record<string, AnyPgColumn>;
  const identity = dumpIdentityColumn(tableName);
  const identityKey = dumpIdentityKey(tableName);
  const offeredIds = new Set<string>();
  for (const row of rows) {
    const id = row[identityKey];
    if (typeof id !== "string" || !id || offeredIds.has(id))
      throw new ORPCError("BAD_REQUEST", {
        message: `Invalid or duplicate ${tableName} replay id`,
      });
    offeredIds.add(id);
  }
  for (let offset = 0; offset < rows.length; offset += 200) {
    const batch = rows.slice(offset, offset + 200);
    const predicates = batch.map((original) => {
      const row = coerceDateColumns(table, original);
      const id = row[identityKey] as string;
      return and(
        eq(identity, id),
        ...Object.entries(row).map(([key, value]) => {
          const column = columns[key];
          if (!column || value === undefined)
            throw new ORPCError("BAD_REQUEST", {
              message: `Unsupported ${tableName} replay column ${key}`,
            });
          if (
            key === "revokedAt" &&
            (tableName === "routerGrants" || tableName === "embedLinks") &&
            options.revokedByRestore?.has(id)
          ) {
            // The security policy assigns a fresh revocation time on the first
            // restore. A retry may reuse that revocation, never an active grant.
            return sql`${column} IS NOT NULL`;
          }
          // Only date coercion creates SQL expressions. User JSON may have
          // constructor/__proto__/toJSON keys and is always bound as JSONB.
          const expected =
            column.dataType === "date" && is(value, SQL) ? value : sql.param(value, column);
          return sql`${column} IS NOT DISTINCT FROM ${expected}`;
        }),
      );
    });
    const matched = await db
      .select({ id: identity })
      .from(table as never)
      .where(and(dumpSpaceScope(db, tableName, spaceId), or(...predicates)));
    const matchingIds = new Set((matched as Array<{ id: string }>).map((row) => row.id));
    const difference = batch.find((row) => !matchingIds.has(row[identityKey] as string));
    if (difference)
      throw new ORPCError("CONFLICT", {
        message:
          `Cannot resume: ${tableName} row ${String(difference[identityKey])} differs from the ` +
          "offered archive. Restore into an empty target or continue the same unchanged archive; " +
          "existing row contents were not overwritten.",
      });
  }
};
