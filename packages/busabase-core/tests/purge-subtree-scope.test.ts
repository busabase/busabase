import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PGlite, QueryOptions } from "@electric-sql/pglite";
import { createRouterClient } from "@orpc/server";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { LocalStorage } from "openlib/storage";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runWithSearchDatabase } from "../src/context";
import { getDb } from "../src/db";
import * as schema from "../src/db/schema";
import { attachments, busabaseAssets, busabaseCommits } from "../src/db/schema";
import { MATCH_IN_DB_TEXT_LIMIT } from "../src/domains/assets/logic/purge-assets-logic";
import { busabaseStorageCleanupJobs } from "../src/domains/assets/schema/storage-cleanup-jobs";
import { busabaseRecords } from "../src/domains/base/schema";
import { docBodyKey } from "../src/domains/doc/handlers";
import { busabaseRouter } from "../src/router";

/**
 * Permanent deletion scoped to what is being deleted.
 *
 * Purging one node used to read and lock the whole space: every Asset id went
 * into one `inArray` (a space with 142,924 Assets failed every purge past
 * Postgres' 65,534 bind-parameter limit), every storage key's fence was taken,
 * and every record head and Doc body was matched against every attachment.
 *
 * Pinned here: purge works past the limit, a purge with no files reads no
 * other Doc, and protection of files still referenced elsewhere is unchanged
 * whether the outside scan is pre-filtered by Postgres or done in full.
 *
 * Also pinned: a Doc that names no file reads none of the space's Assets or
 * attachments (a space can hold 143,000 of each, ~20 MB from a remote
 * database), legacy references by storage key or attachment id are still
 * found whether Postgres or this process matches them, and an outside cell
 * whose explicit Asset id is owned still does not protect the bytes its
 * copied URL names.
 */

/** One statement the purge ran and how many rows came back. */
interface Statement {
  query: string;
  rows: number;
}

/** A statement that reads the space's Asset or attachment rows. */
const readsFiles = (statement: Statement) =>
  /from "(busabase_assets|attachments)"/.test(statement.query);

/**
 * The test database through a client that records every statement and its
 * row count, transactions included. Bound with `runWithSearchDatabase`, the
 * purge runs on it unchanged.
 */
const recordingDb = async (log: Statement[]) => {
  await getDb();
  const holder = globalThis as typeof globalThis & {
    __busabaseCoreDbState?: { client: PGlite | null };
  };
  const pglite = holder.__busabaseCoreDbState?.client;
  if (!pglite) throw new Error("Expected the PGlite test database");
  const record =
    (target: Pick<PGlite, "query">) =>
    async (query: string, params?: unknown[], options?: QueryOptions) => {
      const result = await target.query(query, params, options);
      log.push({ query, rows: result.rows.length });
      return result;
    };
  const client = new Proxy(pglite, {
    get(target, prop) {
      if (prop === "query") return record(target);
      if (prop === "transaction") {
        return (run: (tx: Pick<PGlite, "query">) => Promise<unknown>) =>
          target.transaction((tx) =>
            run(
              new Proxy(tx, {
                get: (inner, key) => (key === "query" ? record(inner) : Reflect.get(inner, key)),
              }),
            ),
          );
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  return drizzle({ client, schema });
};

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("permanent deletion — scoped to the purged subtree", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-purge-scope-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-purge-scope-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  const createDoc = async (slug: string, body: string) => {
    const doc = await client.docs.create({ slug, name: slug, body, autoMerge: true });
    if (!("node" in doc) || !doc.node) throw new Error("Expected a materialized Doc");
    return doc.node.id;
  };

  const archiveNode = (nodeId: string) =>
    client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [{ kind: "delete", nodeId }],
    } as never);

  /** Asset + attachment rows written directly: purge only reads the registry. */
  const seedFiles = async (prefix: string, count: number) => {
    const db = await getDb();
    const files = Array.from({ length: count }, (_, i) => ({
      assetId: `ast_${prefix}_${i}`,
      attachmentId: `att_${prefix}_${i}`,
      storageKey: `files/test/${prefix}/${i}-report.pdf`,
    }));
    await db.insert(attachments).values(
      files.map((file) => ({
        id: file.attachmentId,
        storageKey: file.storageKey,
        fileName: "report.pdf",
        mimeType: "application/pdf",
        sizeBytes: 3,
        userId: "local-producer",
        spaceId: "local",
      })),
    );
    await db.insert(busabaseAssets).values(
      files.map((file) => ({
        id: file.assetId,
        attachmentId: file.attachmentId,
        name: "report.pdf",
      })),
    );
    return files;
  };

  /** A record whose HEAD payload is exactly `payload`, as legacy rows without a where-used index are. */
  const seedRecord = async (baseId: string, id: string, payload: Record<string, unknown>) => {
    const db = await getDb();
    await db.insert(busabaseCommits).values({
      id: `cmt_${id}`,
      baseId,
      payload,
      author: "test",
    });
    await db.insert(busabaseRecords).values({
      id: `rec_${id}`,
      baseId,
      headCommitId: `cmt_${id}`,
      createdBy: "test",
    });
  };

  /** An attachment the space owns with no Asset, as legacy uploads are. */
  const seedLegacyAttachment = async (row: { id: string; storageKey: string }) => {
    const db = await getDb();
    await db.insert(attachments).values({
      id: row.id,
      storageKey: row.storageKey,
      fileName: "legacy.pdf",
      mimeType: "application/pdf",
      sizeBytes: 3,
      userId: "local-producer",
      spaceId: "local",
    });
  };

  const purgeRecorded = async (nodeId: string, log: Statement[]) => {
    const db = await recordingDb(log);
    return runWithSearchDatabase(db, () => client.nodes.purge({ nodeId }));
  };

  const cleanupJobs = async (keys: string[]) => {
    const db = await getDb();
    return db
      .select({
        storageKey: busabaseStorageCleanupJobs.storageKey,
        kind: busabaseStorageCleanupJobs.kind,
        state: busabaseStorageCleanupJobs.state,
      })
      .from(busabaseStorageCleanupJobs)
      .where(inArray(busabaseStorageCleanupJobs.storageKey, keys));
  };

  const fileIdsLeft = async () => {
    const db = await getDb();
    return {
      assets: new Set(
        (await db.select({ id: busabaseAssets.id }).from(busabaseAssets)).map((row) => row.id),
      ),
      attachments: new Set(
        (await db.select({ id: attachments.id }).from(attachments)).map((row) => row.id),
      ),
    };
  };

  const createBase = async (slug: string) => {
    const base = await client.bases.create({
      slug,
      name: slug,
      fields: [{ slug: "title", name: "Title", type: "text" }],
      autoMerge: true,
    });
    if ("status" in base || !base.nodeId) throw new Error("Expected a materialized Base");
    return { id: base.id, nodeId: base.nodeId };
  };

  it("purges a Doc with no files without reading any other Doc", async () => {
    const kept = await Promise.all(
      ["purge-scope-kept-a", "purge-scope-kept-b"].map((slug) => createDoc(slug, "kept body\n")),
    );
    const purgedDoc = await createDoc("purge-scope-empty", "no files here\n");
    await archiveNode(purgedDoc);

    const heads = vi.spyOn(LocalStorage.prototype, "getObjectMetadata");
    try {
      await expect(client.nodes.purge({ nodeId: purgedDoc })).resolves.toEqual({ purged: true });
      const readKeys = heads.mock.calls.map(([key]) => key);
      expect(readKeys).toContain(docBodyKey(purgedDoc));
      for (const nodeId of kept) expect(readKeys).not.toContain(docBodyKey(nodeId));
    } finally {
      heads.mockRestore();
    }
  });

  it.each([
    ["a few files (Postgres pre-filters the outside scan)", 3],
    ["more files than the pre-filter covers (full outside scan)", 250],
  ])(
    "keeps files another Base still references — %s",
    async (_label, count) => {
      const prefix = `scope${count}`;
      const files = await seedFiles(prefix, count);
      const purgedBase = await createBase(`purge-scope-${count}-gone`);
      const keptBase = await createBase(`purge-scope-${count}-kept`);
      for (const [i, file] of files.entries()) {
        await seedRecord(purgedBase.id, `${prefix}_gone_${i}`, {
          title: `row ${i}`,
          files: [{ assetId: file.assetId, name: "report.pdf" }],
        });
      }
      const [first, second] = files;
      if (!first || !second) throw new Error("Expected at least two files");
      // Outside the purged Base: one logical reference (keeps the Asset) and one
      // legacy URL naming the bytes by storage key (keeps only the bytes).
      await seedRecord(keptBase.id, `${prefix}_kept`, {
        title: "still needs two files",
        files: [{ assetId: first.assetId }],
        link: `https://cdn.example.test/${second.storageKey}`,
      });

      await client.bases.lifecycleChangeRequest({
        operation: "archive",
        baseId: purgedBase.id,
        autoMerge: true,
      });
      await expect(client.nodes.purge({ nodeId: purgedBase.nodeId })).resolves.toEqual({
        purged: true,
      });

      const db = await getDb();
      const assetsLeft = new Set(
        (await db.select({ id: busabaseAssets.id }).from(busabaseAssets)).map((row) => row.id),
      );
      const attachmentsLeft = new Set(
        (await db.select({ id: attachments.id }).from(attachments)).map((row) => row.id),
      );
      expect(assetsLeft.has(first.assetId)).toBe(true);
      expect(attachmentsLeft.has(first.attachmentId)).toBe(true);
      expect(assetsLeft.has(second.assetId)).toBe(false);
      expect(attachmentsLeft.has(second.attachmentId)).toBe(true);
      for (const file of files.slice(2)) {
        expect(assetsLeft.has(file.assetId)).toBe(false);
        expect(attachmentsLeft.has(file.attachmentId)).toBe(false);
      }
    },
    120_000,
  );

  it.each([
    ["a short body that names no file", "short", "Agenda: nothing attached yet.\n"],
    ["an empty body", "empty", ""],
  ])(
    "purges a Doc with %s without reading the space's Assets or attachments",
    async (_label, tag, body) => {
      const spaceFiles = 300;
      await seedFiles(`idle_${tag}`, spaceFiles);
      const doc = await createDoc(`purge-scope-idle-${tag}`, body);
      await archiveNode(doc);

      const log: Statement[] = [];
      await expect(purgeRecorded(doc, log)).resolves.toEqual({ purged: true });

      // Nothing about the space's files came back: no statement returned an
      // Asset or attachment row, and none returned anywhere near the space.
      expect(log.filter(readsFiles).map((statement) => statement.rows)).toEqual(
        log.filter(readsFiles).map(() => 0),
      );
      expect(Math.max(...log.map((statement) => statement.rows))).toBeLessThan(spaceFiles);
      // The body is still checked for legacy references, by Postgres.
      expect(
        log.some((statement) => readsFiles(statement) && statement.query.includes("strpos")),
      ).toBe(body !== "");
      expect(await cleanupJobs([docBodyKey(doc)])).toEqual([
        expect.objectContaining({ kind: "doc", state: expect.not.stringMatching(/^retained$/) }),
      ]);
    },
    60_000,
  );

  it.each([
    ["Postgres matches them", "db", 0],
    ["past the text limit, this process matches them", "js", MATCH_IN_DB_TEXT_LIMIT + 1],
  ])(
    "releases legacy files the purged Base names by storage key or attachment id — %s",
    async (_label, tag, padding) => {
      const byKey = {
        id: `att_legacy_key_${tag}`,
        storageKey: `attachments/legacy/${tag}/Q3 "final", {v2}\\NULL.pdf`,
      };
      const byKeyWithNewline = {
        id: `att_legacy_newline_${tag}`,
        storageKey: `attachments/legacy/${tag}/two\nlines.pdf`,
      };
      const byId = {
        id: `att_legacy_id_${tag}`,
        storageKey: `attachments/legacy/${tag}/by-id.pdf`,
      };
      const unrelated = {
        id: `att_legacy_other_${tag}`,
        storageKey: `attachments/legacy/${tag}/other.pdf`,
      };
      for (const row of [byKey, byKeyWithNewline, byId, unrelated]) await seedLegacyAttachment(row);
      const base = await createBase(`purge-legacy-${tag}`);
      await seedRecord(base.id, `legacy_${tag}_url`, {
        title: 'quoted "x", {a,b} NULL \\ ✓',
        link: `https://cdn.example.test/${byKey.storageKey}?v=1`,
        notes: "x".repeat(padding),
      });
      await seedRecord(base.id, `legacy_${tag}_cell`, {
        files: [{ id: byId.id, fileName: "by-id.pdf" }],
      });
      await seedRecord(base.id, `legacy_${tag}_newline`, {
        notes: `see ${byKeyWithNewline.storageKey} here`,
      });
      await client.bases.lifecycleChangeRequest({
        operation: "archive",
        baseId: base.id,
        autoMerge: true,
      });

      const log: Statement[] = [];
      await expect(purgeRecorded(base.nodeId, log)).resolves.toEqual({ purged: true });

      const left = await fileIdsLeft();
      for (const row of [byKey, byKeyWithNewline, byId]) {
        expect(left.attachments.has(row.id)).toBe(false);
      }
      expect(left.attachments.has(unrelated.id)).toBe(true);
      const jobs = await cleanupJobs([byKey, byKeyWithNewline, byId].map((row) => row.storageKey));
      expect(jobs.map((job) => job.kind)).toEqual(["attachment", "attachment", "attachment"]);
      // Which side matched: only past the limit are the space's attachments loaded.
      const loadedAll = log.some(
        (statement) =>
          readsFiles(statement) && !statement.query.includes("strpos") && statement.rows >= 4,
      );
      expect(loadedAll).toBe(padding > 0);
    },
    60_000,
  );

  it.each([
    ["an Asset of this space owns the cell, so its copied URL keeps nothing", "owned", true],
    ["an id that is no Asset here leaves the URL a legacy reference", "foreign", false],
  ])(
    "outside cell with an explicit id and a candidate's URL — %s",
    async (_label, tag, owned) => {
      const [file, other] = await seedFiles(`alias_${tag}`, 2);
      if (!file || !other) throw new Error("Expected two files");
      const purgedBase = await createBase(`purge-alias-${tag}-gone`);
      const keptBase = await createBase(`purge-alias-${tag}-kept`);
      await seedRecord(purgedBase.id, `alias_${tag}_gone`, {
        files: [{ assetId: file.assetId, name: "report.pdf" }],
      });
      await seedRecord(keptBase.id, `alias_${tag}_kept`, {
        files: [
          {
            assetId: owned ? other.assetId : `ast_not_in_space_${tag}`,
            url: `https://cdn.example.test/${file.storageKey}`,
          },
        ],
      });
      await client.bases.lifecycleChangeRequest({
        operation: "archive",
        baseId: purgedBase.id,
        autoMerge: true,
      });
      await expect(client.nodes.purge({ nodeId: purgedBase.nodeId })).resolves.toEqual({
        purged: true,
      });

      const left = await fileIdsLeft();
      expect(left.assets.has(file.assetId)).toBe(false);
      expect(left.attachments.has(file.attachmentId)).toBe(!owned);
      expect(left.assets.has(other.assetId)).toBe(true);
      expect(left.attachments.has(other.attachmentId)).toBe(true);
    },
    60_000,
  );

  it("purges in a space holding more Assets than one statement can bind", async () => {
    const db = await getDb();
    for (let start = 0; start < 66_000; start += 2_000) {
      await db.insert(busabaseAssets).values(
        Array.from({ length: 2_000 }, (_, i) => ({
          id: `ast_flood_${start + i}`,
          attachmentId: `att_flood_${start + i}`,
          name: `flood-${start + i}.pdf`,
        })),
      );
    }
    const doc = await createDoc("purge-scope-flood", "no files here\n");
    await archiveNode(doc);
    await expect(client.nodes.purge({ nodeId: doc })).resolves.toEqual({ purged: true });
    const [row] = await db
      .select({ id: busabaseAssets.id })
      .from(busabaseAssets)
      .where(eq(busabaseAssets.id, "ast_flood_0"));
    expect(row).toBeDefined();
  }, 120_000);
});
