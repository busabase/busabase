import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { ORPCError } from "@orpc/server";
import { type DumpTable, DumpTableSchema } from "busabase-contract/domains/dump/types";
import { count, sql } from "drizzle-orm";
import { storage } from "openlib/storage";
import { z } from "zod";
import type { BusabaseDatabase } from "../../../context";
import { DUMP_TABLE_REGISTRY, dumpIdentityColumn, dumpSpaceScope } from "./table-registry";

export type ReplayTableCounts = Record<DumpTable, number>;
export const normalizeReplayCounts = (input: Partial<ReplayTableCounts>): ReplayTableCounts =>
  Object.fromEntries(
    DumpTableSchema.options.map((table) => [table, input[table] ?? 0]),
  ) as ReplayTableCounts;

/** Constant-memory, order-independent identity coverage; values are checked separately in SQL. */
export class ReplayIdentityFingerprint {
  count = 0;
  private sum = 0n;
  private xor = 0n;
  add(id: string): void {
    const value = BigInt(`0x${createHash("sha256").update(JSON.stringify(id)).digest("hex")}`);
    this.count++;
    this.sum = (this.sum + value) & ((1n << 256n) - 1n);
    this.xor ^= value;
  }
  summary(): { count: number; sum: string; xor: string } {
    return {
      count: this.count,
      sum: this.sum.toString(16).padStart(64, "0"),
      xor: this.xor.toString(16).padStart(64, "0"),
    };
  }
  equals(other: ReplayIdentityFingerprint): boolean {
    return this.count === other.count && this.sum === other.sum && this.xor === other.xor;
  }
}

const rowsOf = (result: unknown): Array<{ id: string }> =>
  (Array.isArray(result) ? result : (result as { rows: unknown[] }).rows) as Array<{ id: string }>;

/** One read snapshot and bounded FETCH pages, without retaining millions of ids. */
export const fingerprintReplayTable = async (
  db: BusabaseDatabase,
  tableName: DumpTable,
  spaceId: string,
): Promise<ReplayIdentityFingerprint> =>
  db.transaction(async (tx) => {
    const fingerprint = new ReplayIdentityFingerprint();
    const cursor = sql.identifier(`restore_identity_${randomBytes(12).toString("hex")}`);
    await tx.execute(sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY`);
    await tx.execute(
      sql`DECLARE ${cursor} NO SCROLL CURSOR FOR SELECT ${dumpIdentityColumn(tableName)} AS id FROM ${DUMP_TABLE_REGISTRY[tableName]} WHERE ${dumpSpaceScope(tx, tableName, spaceId)}`,
    );
    try {
      for (;;) {
        const rows = rowsOf(await tx.execute(sql`FETCH FORWARD 2000 FROM ${cursor}`));
        for (const row of rows) fingerprint.add(row.id);
        if (rows.length < 2000) break;
      }
    } finally {
      await tx.execute(sql`CLOSE ${cursor}`);
    }
    return fingerprint;
  });

export const assertReplayTableCounts = async (
  db: BusabaseDatabase,
  spaceId: string,
  expected: ReplayTableCounts,
  exact: boolean,
): Promise<void> => {
  for (const table of DumpTableSchema.options) {
    const [row] = (await db
      .select({ value: count() })
      .from(DUMP_TABLE_REGISTRY[table] as never)
      .where(dumpSpaceScope(db, table, spaceId))) as Array<{ value: number }>;
    const actual = Number(row.value);
    if (exact ? actual !== expected[table] : actual > expected[table])
      throw new ORPCError("CONFLICT", {
        message: `Cannot replay archive: target ${table} has ${actual} rows; archive declares ${expected[table]}. No replay objects were written by this check.`,
      });
  }
};

const CompletedSchema = z
  .object({
    version: z.literal(1),
    spaceId: z.string().min(1),
    sourceSpaceId: z.string().min(1),
    sourceArchiveChecksum: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    preserveViewMetadata: z.boolean(),
    expectedTables: z.partialRecord(DumpTableSchema, z.number().int().nonnegative()).optional(),
    completedAt: z.string().datetime(),
  })
  .strict();
export type CompletedImportControl = z.infer<typeof CompletedSchema>;
export const completedImportControlKey = (spaceId: string): string =>
  `busabase/dump-staging-v1/${createHash("sha256").update(spaceId).digest("hex")}/completed.json`;

/** Host control only: never part of the workspace SQL/object inventory. */
export const readCompletedImportControl = async (
  spaceId: string,
): Promise<CompletedImportControl | null> => {
  const key = completedImportControlKey(spaceId);
  let bytes: Buffer;
  try {
    bytes = await storage.getObject(key);
  } catch (error) {
    const value = error as { code?: string; name?: string; message?: string };
    if (
      value?.code === "ENOENT" ||
      value?.name === "NoSuchKey" ||
      value?.name === "NotFound" ||
      value?.message === `Object not found: ${key}`
    )
      return null;
    throw error;
  }
  if (bytes.length > 16384)
    throw new ORPCError("CONFLICT", { message: "Completed restore control is invalid" });
  const value = CompletedSchema.parse(JSON.parse(bytes.toString("utf8")));
  if (value.spaceId !== spaceId)
    throw new ORPCError("CONFLICT", {
      message: "Completed restore control belongs to another space",
    });
  return value;
};

export const writeCompletedImportControl = async (input: CompletedImportControl): Promise<void> => {
  const control = CompletedSchema.parse(input);
  await storage.uploadFileToKey(
    Buffer.from(JSON.stringify(control)),
    completedImportControlKey(control.spaceId),
    "application/json",
  );
};
