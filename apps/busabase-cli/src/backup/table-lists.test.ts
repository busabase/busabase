import { DumpTableSchema, ImportTablesInputSchema } from "busabase-contract/domains/dump/types";
import { describe, expect, it } from "vitest";
import { IMPORT_ORDER } from "./import/full-importer.js";

/**
 * Storage-backed pseudo-tables the importer sends to `dump.importTables`
 * outside of `IMPORT_ORDER`: their content lives in object storage, not a DB
 * row, so they have no place in the FK-safe table order but must still be
 * accepted by the contract and must still be uploaded before the DB rows that
 * reference them.
 */
const PSEUDO_TABLES = ["docBodies", "attachmentBlobs", "assetTextBlobs"] as const;

/**
 * Drift guard for the importer's hand-maintained FK-safe order.
 *
 * The CLI can't import the server-only core registry, so
 * `IMPORT_ORDER` is a separate copy of the table set that has to be kept FK-safe
 * by hand. The contract's `DumpTableSchema` is the single source of truth for
 * *which* tables exist; this test fails the moment a table is added to (or
 * removed from) the contract without updating `IMPORT_ORDER` — the exact way the
 * `nodePrincipals` permissions table was originally missed on backup/restore.
 */
describe("backup/restore import order stays in sync with the dump contract", () => {
  it("IMPORT_ORDER covers exactly the tables in DumpTableSchema", () => {
    expect([...IMPORT_ORDER].sort()).toEqual([...DumpTableSchema.options].sort());
  });

  it("IMPORT_ORDER has no duplicate entries", () => {
    expect(IMPORT_ORDER.length).toBe(new Set(IMPORT_ORDER).size);
  });

  it("nodePrincipals is imported after nodes (its FK parent)", () => {
    // Regression anchor: nodeId / sourceNodeId FK into busabase_nodes.
    expect(IMPORT_ORDER.indexOf("nodePrincipals")).toBeGreaterThan(IMPORT_ORDER.indexOf("nodes"));
  });

  it.each(PSEUDO_TABLES)("the contract accepts the %s pseudo-table", (table) => {
    // Keeps the guard above honest instead of weakened: a pseudo-table is
    // legitimately absent from DumpTableSchema/IMPORT_ORDER, so assert its
    // acceptance here rather than loosening the exact-set equality.
    const parsed = ImportTablesInputSchema.safeParse({ sessionId: "sess_1", table, rows: [] });
    expect(parsed.success).toBe(true);
  });

  it.each(PSEUDO_TABLES)("%s is NOT in IMPORT_ORDER (it is storage, not a DB row)", (table) => {
    // A pseudo-table that leaked into IMPORT_ORDER would be uploaded twice —
    // once explicitly, once by the table loop — and `DUMP_TABLE_REGISTRY` has
    // no entry for it, so the second pass would fault on the server.
    expect(IMPORT_ORDER).not.toContain(table as unknown as (typeof IMPORT_ORDER)[number]);
  });

  it("assetTexts is imported after assets (its FK parent)", () => {
    // Regression anchor for the asset-text blob loss: the `assetTextBlobs`
    // pseudo-table is uploaded ahead of the whole IMPORT_ORDER loop, so the
    // only ordering left to protect is the row's own FK into busabase_assets.
    expect(IMPORT_ORDER.indexOf("assetTexts")).toBeGreaterThan(IMPORT_ORDER.indexOf("assets"));
  });
});
