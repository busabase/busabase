import "server-only";

import { existsSync, renameSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { getContextDb } from "../context";
import * as schema from "./schema";

type PgDb = ReturnType<typeof drizzlePg<typeof schema>>;
type PgliteDb = ReturnType<typeof drizzlePglite<typeof schema>>;
export type DbInstance = PgDb | PgliteDb;

type DbState = {
  db: DbInstance | null;
  client: postgres.Sql | import("@electric-sql/pglite").PGlite | null;
  initPromise: Promise<DbInstance> | null;
};

type GlobalWithDbState = typeof globalThis & {
  __busabaseCoreDbState?: DbState;
};

const PGLITE_PROTOCOL = "pglite://";

function isPgliteUrl(url: string): boolean {
  return url.startsWith(PGLITE_PROTOCOL);
}

function parsePgliteDataDir(url: string): string {
  return url.slice(PGLITE_PROTOCOL.length);
}

function getDatabaseUrl(): string {
  return process.env.PG_DATABASE_URL ?? "pglite://.data/busabase";
}

function getDbState(): DbState {
  const g = globalThis as GlobalWithDbState;
  if (!g.__busabaseCoreDbState) {
    g.__busabaseCoreDbState = { db: null, client: null, initPromise: null };
  }
  return g.__busabaseCoreDbState;
}

async function ensureLocalDir(dataDir: string) {
  if (dataDir && !dataDir.startsWith("memory://")) {
    await mkdir(dataDir, { recursive: true });
  }
}

function initSync(): DbInstance {
  const state = getDbState();
  if (state.db) return state.db;

  const url = getDatabaseUrl();
  if (isPgliteUrl(url)) {
    throw new Error("PGLite requires async init — use initAsync()");
  }

  const client = postgres(url, { prepare: false });
  state.client = client;
  state.db = drizzlePg({ client, schema });
  return state.db;
}

type PgliteClient = import("@electric-sql/pglite").PGlite;

/**
 * Open the PGLite data dir and wait until PGLite has finished opening it.
 *
 * `PGlite.create`, not `new PGlite`: the constructor returns before PGLite has
 * touched the directory and keeps initializing in the background. An instance
 * abandoned in that state goes on running PGLite's own `existsSync(dir) ||
 * mkdirSync(dir)` later — against a directory that may have been moved and
 * re-created meanwhile — and its failure surfaces as an unhandled `EEXIST`.
 */
async function openPglite(dataDir: string): Promise<PgliteClient> {
  await ensureLocalDir(dataDir);
  const { PGlite } = await import("@electric-sql/pglite");
  // pg_trgm backs the trigram indexes in domains/base/schema.ts (busabase_field_values
  // text/slug) — without registering it here, `CREATE EXTENSION pg_trgm` in the
  // enable_pg_trgm migration has nothing to load and fails on PGLite.
  const { pg_trgm } = await import("@electric-sql/pglite/contrib/pg_trgm");
  return PGlite.create(dataDir, { extensions: { pg_trgm } });
}

/**
 * Migrate an opened PGLite database and make it the shared client.
 *
 * Published only once migrations succeed: a database whose migrations failed is
 * closed, not handed to later callers as if it were ready.
 */
async function migratePglite(client: PgliteClient, dataDir: string): Promise<DbInstance> {
  const db = drizzlePglite({ client, schema });
  try {
    await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "src/db/migrations") });
  } catch (error) {
    await client.close().catch(() => undefined);
    // drizzle's message is the failed SQL; Postgres's reason is in `cause`.
    const reason = [error, (error as { cause?: unknown }).cause]
      .filter((part): part is Error => part instanceof Error)
      .map((part) => part.message.trim())
      .join(" — ");
    console.error(
      `[Busabase DB] Migrations failed, so the database did not start: ${reason}. ` +
        `The data dir ${dataDir} was left exactly as it was — fix the migration and restart.`,
    );
    throw error;
  }

  await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "src/db/migrations") });

  // Publish only after migrate() commits: drizzle runs the whole migration set in one
  // transaction, so a request that grabs state.db earlier queries tables that do not
  // exist yet (e.g. busabase_vault_items, read on every /api/v1 request).
  const state = getDbState();
  state.client = client;
  state.db = db;

  console.log(`[Busabase DB] PGLite mode (dataDir: ${dataDir || "in-memory"})`);
  return db;
}

async function initAsync(): Promise<DbInstance> {
  const state = getDbState();
  if (state.db) return state.db;

  const url = getDatabaseUrl();
  if (isPgliteUrl(url)) {
    const dataDir = parsePgliteDataDir(url);
    let client: PgliteClient;
    try {
      client = await openPglite(dataDir);
    } catch (error) {
      const isFileBased = dataDir && !dataDir.startsWith("memory://");
      if (!isFileBased || !existsSync(dataDir)) throw error;
      // Never destroy an unreadable data dir outright — a crash mid-write (OOM,
      // kill -9, container restart) can leave PGLite unable to start, and this
      // is the only local copy of a "review-first, local-first" database. Move
      // it aside (recoverable) instead of rmSync (irrecoverable) so the app can
      // still boot with a fresh dir, and the old one is there to inspect/restore.
      //
      // Only when PGLite itself cannot open the directory. A migration failure
      // (a missing migrations folder, a migration that rejects existing rows)
      // says nothing about the data; moving it aside there would boot the user
      // into an empty database over a bug in the code.
      const quarantineDir = `${dataDir}.quarantined-${Date.now()}`;
      console.error(
        `[Busabase DB] PGLite failed to start (${(error as Error).message}). ` +
          `Moving the unreadable data dir to ${quarantineDir} and starting a fresh one — ` +
          `your previous local data was NOT deleted; recover it by inspecting/restoring that folder.`,
      );
      renameSync(dataDir, quarantineDir);
      client = await openPglite(dataDir);
    }
    return migratePglite(client, dataDir);
  }

  return initSync();
}

export function isPgliteMode(): boolean {
  return isPgliteUrl(getDatabaseUrl());
}

function createLazyChain(pending: Promise<DbInstance>, ops: ChainOp[]): unknown {
  const resolve = () =>
    pending.then((instance) => {
      let current: unknown = instance;
      let parent: unknown;
      for (const op of ops) {
        if (op.type === "get") {
          parent = current;
          current = (current as Record<string | symbol, unknown>)[op.prop];
        } else if (typeof current === "function") {
          current = (current as (...args: unknown[]) => unknown).apply(parent, op.args);
          parent = undefined;
        }
      }
      return current;
    });

  return new Proxy((() => {}) as unknown as Record<string | symbol, unknown>, {
    get(_target, prop) {
      if (prop === "then" || prop === "catch" || prop === "finally") {
        const promise = resolve() as Promise<unknown> & Record<string | symbol, unknown>;
        const method = promise[prop];
        return typeof method === "function" ? method.bind(promise) : method;
      }
      return createLazyChain(pending, [...ops, { type: "get", prop }]);
    },
    apply(_target, _thisArg, args) {
      return createLazyChain(pending, [...ops, { type: "apply", args }]);
    },
  });
}

type ChainOp = { type: "get"; prop: string | symbol } | { type: "apply"; args: unknown[] };

export const db = new Proxy({} as PgDb, {
  get(_target, prop) {
    // Host-injected db (busabase-cloud) takes precedence over the local singleton.
    const ctxDb = getContextDb();
    if (ctxDb) {
      return (ctxDb as unknown as Record<string | symbol, unknown>)[prop];
    }

    const state = getDbState();
    if (state.db) {
      return (state.db as unknown as Record<string | symbol, unknown>)[prop];
    }

    if (!isPgliteMode()) {
      const instance = initSync();
      return (instance as unknown as Record<string | symbol, unknown>)[prop];
    }

    state.initPromise ??= initAsync();
    return createLazyChain(state.initPromise, [{ type: "get", prop }]);
  },
});

export async function getDb(): Promise<DbInstance> {
  // Host-injected db (busabase-cloud) takes precedence over the local singleton.
  const ctxDb = getContextDb();
  if (ctxDb) {
    return ctxDb as unknown as DbInstance;
  }

  const state = getDbState();
  if (state.db) {
    return state.db;
  }
  state.initPromise ??= initAsync();
  return state.initPromise;
}

export async function getPgliteClient() {
  const url = getDatabaseUrl();
  if (!isPgliteUrl(url)) {
    throw new Error("PGLite client is only available in pglite mode");
  }

  await getDb();
  const state = getDbState();
  const client = state.client;
  if (!client || !("exec" in client)) {
    throw new Error("Busabase PGlite client failed to initialize");
  }
  return client;
}

export type Database = typeof db;
