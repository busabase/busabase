import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { LocalStorage } from "openlib/storage";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "../src/db";
import { attachments, busabaseAssets, busabaseCommits } from "../src/db/schema";
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
 */

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
