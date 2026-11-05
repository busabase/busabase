/**
 * A workspace with unindexed nodes must still be searchable.
 *
 * Production, Vika Team: `sources: ["nodes"]` answered 408 for EVERY query, even
 * one matching nothing, because the lazy backfill ran on the request's budget
 * before the search had started. Storage latency is injected rather than slept
 * through in production shape: real router, real PGLite, real local storage.
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { inArray } from "drizzle-orm";
import { LocalStorage, storage } from "openlib/storage";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "../src/db";
import { busabaseNodeContentSearch } from "../src/db/schema";
import { docBodyKey } from "../src/domains/doc/handlers";
import { waitForNodeSelfHeal } from "../src/logic/search-self-heal";
import { busabaseRouter } from "../src/router";

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("search stays answerable while nodes are unindexed", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;
  let counter = 0;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-heal-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-heal-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
  }, 300_000);

  afterEach(async () => {
    vi.restoreAllMocks();
    await waitForNodeSelfHeal();
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  /** Docs whose projection is gone: indistinguishable from pre-feature nodes. */
  const seedUnindexedDocs = async (count: number, body: string) => {
    const ids: string[] = [];
    for (let index = 0; index < count; index++) {
      counter += 1;
      const doc = await client.docs.create({
        autoMerge: true,
        slug: `heal-${counter}`,
        name: `Heal ${counter}`,
        body,
      });
      if (!("node" in doc)) throw new Error("expected a materialized DocVO");
      ids.push(doc.node.id);
    }
    const db = await getDb();
    await db
      .delete(busabaseNodeContentSearch)
      .where(inArray(busabaseNodeContentSearch.nodeId, ids));
    return ids;
  };

  const slowStorage = (delayMs: number) => {
    const original = LocalStorage.prototype.objectExists;
    return vi.spyOn(LocalStorage.prototype, "objectExists").mockImplementation(async function (
      this: LocalStorage,
      key: string,
    ) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return original.call(this, key);
    });
  };

  const projected = async (ids: string[]) => {
    const db = await getDb();
    const rows = await db
      .select({ nodeId: busabaseNodeContentSearch.nodeId })
      .from(busabaseNodeContentSearch)
      .where(inArray(busabaseNodeContentSearch.nodeId, ids));
    return rows.length;
  };

  it("answers a quick search inside its budget and says the answer may be partial", async () => {
    const indexed = await client.docs.create({
      autoMerge: true,
      slug: "already-indexed",
      name: "Indexed",
      body: "ALREADYINDEXEDNEEDLE 助理手册\n",
    });
    if (!("node" in indexed)) throw new Error("expected a materialized DocVO");
    await seedUnindexedDocs(12, "SLOWHEALNEEDLE\n");
    slowStorage(400); // 12 × 400 ms is far past the 2 s quick budget.

    const startedAt = Date.now();
    const result = await client.search({
      query: "助理手册",
      limit: 8,
      offset: 0,
      mode: "quick",
      sources: ["nodes"],
    });

    expect(Date.now() - startedAt).toBeLessThan(2_000);
    expect(result.results.map((row) => row.id)).toContain(indexed.node.id);
    expect(result.contentTruncated).toBe(true);
  }, 60_000);

  it("finishes the backfill on its own, past one batch, without further searches", async () => {
    const ids = await seedUnindexedDocs(30, "CONVERGENEEDLE\n");
    await client.search({ query: "x", limit: 8, offset: 0, mode: "quick", sources: ["nodes"] });
    await waitForNodeSelfHeal();
    expect(await projected(ids)).toBe(ids.length);

    const after = await client.search({
      query: "CONVERGENEEDLE",
      limit: 40,
      offset: 0,
      mode: "quick",
      sources: ["nodes"],
    });
    expect(after.results.length).toBe(ids.length);
    expect(after.contentTruncated).toBe(false);
  }, 120_000);

  it("does not let nodes with a missing object starve the ones behind them", async () => {
    const broken = await seedUnindexedDocs(26, "BROKENNEEDLE\n");
    const healthy = await seedUnindexedDocs(3, "HEALTHYNEEDLE\n");
    for (const id of broken) await storage.deleteObject(docBodyKey(id));

    await client.search({ query: "x", limit: 8, offset: 0, mode: "quick", sources: ["nodes"] });
    await waitForNodeSelfHeal();
    expect(await projected(healthy)).toBe(healthy.length);
    expect(await projected(broken)).toBe(0);

    // The failures are remembered: searching again must not re-read them, and
    // must not keep calling the answer partial because of them.
    const objectExists = vi.spyOn(LocalStorage.prototype, "objectExists");
    objectExists.mockImplementation(async function (this: LocalStorage, k: string) {
      console.log("DBGSTACK", k, new Error().stack?.split("\n").slice(2, 9).join(" | "));
      return true;
    });
    const again = await client.search({
      query: "HEALTHYNEEDLE",
      limit: 8,
      offset: 0,
      mode: "quick",
      sources: ["nodes"],
    });
    await waitForNodeSelfHeal();
    expect(objectExists).not.toHaveBeenCalled();
    expect(again.results.length).toBe(healthy.length);
  }, 120_000);

  it("indexes a Doc and a folder when they are created, with no search involved", async () => {
    const doc = await client.docs.create({
      autoMerge: true,
      slug: "indexed-on-create",
      name: "Indexed on create",
      body: "CREATEDNEEDLE\n",
    });
    if (!("node" in doc)) throw new Error("expected a materialized DocVO");
    const rootId = (await client.nodes.list({}))[0]?.id ?? "";
    const flatten = (e: Awaited<ReturnType<typeof client.nodes.list>>): typeof e =>
      e.flatMap((x) => [x, ...flatten(x.children)]);
    await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [
        { kind: "create", parentNodeId: rootId, nodeType: "folder", slug: "new-folder", name: "F" },
      ],
    });
    const folderId = flatten(await client.nodes.list({})).find((n) => n.slug === "new-folder")?.id;
    expect(folderId).toBeTruthy();
    expect(await projected([doc.node.id, folderId as string])).toBe(2);
  }, 60_000);

  it("indexes created nodes from the text in hand, without reading storage back", async () => {
    const rootId = (await client.nodes.list({}))[0]?.id ?? "";
    const doc = await client.docs.create({
      autoMerge: true,
      slug: "in-hand-doc",
      name: "In hand",
      body: "INHANDNEEDLE\n",
    });
    if (!("node" in doc)) throw new Error("expected a materialized DocVO");

    // A change request merging creates touches storage only to write: indexing
    // must not add reads inside its transaction.
    const objectExists = vi.spyOn(LocalStorage.prototype, "objectExists");
    const getObject = vi.spyOn(LocalStorage.prototype, "getObject");
    await client.nodes.createChangeRequest({
      autoMerge: true,
      operations: [
        { kind: "create", parentNodeId: rootId, nodeType: "doc", slug: "in-hand-cr", name: "C" },
        { kind: "create", parentNodeId: rootId, nodeType: "html", slug: "in-hand-html", name: "H" },
        {
          kind: "create",
          parentNodeId: rootId,
          nodeType: "folder",
          slug: "in-hand-dir",
          name: "D",
        },
      ],
    });
    expect(objectExists).not.toHaveBeenCalled();
    expect(getObject).not.toHaveBeenCalled();
    vi.restoreAllMocks();

    const found = await client.search({
      query: "INHANDNEEDLE",
      limit: 8,
      offset: 0,
      mode: "quick",
      sources: ["nodes"],
    });
    expect(found.results.map((row) => row.id)).toContain(doc.node.id);
    const flatten = (e: Awaited<ReturnType<typeof client.nodes.list>>): typeof e =>
      e.flatMap((x) => [x, ...flatten(x.children)]);
    const created = flatten(await client.nodes.list({}))
      .filter((node) => ["in-hand-cr", "in-hand-html", "in-hand-dir"].includes(node.slug))
      .map((node) => node.id);
    expect(created).toHaveLength(3);
    expect(await projected(created)).toBe(3);
  }, 60_000);

  it("a failing backfill never fails the search", async () => {
    await seedUnindexedDocs(2, "FAILNEEDLE\n");
    vi.spyOn(LocalStorage.prototype, "objectExists").mockRejectedValue(new Error("storage down"));
    await expect(
      client.search({ query: "x", limit: 8, offset: 0, mode: "quick", sources: ["nodes"] }),
    ).resolves.toBeDefined();
  }, 60_000);
});
