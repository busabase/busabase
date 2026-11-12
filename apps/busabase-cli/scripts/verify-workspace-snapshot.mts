#!/usr/bin/env node
/** Read-only local acceptance: source fingerprints survive deletion of the source copy. */
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { DumpTableSchema } from "busabase-contract/domains/dump/types";

export const TABLES = DumpTableSchema.options;
const ROOT_HOST_COLUMNS = ["createdAt", "updatedAt", "createdBy"] as const;
const DB_NAME = "fingerprints.sqlite";

type Row = Record<string, unknown>;
type Options = {
  baseUrl: string;
  spaceId: string;
  storageDir: string;
  snapshotDir: string;
  pageLimit?: number;
};
type TableSummary = { rows: number; sha256: string };
type ObjectSummary = { files: number; bytes: number; sha256: string };
type Metadata = {
  format: "busabase-workspace-fingerprints@1";
  method: string;
  createdAt: string;
  source: { baseUrl: string; spaceId: string; storageDir: string };
  normalizations: { table: "nodes"; id: "nod_root"; columns: readonly string[] };
  tables: Record<string, TableSummary>;
  objects: ObjectSummary;
  databaseSha256: string;
  complete: true;
};

/** JSON value checks deliberately reject unsupported values instead of dropping keys. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Non-finite source number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++)
      if (!(i in value)) throw new Error("Sparse source array");
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype)
    throw new Error(`Unsupported source JSON value: ${typeof value}`);
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Row)[key])}`)
    .join(",")}}`;
}

export function rowFingerprint(table: string, row: unknown): { id: string; sha256: string } {
  if (
    !row ||
    typeof row !== "object" ||
    Array.isArray(row) ||
    Object.getPrototypeOf(row) !== Object.prototype
  )
    throw new Error(`${table}: non-object source row`);
  const source = row as Row;
  const id = table === "spaceInstructions" || table === "spaceWelcome" ? source.spaceId : source.id;
  if (typeof id !== "string" || id.length === 0)
    throw new Error(`${table}: source row has no valid id`);
  let normalized = source;
  if (table === "nodes" && source.id === "nod_root") {
    normalized = { ...source };
    for (const key of ROOT_HOST_COLUMNS) {
      if (!Object.hasOwn(source, key)) throw new Error(`nodes/nod_root: missing ${key}`);
      if (key === "createdBy") {
        if (source[key] !== null && typeof source[key] !== "string")
          throw new Error(`nodes/nod_root: invalid ${key}`);
      } else if (typeof source[key] !== "string" || !Number.isFinite(Date.parse(source[key])))
        throw new Error(`nodes/nod_root: invalid ${key}`);
      delete normalized[key];
    }
  }
  return {
    id,
    sha256: createHash("sha256").update(canonicalJson(normalized)).digest("hex"),
  };
}

async function hashFile(path: string) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  return { bytes, sha256: hash.digest("hex") };
}

function validateOptions(input: Options): Options {
  const url = new URL(input.baseUrl);
  if (
    !new Set(["127.0.0.1", "localhost", "[::1]"]).has(url.hostname) ||
    url.protocol !== "http:" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  )
    throw new Error("Verifier accepts only explicit anonymous loopback HTTP origins");
  if (!input.spaceId)
    throw new Error("--space-id is required; no configured credential or default space is read");
  const pageLimit = input.pageLimit ?? 2000;
  if (!Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > 2000)
    throw new Error("page limit must be 1..2000");
  const storageDir = resolve(input.storageDir),
    snapshotDir = resolve(input.snapshotDir);
  if (snapshotDir === storageDir || !relative(storageDir, snapshotDir).startsWith(".."))
    throw new Error("Snapshot output must be outside the workspace storage directory");
  return { ...input, baseUrl: url.origin, storageDir, snapshotDir, pageLimit };
}

function configure(db: DatabaseSync) {
  db.exec(
    "PRAGMA journal_mode=DELETE; PRAGMA synchronous=NORMAL; PRAGMA temp_store=FILE; PRAGMA cache_size=-16384;",
  );
}
function rowDigest(db: DatabaseSync, table: string, relation = "rows") {
  const hash = createHash("sha256");
  let count = 0;
  for (const item of db
    .prepare(`SELECT id, sha256 FROM ${relation} WHERE table_name=? ORDER BY id COLLATE BINARY`)
    .iterate(table)) {
    hash.update(`${JSON.stringify([item.id, item.sha256])}\n`);
    count++;
  }
  return { rows: count, sha256: hash.digest("hex") };
}
function objectDigest(db: DatabaseSync): ObjectSummary {
  const hash = createHash("sha256");
  let files = 0,
    bytes = 0;
  for (const item of db
    .prepare("SELECT key,bytes,sha256 FROM objects ORDER BY key COLLATE BINARY")
    .iterate()) {
    hash.update(`${JSON.stringify([item.key, item.bytes, item.sha256])}\n`);
    files++;
    bytes += Number(item.bytes);
  }
  return { files, bytes, sha256: hash.digest("hex") };
}
/** Transient loopback dump failures after multi-million-row scans (keep-alive drop, brief stall). */
export const DUMP_PAGE_ATTEMPTS = 8;
export const DUMP_PAGE_TIMEOUT_MS = 180_000;

export function isRetryableDumpFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const name = error.name;
  if (name === "TimeoutError" || name === "AbortError") return true;
  const message = error.message.toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("econnreset") ||
    message.includes("econnrefused") ||
    message.includes("socket") ||
    message.includes("other side closed") ||
    message.includes("und_err")
  );
}

export async function fetchDumpPage(
  options: Options,
  table: string,
  cursor: string | undefined,
): Promise<{ rows: unknown[]; nextCursor: string | null }> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= DUMP_PAGE_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(`${options.baseUrl}/api/v1/dump/export/tables`, {
        method: "POST",
        redirect: "error",
        headers: { "content-type": "application/json", "x-busabase-space": options.spaceId },
        body: JSON.stringify({ table, limit: options.pageLimit, ...(cursor ? { cursor } : {}) }),
        signal: AbortSignal.timeout(DUMP_PAGE_TIMEOUT_MS),
      });
      if (!response.ok)
        throw new Error(`${table}: local dump endpoint returned HTTP ${response.status}`);
      const page: unknown = await response.json();
      if (
        !page ||
        typeof page !== "object" ||
        !Object.hasOwn(page, "rows") ||
        !Object.hasOwn(page, "nextCursor")
      )
        throw new Error(`${table}: malformed dump page`);
      const { rows, nextCursor } = page as { rows: unknown; nextCursor: unknown };
      if (!Array.isArray(rows) || !(nextCursor === null || typeof nextCursor === "string"))
        throw new Error(`${table}: malformed rows or cursor`);
      if (nextCursor !== null && (!nextCursor || nextCursor === cursor || rows.length === 0))
        throw new Error(`${table}: non-advancing pagination`);
      return { rows, nextCursor };
    } catch (error) {
      lastError = error;
      if (!isRetryableDumpFetchError(error) || attempt === DUMP_PAGE_ATTEMPTS) throw error;
      const delayMs = Math.min(30_000, 500 * 2 ** (attempt - 1));
      console.error(
        `${table}: dump page fetch retry ${attempt}/${DUMP_PAGE_ATTEMPTS} after ${
          error instanceof Error ? error.message : String(error)
        } (wait ${delayMs}ms)`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function scanTable(options: Options, table: string, consume: (rows: unknown[]) => void) {
  let cursor: string | undefined;
  let count = 0,
    lastLog = Date.now();
  do {
    const { rows, nextCursor } = await fetchDumpPage(options, table, cursor);
    consume(rows);
    count += rows.length;
    cursor = nextCursor ?? undefined;
    if (Date.now() - lastLog > 5000) {
      console.error(`${table}: ${count} rows fingerprinted`);
      lastLog = Date.now();
    }
  } while (cursor);
  console.error(`${table}: ${count} rows complete`);
  return count;
}

async function* objects(
  storageDir: string,
): AsyncGenerator<{ key: string; bytes: number; sha256: string }> {
  const root = await lstat(storageDir);
  if (!root.isDirectory() || root.isSymbolicLink())
    throw new Error("Storage root must be a real directory");
  async function* visit(
    directory: string,
  ): AsyncGenerator<{ key: string; bytes: number; sha256: string }> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name),
        key = relative(storageDir, path).split("\\").join("/");
      if (entry.isSymbolicLink()) throw new Error(`Unexpected storage symlink: ${key}`);
      if (entry.isDirectory()) yield* visit(path);
      else if (entry.isFile()) {
        if (
          /(^|\/)(?:\.tmp|\.staging|\.restore-staging|\.multipart)(?:\/|$)|^busabase\/dump-staging-v1\//.test(
            key,
          )
        )
          throw new Error(`Unexpected staged storage object: ${key}`);
        const before = await lstat(path),
          digest = await hashFile(path),
          after = await lstat(path);
        if (
          before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs ||
          digest.bytes !== after.size
        )
          throw new Error(`Storage changed while reading: ${key}`);
        yield { key, ...digest };
      } else throw new Error(`Unexpected non-file storage entry: ${key}`);
    }
  }
  yield* visit(storageDir);
}

export async function snapshotWorkspace(input: Options) {
  const options = validateOptions(input);
  await mkdir(options.snapshotDir, { recursive: true, mode: 0o700 });
  const databasePath = join(options.snapshotDir, DB_NAME);
  const db = new DatabaseSync(databasePath);
  configure(db);
  try {
    // A failed/old snapshot is never silently reused or appended to.
    if (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().length > 0)
      throw new Error("Snapshot database already exists; select a fresh snapshot directory");
    db.exec(
      "CREATE TABLE rows(table_name TEXT NOT NULL,id TEXT NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(table_name,id)) WITHOUT ROWID; CREATE TABLE objects(key TEXT PRIMARY KEY,bytes INTEGER NOT NULL,sha256 TEXT NOT NULL) WITHOUT ROWID;CREATE TABLE node_kinds(id TEXT PRIMARY KEY,type TEXT NOT NULL) WITHOUT ROWID;",
    );
    const insert = db.prepare("INSERT INTO rows(table_name,id,sha256) VALUES(?,?,?)");
    const insertNode = db.prepare("INSERT INTO node_kinds(id,type) VALUES(?,?)");
    const tables: Record<string, TableSummary> = {};
    for (const table of TABLES) {
      const count = await scanTable(options, table, (page) => {
        db.exec("BEGIN");
        try {
          for (const row of page) {
            const value = rowFingerprint(table, row);
            insert.run(table, value.id, value.sha256);
            if (table === "nodes") {
              if (typeof (row as Row).type !== "string" || !(row as Row).type)
                throw new Error(`nodes/${value.id}: missing or invalid node type`);
              insertNode.run(value.id, (row as Row).type as string);
            }
          }
          db.exec("COMMIT");
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      });
      tables[table] = rowDigest(db, table);
      if (tables[table].rows !== count)
        throw new Error(`${table}: duplicate or dropped source rows`);
    }
    const saveObject = db.prepare("INSERT INTO objects(key,bytes,sha256) VALUES(?,?,?)");
    let seen = 0;
    db.exec("BEGIN");
    for await (const object of objects(options.storageDir)) {
      saveObject.run(object.key, object.bytes, object.sha256);
      if (++seen % 1000 === 0) {
        db.exec("COMMIT; BEGIN");
        console.error(`storage: ${seen} files fingerprinted`);
      }
    }
    db.exec("COMMIT");
    const objectSummary = objectDigest(db);
    db.close();
    const metadata: Metadata = {
      format: "busabase-workspace-fingerprints@1",
      method: `Read all ${TABLES.length} local dump tables pagewise; canonical SHA-256 for every row id, object key and physical file bytes; SQLite retains fingerprints, not full rows. Source must remain stable during the scan.`,
      createdAt: new Date().toISOString(),
      source: {
        baseUrl: options.baseUrl,
        spaceId: options.spaceId,
        storageDir: options.storageDir,
      },
      normalizations: { table: "nodes", id: "nod_root", columns: ROOT_HOST_COLUMNS },
      tables,
      objects: objectSummary,
      databaseSha256: (await hashFile(databasePath)).sha256,
      complete: true,
    };
    await writeFile(
      join(options.snapshotDir, "snapshot.json"),
      `${JSON.stringify(metadata, null, 2)}\n`,
      { mode: 0o600 },
    );
    const result = {
      mode: "snapshot",
      complete: true,
      tables: TABLES.length,
      rows: Object.values(tables).reduce((n, t) => n + t.rows, 0),
      objects: objectSummary,
      snapshotDir: options.snapshotDir,
    };
    await writeFile(
      join(options.snapshotDir, "snapshot-result.json"),
      `${JSON.stringify(result, null, 2)}\n`,
    );
    return result;
  } catch (error) {
    try {
      db.close();
    } catch {
      /* already closed */
    }
    throw error;
  }
}

export async function compareWorkspace(input: Options) {
  const options = validateOptions(input);
  const metadata = JSON.parse(
    await readFile(join(options.snapshotDir, "snapshot.json"), "utf8"),
  ) as Metadata;
  if (
    metadata.format !== "busabase-workspace-fingerprints@1" ||
    metadata.complete !== true ||
    metadata.source.spaceId !== options.spaceId ||
    canonicalJson(metadata.normalizations) !==
      canonicalJson({ table: "nodes", id: "nod_root", columns: ROOT_HOST_COLUMNS })
  )
    throw new Error("Invalid, incomplete, differently scoped or incompatible source snapshot");
  const databasePath = join(options.snapshotDir, DB_NAME);
  if ((await hashFile(databasePath)).sha256 !== metadata.databaseSha256)
    throw new Error("Source fingerprint database checksum mismatch");
  const source = new DatabaseSync(databasePath, { readOnly: true });
  source.exec("PRAGMA cache_size=-16384");
  const scratch = join(options.snapshotDir, `.compare-${randomUUID()}.sqlite`),
    target = new DatabaseSync(scratch);
  configure(target);
  target.exec(
    "CREATE TABLE rows(table_name TEXT NOT NULL,id TEXT NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(table_name,id)) WITHOUT ROWID;CREATE TABLE objects(key TEXT PRIMARY KEY,bytes INTEGER NOT NULL,sha256 TEXT NOT NULL) WITHOUT ROWID;",
  );
  const tables: Record<
    string,
    {
      expected: number;
      actual: number;
      identical: number;
      missing: number;
      extra: number;
      mismatched: number;
      expectedSha256: string;
      actualSha256: string;
    }
  > = {};
  const samples: Row[] = [];
  const expectedRow = source.prepare("SELECT sha256 FROM rows WHERE table_name=? AND id=?"),
    seenRow = target.prepare("INSERT INTO rows(table_name,id,sha256) VALUES(?,?,?)");
  const sample = (value: Row) => {
    if (samples.length < 20) samples.push(value);
  };
  try {
    for (const table of TABLES) {
      if (!metadata.tables[table]) throw new Error(`Source snapshot is missing table ${table}`);
      let present = 0,
        extra = 0,
        mismatched = 0;
      const actual = await scanTable(options, table, (page) => {
        target.exec("BEGIN");
        try {
          for (const row of page) {
            const value = rowFingerprint(table, row);
            seenRow.run(table, value.id, value.sha256);
            const old = expectedRow.get(table, value.id);
            if (!old) {
              extra++;
              sample({ table, id: value.id, difference: "extra" });
            } else {
              present++;
              if (old.sha256 !== value.sha256) {
                mismatched++;
                sample({
                  table,
                  id: value.id,
                  difference: "columns",
                  sourceSha256: old.sha256,
                  targetSha256: value.sha256,
                });
              }
            }
          }
          target.exec("COMMIT");
        } catch (error) {
          target.exec("ROLLBACK");
          throw error;
        }
      });
      const aggregate = rowDigest(target, table);
      const expected = metadata.tables[table];
      const missing = expected.rows - present;
      tables[table] = {
        expected: expected.rows,
        actual,
        identical: present - mismatched,
        missing,
        extra,
        mismatched,
        expectedSha256: expected.sha256,
        actualSha256: aggregate.sha256,
      };
      if (missing > 0 && samples.length < 20)
        for (const item of source
          .prepare("SELECT id FROM rows WHERE table_name=? ORDER BY id")
          .iterate(table)) {
          if (
            !target.prepare("SELECT id FROM rows WHERE table_name=? AND id=?").get(table, item.id)
          )
            sample({ table, id: item.id, difference: "missing" });
          if (samples.length >= 20) break;
        }
    }
    let actualFiles = 0,
      actualBytes = 0,
      presentFiles = 0,
      extraFiles = 0,
      mismatchedFiles = 0;
    const expectedObject = source.prepare("SELECT bytes,sha256 FROM objects WHERE key=?"),
      seenObject = target.prepare("INSERT INTO objects(key,bytes,sha256) VALUES(?,?,?)");
    target.exec("BEGIN");
    for await (const object of objects(options.storageDir)) {
      actualFiles++;
      actualBytes += object.bytes;
      seenObject.run(object.key, object.bytes, object.sha256);
      const old = expectedObject.get(object.key);
      if (!old) {
        extraFiles++;
        sample({ storageKey: object.key, difference: "extra object" });
      } else {
        presentFiles++;
        if (old.bytes !== object.bytes || old.sha256 !== object.sha256) {
          mismatchedFiles++;
          sample({
            storageKey: object.key,
            difference: "object bytes",
            sourceBytes: old.bytes,
            targetBytes: object.bytes,
            sourceSha256: old.sha256,
            targetSha256: object.sha256,
          });
        }
      }
      if (actualFiles % 1000 === 0) {
        target.exec("COMMIT; BEGIN");
        console.error(`storage: ${actualFiles} files compared`);
      }
    }
    target.exec("COMMIT");
    const objectSummary = objectDigest(target);
    const missingFiles = metadata.objects.files - presentFiles;
    if (missingFiles > 0 && samples.length < 20)
      for (const object of source.prepare("SELECT key FROM objects ORDER BY key").iterate()) {
        if (!target.prepare("SELECT key FROM objects WHERE key=?").get(object.key))
          sample({ storageKey: object.key, difference: "missing object" });
        if (samples.length >= 20) break;
      }
    const passed =
      Object.values(tables).every(
        (t) =>
          t.missing === 0 &&
          t.extra === 0 &&
          t.mismatched === 0 &&
          t.expectedSha256 === t.actualSha256,
      ) &&
      missingFiles === 0 &&
      extraFiles === 0 &&
      mismatchedFiles === 0 &&
      objectSummary.sha256 === metadata.objects.sha256;
    const result = {
      mode: "compare",
      passed,
      method: metadata.method,
      sourceCreatedAt: metadata.createdAt,
      tables,
      rows: Object.values(tables).reduce((n, t) => n + t.actual, 0),
      objects: {
        expected: metadata.objects.files,
        actual: actualFiles,
        expectedBytes: metadata.objects.bytes,
        actualBytes,
        identical: presentFiles - mismatchedFiles,
        missing: missingFiles,
        extra: extraFiles,
        mismatched: mismatchedFiles,
        expectedSha256: metadata.objects.sha256,
        actualSha256: objectSummary.sha256,
      },
      normalizations: metadata.normalizations,
      samples,
    };
    await writeFile(
      join(options.snapshotDir, "comparison.json"),
      `${JSON.stringify(result, null, 2)}\n`,
      { mode: 0o600 },
    );
    return result;
  } finally {
    source.close();
    target.close();
    await rm(scratch, { force: true });
    await rm(`${scratch}-journal`, { force: true });
  }
}

/** Independently compare a modern archive against the saved HTTP/filesystem fingerprints. */
export async function compareArchive(snapshotDirectory: string, archivePath: string) {
  const snapshotDir = resolve(snapshotDirectory);
  const metadata = JSON.parse(
    await readFile(join(snapshotDir, "snapshot.json"), "utf8"),
  ) as Metadata;
  if (metadata.format !== "busabase-workspace-fingerprints@1" || metadata.complete !== true)
    throw new Error("Source snapshot is incomplete or unsupported");
  const databasePath = join(snapshotDir, DB_NAME);
  if ((await hashFile(databasePath)).sha256 !== metadata.databaseSha256)
    throw new Error("Source fingerprint database checksum mismatch");
  // This optional mode uses source TS archive helpers: invoke with node --import tsx.
  const { openVerifiedArchive, drainEntry } = await import(
    new URL("../src/backup/format/archive-reader.ts", import.meta.url).href
  );
  const archive = await openVerifiedArchive(resolve(archivePath));
  const source = new DatabaseSync(databasePath, { readOnly: true });
  source.exec("PRAGMA cache_size=-16384");
  const scratch = join(snapshotDir, `.archive-${randomUUID()}.sqlite`),
    target = new DatabaseSync(scratch);
  configure(target);
  target.exec(
    "CREATE TABLE rows(table_name TEXT NOT NULL,id TEXT NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(table_name,id)) WITHOUT ROWID;CREATE TABLE objects(key TEXT PRIMARY KEY,bytes INTEGER NOT NULL,sha256 TEXT NOT NULL) WITHOUT ROWID;",
  );
  const oldRow = source.prepare("SELECT sha256 FROM rows WHERE table_name=? AND id=?"),
    addRow = target.prepare("INSERT INTO rows(table_name,id,sha256) VALUES(?,?,?)");
  const oldObject = source.prepare("SELECT bytes,sha256 FROM objects WHERE key=?"),
    addObject = target.prepare("INSERT INTO objects(key,bytes,sha256) VALUES(?,?,?)");
  const tables: Record<
    string,
    {
      expected: number;
      actual: number;
      identical: number;
      missing: number;
      extra: number;
      mismatched: number;
      expectedSha256: string;
      actualSha256: string;
    }
  > = {};
  const samples: Row[] = [];
  const sample = (value: Row) => {
    if (samples.length < 20) samples.push(value);
  };
  const tableSet = new Set<string>(TABLES),
    seenTables = new Set<string>();
  let actualFiles = 0,
    actualBytes = 0,
    presentFiles = 0,
    extraFiles = 0,
    mismatchedFiles = 0;
  let pending: { binaryPath: string; key: string; bytes: number; sha256: string } | undefined;
  async function objectFingerprint(key: string, bytes: number, sha256: string) {
    addObject.run(key, bytes, sha256);
    actualFiles++;
    actualBytes += bytes;
    const expected = oldObject.get(key);
    if (!expected) {
      extraFiles++;
      sample({ storageKey: key, difference: "extra archive object" });
    } else {
      presentFiles++;
      if (expected.bytes !== bytes || expected.sha256 !== sha256) {
        mismatchedFiles++;
        sample({
          storageKey: key,
          difference: "archive object bytes",
          sourceBytes: expected.bytes,
          archiveBytes: bytes,
          sourceSha256: expected.sha256,
          archiveSha256: sha256,
        });
      }
    }
    if (actualFiles % 1000 === 0) console.error(`archive storage: ${actualFiles} objects compared`);
  }
  async function* lines(body: AsyncIterable<Buffer | string>) {
    let segments: string[] = [];
    const { StringDecoder } = await import("node:string_decoder");
    const decoder = new StringDecoder("utf8");
    for await (const chunk of body) {
      const text = typeof chunk === "string" ? chunk : decoder.write(chunk);
      let start = 0,
        newline: number;
      // biome-ignore lint/suspicious/noAssignInExpressions: incremental archive NDJSON parser
      while ((newline = text.indexOf("\n", start)) !== -1) {
        segments.push(text.slice(start, newline));
        const line = segments.join("");
        segments = [];
        if (line) yield line;
        start = newline + 1;
      }
      if (start < text.length) segments.push(text.slice(start));
    }
    const last = decoder.end();
    if (last) segments.push(last);
    if (segments.length) yield segments.join("");
  }
  try {
    if (
      archive.manifest.formatVersion !== 2 ||
      archive.manifest.fidelity !== "full" ||
      archive.manifest.spaceId !== metadata.source.spaceId
    )
      throw new Error(
        "Archive comparison requires a full raw-blob v2 archive from the snapshot's space",
      );
    await archive.streamEntries(
      async (entry: { path: string; body: AsyncIterable<Buffer | string> }) => {
        if (pending && entry.path !== pending.binaryPath)
          throw new Error(`Missing immediate raw body ${pending.binaryPath}`);
        const raw = /^blobs\/(attachments|asset-texts)\/([a-f0-9]{64})\.(json|bin)$/.exec(
          entry.path,
        );
        if (raw && raw[3] === "json") {
          const chunks: Buffer[] = [];
          let bytes = 0;
          for await (const chunk of entry.body) {
            const data = Buffer.from(chunk);
            bytes += data.length;
            if (bytes > 16 * 1024) throw new Error("Oversized raw-object metadata");
            chunks.push(data);
          }
          const value = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Row;
          const key = raw[1] === "attachments" ? value.storageKey : value.textStorageKey;
          if (
            typeof key !== "string" ||
            !Number.isSafeInteger(value.bytes) ||
            (value.bytes as number) < 0 ||
            typeof value.sha256 !== "string" ||
            !/^[a-f0-9]{64}$/.test(value.sha256) ||
            createHash("sha256").update(key).digest("hex") !== raw[2]
          )
            throw new Error(`Invalid archive object metadata ${entry.path}`);
          pending = {
            binaryPath: `${entry.path.slice(0, -5)}.bin`,
            key,
            bytes: value.bytes as number,
            sha256: value.sha256,
          };
          return;
        }
        if (raw && raw[3] === "bin") {
          if (!pending) throw new Error(`Raw body has no metadata: ${entry.path}`);
          const hash = createHash("sha256");
          let bytes = 0;
          for await (const chunk of entry.body) {
            hash.update(chunk);
            bytes += Buffer.byteLength(chunk);
          }
          const sha256 = hash.digest("hex");
          if (bytes !== pending.bytes || sha256 !== pending.sha256)
            throw new Error(`Raw metadata/body mismatch: ${entry.path}`);
          await objectFingerprint(pending.key, bytes, sha256);
          pending = undefined;
          return;
        }
        const sql = /^tree\/([^/]+)\.ndjson$/.exec(entry.path);
        if (sql) {
          const table = sql[1];
          if (!tableSet.has(table) || seenTables.has(table))
            throw new Error(`Unknown or repeated SQL entry: ${entry.path}`);
          seenTables.add(table);
          let actual = 0,
            present = 0,
            extra = 0,
            mismatched = 0;
          target.exec("BEGIN");
          try {
            for await (const line of lines(entry.body)) {
              const row = rowFingerprint(table, JSON.parse(line));
              addRow.run(table, row.id, row.sha256);
              actual++;
              const expected = oldRow.get(table, row.id);
              if (!expected) {
                extra++;
                sample({ table, id: row.id, difference: "extra archive row" });
              } else {
                present++;
                if (expected.sha256 !== row.sha256) {
                  mismatched++;
                  sample({
                    table,
                    id: row.id,
                    difference: "archive columns",
                    sourceSha256: expected.sha256,
                    archiveSha256: row.sha256,
                  });
                }
              }
              if (actual % 50000 === 0) console.error(`archive ${table}: ${actual} rows compared`);
            }
            target.exec("COMMIT");
          } catch (error) {
            target.exec("ROLLBACK");
            throw error;
          }
          const expected = metadata.tables[table];
          if (!expected) throw new Error(`Snapshot lacks ${table}`);
          const digest = rowDigest(target, table);
          tables[table] = {
            expected: expected.rows,
            actual,
            identical: present - mismatched,
            missing: expected.rows - present,
            extra,
            mismatched,
            expectedSha256: expected.sha256,
            actualSha256: digest.sha256,
          };
          if (archive.manifest.tables[table] !== actual)
            throw new Error(`Manifest count mismatch for ${table}`);
          console.error(`archive ${table}: ${actual} rows complete`);
          return;
        }
        const document = /^(docs|rich)\/([^/]+)\.(md|html|workflow\.json|whiteboard\.json)$/.exec(
          entry.path,
        );
        if (document) {
          const node = source.prepare("SELECT type FROM node_kinds WHERE id=?").get(document[2]);
          if (!node) throw new Error(`Archive document has no source node: ${entry.path}`);
          let key: string;
          if (document[1] === "docs" && node.type === "doc" && document[3] === "md")
            key = `busabase/nodes/${document[2]}/doc/doc.md`;
          else if (
            document[1] === "docs" &&
            node.type === "folder" &&
            ["md", "html"].includes(document[3])
          )
            key = `busabase/nodes/${document[2]}/folder/readme.${document[3]}`;
          else if (document[1] === "rich" && node.type === "html" && document[3] === "html")
            key = `busabase/nodes/${document[2]}/html/index.html`;
          else if (
            document[1] === "rich" &&
            node.type === "workflow" &&
            document[3] === "workflow.json"
          )
            key = `busabase/nodes/${document[2]}/workflow/graph.json`;
          else if (
            document[1] === "rich" &&
            node.type === "whiteboard" &&
            document[3] === "whiteboard.json"
          )
            key = `busabase/nodes/${document[2]}/whiteboard/scene.json`;
          else throw new Error(`Archive document kind mismatch: ${entry.path}`);
          const hash = createHash("sha256");
          let bytes = 0;
          for await (const chunk of entry.body) {
            hash.update(chunk);
            bytes += Buffer.byteLength(chunk);
          }
          await objectFingerprint(key, bytes, hash.digest("hex"));
          return;
        }
        if (entry.path === "manifest.json") {
          await drainEntry(entry.body);
          return;
        }
        throw new Error(`Unverified archive entry: ${entry.path}`);
      },
    );
    if (pending) throw new Error(`Missing raw body ${pending.binaryPath}`);
    for (const table of TABLES)
      if (!seenTables.has(table)) throw new Error(`Archive lacks table ${table}`);
    const objects = objectDigest(target);
    const missingFiles = metadata.objects.files - presentFiles;
    const passed =
      Object.values(tables).every(
        (table) =>
          table.missing === 0 &&
          table.extra === 0 &&
          table.mismatched === 0 &&
          table.expectedSha256 === table.actualSha256,
      ) &&
      missingFiles === 0 &&
      extraFiles === 0 &&
      mismatchedFiles === 0 &&
      objects.sha256 === metadata.objects.sha256;
    const result = {
      mode: "archive-check",
      passed,
      method:
        "Verify the full archive checksum, then independently fingerprint every SQL id/column and streamed raw/document object against the saved source HTTP/filesystem fingerprints. Replay uses the same verified private tar.",
      archivePath: resolve(archivePath),
      checksumVerified: true,
      tables,
      rows: Object.values(tables).reduce((n, table) => n + table.actual, 0),
      objects: {
        expected: metadata.objects.files,
        actual: actualFiles,
        expectedBytes: metadata.objects.bytes,
        actualBytes,
        identical: presentFiles - mismatchedFiles,
        missing: missingFiles,
        extra: extraFiles,
        mismatched: mismatchedFiles,
        expectedSha256: metadata.objects.sha256,
        actualSha256: objects.sha256,
      },
      samples,
    };
    await writeFile(
      join(snapshotDir, "archive-comparison.json"),
      `${JSON.stringify(result, null, 2)}\n`,
      { mode: 0o600 },
    );
    return result;
  } finally {
    source.close();
    target.close();
    await rm(scratch, { force: true });
    await rm(`${scratch}-journal`, { force: true });
    await archive.cleanup();
  }
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      mode: { type: "string" },
      "archive-check": { type: "string" },
      "base-url": { type: "string" },
      "space-id": { type: "string", default: "local" },
      "storage-dir": { type: "string" },
      "snapshot-dir": { type: "string" },
      "page-limit": { type: "string" },
    },
  });
  if (values.help) {
    console.log(
      "Snapshot: node verify-workspace-snapshot.mts snapshot --base-url http://127.0.0.1:15450 --space-id local --storage-dir /source/storage --snapshot-dir /fingerprints\nCompare: node verify-workspace-snapshot.mts compare --base-url http://127.0.0.1:15451 --space-id local --storage-dir /target/storage --snapshot-dir /fingerprints\nArchive: node --import tsx verify-workspace-snapshot.mts --archive-check /backup.bbdump --snapshot-dir /fingerprints\nNo credentials/config are read. Source must remain stable; only nod_root createdAt/updatedAt/createdBy normalize. Unknown/missing data and staged storage files fail the check.",
    );
    return;
  }
  if (positionals.length > 1 || (values.mode && positionals.length > 0))
    throw new Error("Choose one mode: snapshot or compare");
  const mode = values.mode ?? positionals[0];
  if (values["archive-check"]) {
    if (!values["snapshot-dir"]) throw new Error("--archive-check requires --snapshot-dir");
    const result = await compareArchive(values["snapshot-dir"], values["archive-check"]);
    console.log(JSON.stringify(result));
    if (!result.passed) process.exitCode = 1;
    return;
  }
  if (
    !new Set(["snapshot", "compare"]).has(mode ?? "") ||
    !values["base-url"] ||
    !values["storage-dir"] ||
    !values["snapshot-dir"]
  )
    throw new Error(
      "Usage: node verify-workspace-snapshot.mts snapshot|compare --base-url http://127.0.0.1:15450 --space-id local --storage-dir /absolute/storage --snapshot-dir /absolute/fingerprints",
    );
  const options: Options = {
    baseUrl: values["base-url"],
    spaceId: values["space-id"],
    storageDir: values["storage-dir"],
    snapshotDir: values["snapshot-dir"],
    pageLimit: values["page-limit"] ? Number(values["page-limit"]) : undefined,
  };
  const result =
    mode === "snapshot" ? await snapshotWorkspace(options) : await compareWorkspace(options);
  console.log(JSON.stringify(result));
  if ("passed" in result && !result.passed) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
