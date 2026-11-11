import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, getDb, getPgliteClient } from "../src/db";

/**
 * `closeDb` exists so a test can delete a PGLite data dir safely. Deleting it
 * while PGLite is still open either failed with ENOTEMPTY (a late WAL write
 * landed during the delete) or left PGLite spinning forever on a flush into
 * files that no longer existed — a CI job that hung until it was killed.
 */

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("closeDb", () => {
  let originalCwd = "";
  const dirs: string[] = [];

  beforeAll(() => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
  });

  afterAll(async () => {
    await closeDb();
    delete process.env.PG_DATABASE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of dirs) await rm(dir, { recursive: true, force: true });
  });

  const freshDir = async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "busabase-close-db-"));
    dirs.push(dir);
    return dir;
  };

  it("closes the open PGLite so its data dir can be deleted, then opens a fresh one", async () => {
    const first = await freshDir();
    process.env.PG_DATABASE_URL = `pglite://${first}`;
    const db = await getDb();
    await db.execute(sql`create table close_db_probe (id int)`);
    await db.execute(sql`insert into close_db_probe select generate_series(1, 2000)`);
    const client = await getPgliteClient();

    await closeDb();

    expect(client.closed).toBe(true);
    await rm(first, { recursive: true, force: true });
    expect(existsSync(first)).toBe(false);

    const second = await freshDir();
    process.env.PG_DATABASE_URL = `pglite://${second}`;
    const reopened = await getDb();
    expect(reopened).not.toBe(db);
    const rows = await reopened.execute(sql`select to_regclass('close_db_probe') as probe`);
    expect(
      (rows as unknown as { rows: Array<{ probe: string | null }> }).rows[0]?.probe,
    ).toBeNull();
  }, 120_000);

  it("is a no-op when nothing is open, and can be called twice", async () => {
    await closeDb();
    await expect(closeDb()).resolves.toBeUndefined();
  });
});
