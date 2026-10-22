import { mkdtemp, readdir, rm } from "node:fs/promises";
import { createRequire, syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * A failed PGLite start must not move the data directory out from under itself.
 *
 * `initPglite` used to start PGLite with `await new PGlite(dir)`, which returns
 * before PGLite has opened anything, then ran migrations straight away. When a
 * migration failed — here, the commonest way: `src/db/migrations` is not under
 * the working directory — the "unreadable data dir" recovery renamed the whole
 * directory aside and opened a fresh one, while the first, abandoned instance
 * was still initializing in the background. That instance then ran PGLite's own
 * `existsSync(dir) || mkdirSync(dir)` against a directory that had just been
 * renamed away and re-created, and died with `EEXIST` as an unhandled rejection
 * — failing whole CI runs with every test green. Meanwhile every such start
 * left a `busabase.quarantined-<ts>` copy behind, and the same path would move
 * a real user's database aside over a migration bug that has nothing to do with
 * their data.
 *
 * The race is real but narrow, so this test pins both halves of the window open:
 * the data directory's async `mkdir` is slow (as when libuv's four-thread pool
 * is queued behind other file work on a loaded CI runner), and whenever a check
 * finds the directory missing, it is created at that instant — the competing
 * `mkdir` landing between PGLite's `existsSync` and its own `mkdirSync`.
 */

const require = createRequire(import.meta.url);
const fs = require("node:fs") as typeof import("node:fs");
// Captured before patching: `syncBuiltinESMExports()` rebinds the ESM named
// export too, so importing `existsSync` would hand back the wrapper itself.
const realExistsSync = fs.existsSync;
const fsPromises = require("node:fs/promises") as typeof import("node:fs/promises");
const realMkdir = fsPromises.mkdir;
const SLOW_MKDIR_MS = 300;

type DbState = { db: unknown; client: { close(): Promise<void> } | null; initPromise: unknown };
type GlobalWithDbState = typeof globalThis & { __busabaseCoreDbState?: DbState };

describe("PGLite start failure (migrations unavailable)", () => {
  let workDir = "";
  let dataDir = "";
  let originalCwd = "";
  let originalUrl: string | undefined;
  let error: unknown;
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  beforeAll(async () => {
    originalCwd = process.cwd();
    originalUrl = process.env.PG_DATABASE_URL;
    // A working directory with no `src/db/migrations`, so migrate() fails.
    workDir = await mkdtemp(path.join(os.tmpdir(), "busabase-init-failure-cwd-"));
    dataDir = path.join(workDir, "data");
    process.chdir(workDir);
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    (globalThis as GlobalWithDbState).__busabaseCoreDbState = undefined;

    // Whenever anything finds the data dir missing, someone else creates it
    // right then — the window PGLite's check-then-mkdir loses.
    fs.existsSync = ((target: Parameters<typeof fs.existsSync>[0]) => {
      const found = realExistsSync(target);
      if (!found && path.resolve(String(target)) === dataDir) {
        fs.mkdirSync(dataDir, { recursive: true });
      }
      return found;
    }) as typeof fs.existsSync;
    fsPromises.mkdir = (async (target: string, options?: unknown) => {
      if (path.resolve(String(target)) === dataDir) {
        await new Promise((resolve) => setTimeout(resolve, SLOW_MKDIR_MS));
      }
      return realMkdir(target, options as Parameters<typeof realMkdir>[1]);
    }) as typeof fsPromises.mkdir;
    syncBuiltinESMExports();
    process.on("unhandledRejection", onUnhandled);

    const { getDb } = await import("../src/db");
    try {
      await getDb();
    } catch (caught) {
      error = caught;
    }
    // Give any instance still initializing in the background time to fail.
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }, 120_000);

  afterAll(async () => {
    process.off("unhandledRejection", onUnhandled);
    fs.existsSync = realExistsSync;
    fsPromises.mkdir = realMkdir;
    syncBuiltinESMExports();
    const state = (globalThis as GlobalWithDbState).__busabaseCoreDbState;
    await state?.client?.close().catch(() => undefined);
    (globalThis as GlobalWithDbState).__busabaseCoreDbState = undefined;
    if (originalUrl !== undefined) process.env.PG_DATABASE_URL = originalUrl;
    if (originalCwd) process.chdir(originalCwd);
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("reports the migration problem to the caller", () => {
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("_journal.json");
  });

  it("leaves no PGLite instance failing in the background", () => {
    expect(unhandled.map((reason) => String(reason))).toEqual([]);
  });

  it("keeps the data directory where it was, with no quarantined copy", async () => {
    expect(realExistsSync(dataDir)).toBe(true);
    expect((await readdir(workDir)).filter((name) => name.includes("quarantined"))).toEqual([]);
  });

  it("does not hand later callers a half-started database", async () => {
    const { getDb } = await import("../src/db");
    await expect(getDb()).rejects.toThrow("_journal.json");
  });
});

describe("PGLite cannot open the data directory", () => {
  // The case the quarantine exists for: a crash mid-write leaves a directory
  // PGLite cannot start from. It is still moved aside — never deleted — and the
  // app boots on a fresh one.
  const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
  let workDir = "";
  let dataDir = "";
  let originalCwd = "";
  let originalUrl: string | undefined;

  beforeAll(async () => {
    originalCwd = process.cwd();
    originalUrl = process.env.PG_DATABASE_URL;
    workDir = await mkdtemp(path.join(os.tmpdir(), "busabase-init-unreadable-"));
    dataDir = path.join(workDir, "data");
    // A cluster that died while being written: PGLite refuses to start from it.
    fs.mkdirSync(dataDir);
    fs.writeFileSync(path.join(dataDir, "PG_VERSION"), "17\n");
    process.chdir(MIGRATIONS_CWD);
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    (globalThis as GlobalWithDbState).__busabaseCoreDbState = undefined;
  });

  afterAll(async () => {
    const state = (globalThis as GlobalWithDbState).__busabaseCoreDbState;
    await state?.client?.close().catch(() => undefined);
    (globalThis as GlobalWithDbState).__busabaseCoreDbState = undefined;
    if (originalUrl !== undefined) process.env.PG_DATABASE_URL = originalUrl;
    if (originalCwd) process.chdir(originalCwd);
    if (workDir) await rm(workDir, { recursive: true, force: true });
  });

  it("moves the unreadable directory aside, keeps it, and boots a fresh database", async () => {
    const { getPgliteClient } = await import("../src/db");
    const client = await getPgliteClient();
    expect((await client.query<{ ok: number }>("select 1 as ok")).rows).toEqual([{ ok: 1 }]);

    const quarantined = (await readdir(workDir)).filter((name) => name.includes("quarantined"));
    expect(quarantined).toHaveLength(1);
    expect(fs.readFileSync(path.join(workDir, quarantined[0] ?? "", "PG_VERSION"), "utf8")).toBe(
      "17\n",
    );
  }, 120_000);
});
