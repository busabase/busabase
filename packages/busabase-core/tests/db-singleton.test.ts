import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import { db, getDb, getPgliteClient, isPgliteMode } from "../src/db";
import { busabaseBases } from "../src/db/schema";

/**
 * The db singleton + lazy proxy layer (src/db/index.ts) is the foundation every
 * query stands on, so its init / mode-detection / host-injection branches need
 * direct coverage. The ordering matters: the lazy `db` proxy path only runs
 * while the global singleton is still uninitialized, so that case is exercised
 * first, before any getDb() call materializes the instance.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("busabase-core db singleton", () => {
  let dataDir = "";
  let originalCwd = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-dbsingleton-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    if (originalCwd) {
      process.chdir(originalCwd);
    }
    if (dataDir) {
      await rm(dataDir, { recursive: true, force: true });
    }
  });

  it("lazily initializes and runs a query through the db proxy chain", async () => {
    // First touch of `db` — singleton is null, so this drives createLazyChain:
    // get(select) → apply → get(from) → apply → await, which triggers initAsync,
    // runs the migrations, and executes the SQL.
    const rows = await db.select().from(busabaseBases);
    expect(Array.isArray(rows)).toBe(true);
  });

  it("returns a stable singleton from getDb()", async () => {
    const a = await getDb();
    const b = await getDb();
    expect(a).toBe(b);
  });

  it("reports pglite mode from the database url", () => {
    expect(isPgliteMode()).toBe(true);
    const previous = process.env.PG_DATABASE_URL;
    process.env.PG_DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    try {
      expect(isPgliteMode()).toBe(false);
    } finally {
      process.env.PG_DATABASE_URL = previous;
    }
  });

  it("exposes a usable PGlite client with exec()", async () => {
    const client = await getPgliteClient();
    expect(typeof (client as { exec: unknown }).exec).toBe("function");
  });

  it("refuses the PGlite client when not in pglite mode", async () => {
    const previous = process.env.PG_DATABASE_URL;
    process.env.PG_DATABASE_URL = "postgres://user:pass@localhost:5432/db";
    try {
      await expect(getPgliteClient()).rejects.toThrow(/only available in pglite mode/);
    } finally {
      process.env.PG_DATABASE_URL = previous;
    }
  });

  it("prefers a host-injected db over the local singleton", async () => {
    const real = await getDb();
    // A sentinel standing in for a host (busabase-cloud) drizzle client.
    const injected = { __sentinel: true } as unknown as Parameters<
      typeof runWithBusabaseContext
    >[0]["db"];

    await runWithBusabaseContext({ db: injected }, async () => {
      expect(await getDb()).toBe(injected);
      // The `db` proxy forwards property access to the injected client too.
      expect((db as unknown as { __sentinel: boolean }).__sentinel).toBe(true);
    });

    // Outside the context the local singleton is restored.
    expect(await getDb()).toBe(real);
  });
});
