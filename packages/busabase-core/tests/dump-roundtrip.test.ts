import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { DumpTableSchema } from "busabase-contract/domains/dump/types";
import { resetStorage, storage } from "openlib/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID } from "../src/context";
import { enScenario } from "../src/demo/scenarios/en";
import { DUMP_IMPORT_ORDER } from "../src/domains/dump/logic/table-registry";
import { seedScenario } from "../src/logic/store";
import { busabaseRouter } from "../src/router";

/**
 * FULL, real-demo-seed backup round trip — the "seed everything → export →
 * import into a fresh database → verify complete parity" test.
 *
 * Unlike `dump-logic.test.ts` (which drives the import handler with a handful
 * of *fabricated* rows to isolate one code path at a time), this exercises the
 * whole export→import pipeline against the **actual `enScenario` demo dataset**
 * (`pnpm db:seed:all`): every builtin node type (folders, bases + records +
 * fields + views, docs, first-class files, and Skill/Drive/AirApp file-tree
 * nodes whose contents live in real attachment blobs), plus the full change
 * history (commits / change requests / operations / reviews / comments /
 * audit events) and — the regression this test was added for — node-level
 * access grants (`busabase_node_principals`).
 *
 * It is a genuine two-database round trip in one process (the db client is a
 * per-process singleton): seed + export against database A, then reset the
 * singleton and import into a *second, previously-empty* database B on a fresh
 * PGLite dir + a fresh object-storage tree — the closest in-process analogue of
 * a real disaster-recovery restore onto a clean environment. Parity is asserted
 * on the *target*, not just "no error": per-table row counts, doc-body bytes,
 * attachment-blob bytes, extracted-text (`asset-texts`) blob bytes, and the
 * permission grant all survive.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
type Row = Record<string, unknown> & { id: string };

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const EXPORT_LIMIT = 500;
// Rows-per-import-call, mirroring `busabase-dump`'s `full-importer.ts`: the
// server does one `db.insert().values(rows)` per call, so an unbatched insert
// of a large table blows the Postgres bind-parameter ceiling (`08P01`). The
// real importer batches at 200; the round trip must too.
const IMPORT_BATCH = 200;

const importInBatches = async (
  client: Client,
  sessionId: string,
  table: Parameters<Client["dump"]["importTables"]>[0]["table"],
  rows: Array<Record<string, unknown>>,
): Promise<void> => {
  for (let i = 0; i < rows.length; i += IMPORT_BATCH) {
    await client.dump.importTables({ sessionId, table, rows: rows.slice(i, i + IMPORT_BATCH) });
  }
};

/** Every dump-eligible table, drained page by page (proves the cursor terminates too). */
const exportAllTables = async (client: Client): Promise<Map<string, Row[]>> => {
  const out = new Map<string, Row[]>();
  for (const table of DumpTableSchema.options) {
    const rows: Row[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.dump.exportTables({ table, cursor, limit: EXPORT_LIMIT });
      rows.push(...(page.rows as Row[]));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    out.set(table, rows);
  }
  return out;
};

const countsOf = (tables: Map<string, Row[]>): Record<string, number> => {
  const counts: Record<string, number> = {};
  for (const [table, rows] of tables) counts[table] = rows.length;
  return counts;
};

/**
 * Reset the busabase-core db singleton + first-request `ensureReady` cache and
 * the openlib storage singleton, then re-point both at a fresh PGLite dir and a
 * fresh storage tree — so the next `getDb()` / `storage.*` call talks to a
 * brand-new, empty database B instead of the seeded database A. Mirrors the
 * reset incantation in `tests/helpers/seed-scenario.ts`.
 */
type GlobalWithBusabaseState = typeof globalThis & {
  __busabaseCoreDbState?: {
    db: unknown | null;
    client: unknown | null;
    initPromise: Promise<unknown> | null;
  };
  __busabaseReadyBySpace?: Map<string, Promise<void>>;
};

const closeDbSingleton = async () => {
  const g = globalThis as GlobalWithBusabaseState;
  if (g.__busabaseCoreDbState) {
    const prevClient = g.__busabaseCoreDbState.client;
    if (prevClient && typeof (prevClient as { close?: () => Promise<void> }).close === "function") {
      await (prevClient as { close: () => Promise<void> }).close();
    }
    g.__busabaseCoreDbState = { db: null, client: null, initPromise: null };
  }
  if (g.__busabaseReadyBySpace) g.__busabaseReadyBySpace = new Map();
};

describe("dump domain — full demo-seed backup round trip", () => {
  let sourceDir = "";
  let sourceStorageDir = "";
  let targetDir = "";
  let targetStorageDir = "";
  let originalCwd = "";

  // Captured from the SOURCE (database A) before the switch.
  let sourceTables = new Map<string, Row[]>();
  const sourceDocBodies = new Map<string, string>();
  const sourceBlobs = new Map<string, { mimeType: string; base64: string }>();
  const sourceTextBlobs = new Map<string, string>();
  const grantNodeId = enScenario.bases?.[0]?.nodeId ?? "";
  const grantPrincipalId = "usr_roundtrip_reviewer";

  // Captured from the TARGET (database B) after import.
  let targetTables = new Map<string, Row[]>();
  let commitWarnings: string[] = [];

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);

    // ── Database A: seed the full demo, add a permission grant, capture ──────
    sourceDir = await mkdtemp(path.join(os.tmpdir(), "busabase-dump-rt-src-db-"));
    sourceStorageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-dump-rt-src-st-"));
    process.env.PG_DATABASE_URL = `pglite://${sourceDir}`;
    process.env.STORAGE_URL = `local:${sourceStorageDir}?base_url=/api/test/storage`;
    resetStorage();

    await seedScenario(enScenario);

    const sourceClient = createRouterClient(busabaseRouter);
    // A real node-level access grant — this is the row class (busabase_node_principals)
    // that was silently dropped by the backup before it was added to the dump registry.
    // grantNodePrincipal also materializes inherited copies down the subtree, so the
    // round trip covers both the direct grant and its materialized descendants.
    await sourceClient.nodes.principals.add({
      nodeId: grantNodeId,
      principalType: "user",
      principalId: grantPrincipalId,
      role: "write",
    });

    sourceTables = await exportAllTables(sourceClient);

    // Doc bodies (object storage, not a dump table) for every `doc` node.
    for (const node of sourceTables.get("nodes") ?? []) {
      if (node.type !== "doc") continue;
      const doc = await sourceClient.docs.get({ nodeId: node.id });
      sourceDocBodies.set(node.id, doc?.body ?? "");
    }

    // Attachment bytes, read straight off storage A before we swap it away.
    for (const att of sourceTables.get("attachments") ?? []) {
      const storageKey = att.storageKey as string;
      if (!storageKey || !(await storage.objectExists(storageKey))) continue;
      const buf = await storage.getObject(storageKey);
      sourceBlobs.set(storageKey, {
        mimeType: (att.mimeType as string) ?? "application/octet-stream",
        base64: buf.toString("base64"),
      });
    }

    // Extracted-text bytes for every asset text that owns its OWN object.
    // `dump.exportAssetText` is what decides that (auto-registered rows point
    // at the attachment's own key, already captured above, and re-capturing
    // them would double-write one key); asking the server keeps this test
    // honest to the same rule the real CLI exporter follows.
    for (const assetText of sourceTables.get("assetTexts") ?? []) {
      const info = await sourceClient.dump.exportAssetText({
        assetId: assetText.assetId as string,
      });
      if (!info.downloadUrl) continue;
      if (!(await storage.objectExists(info.textStorageKey))) continue;
      const buf = await storage.getObject(info.textStorageKey);
      sourceTextBlobs.set(info.textStorageKey, buf.toString("base64"));
    }

    // ── Switch to a genuinely fresh Database B + empty storage tree ──────────
    await closeDbSingleton();
    targetDir = await mkdtemp(path.join(os.tmpdir(), "busabase-dump-rt-tgt-db-"));
    targetStorageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-dump-rt-tgt-st-"));
    process.env.PG_DATABASE_URL = `pglite://${targetDir}`;
    process.env.STORAGE_URL = `local:${targetStorageDir}?base_url=/api/test/storage`;
    resetStorage();

    const targetClient = createRouterClient(busabaseRouter);

    // ── Import: begin → blobs → tables (FK order) → doc bodies → commit ──────
    const { sessionId } = await targetClient.dump.importBegin();

    const blobRows = [...sourceBlobs.entries()].map(([storageKey, blob]) => ({
      storageKey,
      mimeType: blob.mimeType,
      base64: blob.base64,
    }));
    if (blobRows.length > 0) {
      await importInBatches(targetClient, sessionId, "attachmentBlobs", blobRows);
    }

    const textBlobRows = [...sourceTextBlobs.entries()].map(([textStorageKey, base64]) => ({
      textStorageKey,
      base64,
    }));
    if (textBlobRows.length > 0) {
      await importInBatches(targetClient, sessionId, "assetTextBlobs", textBlobRows);
    }

    for (const table of DUMP_IMPORT_ORDER) {
      const rows = sourceTables.get(table) ?? [];
      if (rows.length === 0) continue;
      await importInBatches(targetClient, sessionId, table, rows);
    }

    const docBodyRows = [...sourceDocBodies.entries()].map(([nodeId, markdown]) => ({
      nodeId,
      markdown,
    }));
    if (docBodyRows.length > 0) {
      await importInBatches(targetClient, sessionId, "docBodies", docBodyRows);
    }

    const commit = await targetClient.dump.importCommit({ sessionId });
    commitWarnings = commit.warnings;

    // Re-drain every table from the target for parity assertions.
    targetTables = await exportAllTables(targetClient);
  }, 120_000);

  afterAll(async () => {
    await closeDbSingleton();
    resetStorage();
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [sourceDir, sourceStorageDir, targetDir, targetStorageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("the demo seed is non-trivial (real content in every major table)", () => {
    const c = countsOf(sourceTables);
    // Guardrail: if the demo scenario ever silently stops seeding these, the
    // "parity" below would pass vacuously. Assert the dataset is actually rich.
    expect(c.nodes).toBeGreaterThan(5);
    expect(c.bases).toBeGreaterThan(0);
    expect(c.records).toBeGreaterThan(0);
    expect(c.fieldValues).toBeGreaterThan(0);
    expect(c.commits).toBeGreaterThan(0);
    expect(c.attachments).toBeGreaterThan(0);
    expect(c.assets).toBeGreaterThan(0);
    // The grant we added + its materialized inherited copies.
    expect(c.nodePrincipals).toBeGreaterThan(0);
    expect(sourceBlobs.size).toBeGreaterThan(0);
    expect(sourceDocBodies.size).toBeGreaterThan(0);
  });

  it("every dump-eligible table round-trips with an identical row count", () => {
    expect(countsOf(targetTables)).toEqual(countsOf(sourceTables));
  });

  it("every row id round-trips (no dropped, added, or renamed rows)", () => {
    for (const table of DumpTableSchema.options) {
      const sourceIds = new Set((sourceTables.get(table) ?? []).map((r) => r.id));
      const targetIds = new Set((targetTables.get(table) ?? []).map((r) => r.id));
      expect({ table, ids: targetIds }).toEqual({ table, ids: sourceIds });
    }
  });

  it("node-level permission grants survive the round trip (the regression)", () => {
    // Count parity first — a stale registry (missing nodePrincipals) makes this 0.
    expect((targetTables.get("nodePrincipals") ?? []).length).toBe(
      (sourceTables.get("nodePrincipals") ?? []).length,
    );
    // And the specific grant we added is present on the target, intact.
    const grant = (targetTables.get("nodePrincipals") ?? []).find(
      (r) => r.principalId === grantPrincipalId && r.nodeId === grantNodeId,
    );
    expect(grant).toBeDefined();
    expect(grant?.role).toBe("write");
    // Re-stamped onto the target space, not left pointing at the source.
    expect(grant?.spaceId).toBe(LOCAL_SPACE_ID);
  });

  it("doc-body bytes are byte-identical after restore", async () => {
    const targetClient = createRouterClient(busabaseRouter);
    expect(sourceDocBodies.size).toBeGreaterThan(0);
    for (const [nodeId, body] of sourceDocBodies) {
      const restored = await targetClient.docs.get({ nodeId });
      expect(restored?.body).toBe(body);
    }
  });

  it("attachment blob bytes are byte-identical after restore", async () => {
    expect(sourceBlobs.size).toBeGreaterThan(0);
    for (const [storageKey, blob] of sourceBlobs) {
      expect(await storage.objectExists(storageKey)).toBe(true);
      const restored = await storage.getObject(storageKey);
      expect(restored.toString("base64")).toBe(blob.base64);
    }
  });

  it("asset-text blob bytes are byte-identical after restore", async () => {
    // The regression this pass was added for: `assetTexts` ROWS always
    // round-tripped, so the restored space claimed `status: "present"` over
    // extracted text whose object had never been captured — grep then returned
    // zero matches for content the source could find, with no error anywhere.
    // These keys are content-addressed by the sha256 of their own bytes, so
    // "byte-identical" is not a nicety here: one byte of drift and the key no
    // longer describes what lives at it.
    expect(sourceTextBlobs.size).toBeGreaterThan(0);
    for (const [textStorageKey, base64] of sourceTextBlobs) {
      expect(await storage.objectExists(textStorageKey)).toBe(true);
      const restored = await storage.getObject(textStorageKey);
      expect(restored.toString("base64")).toBe(base64);
    }
  });

  it("importCommit reports no integrity warnings for a complete, faithful restore", () => {
    // Every FK-less reference (fieldValues.fieldId, assets.attachmentId,
    // attachment + asset-text blob completeness, recordLinks endpoints)
    // resolves because the whole space was imported — a warning here means the
    // restore left a dangling reference.
    expect(commitWarnings).toEqual([]);
  });
});
