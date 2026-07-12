import "server-only";

import type { ExportTablesInput, ExportTablesVO } from "busabase-contract/domains/dump/types";
import { and, asc, eq, gt } from "drizzle-orm";
import { getContextSpaceId } from "../../../context";
import { getDb } from "../../../db";
import { DUMP_TABLE_REGISTRY } from "./table-registry";

/**
 * Cursor-paginated raw SELECT of a dump-eligible table, scoped explicitly to
 * the caller's context space (this is a bulk table scan, not a normal
 * space-scoped logic fn that can lean on RLS/middleware alone — the `eq`
 * below is load-bearing). Ordered by `id` for a stable, gap-tolerant cursor.
 */
export const exportTableRows = async (input: ExportTablesInput): Promise<ExportTablesVO> => {
  const table = DUMP_TABLE_REGISTRY[input.table];
  const spaceId = getContextSpaceId();
  const db = await getDb();

  const where = input.cursor
    ? and(eq(table.spaceId, spaceId), gt(table.id, input.cursor))
    : eq(table.spaceId, spaceId);

  const rows = await db
    .select()
    .from(table as never)
    .where(where)
    .orderBy(asc(table.id))
    .limit(input.limit);

  const typedRows = rows as Array<Record<string, unknown> & { id: string }>;
  const nextCursor = typedRows.length === input.limit ? typedRows[typedRows.length - 1].id : null;

  return { rows: typedRows, nextCursor };
};
