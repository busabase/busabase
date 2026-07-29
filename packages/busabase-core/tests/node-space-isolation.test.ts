import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithBusabaseContext } from "../src/context";
import { busabaseRouter } from "../src/router";

/**
 * Node listings (now one `nodes.list({ types })` surface) must be scoped
 * to the active space — they used to filter only by node type + archivedAt, which
 * in the multi-tenant cloud would return one space's docs/folders/files under
 * another. This pins that a node created in space A is never visible from space B.
 * (`listFileTreeNodes` — skills/drives — got the identical spaceId fix.)
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("Node listings are space-scoped — oRPC integration", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  const inSpace = <T>(spaceId: string, fn: () => Promise<T>): Promise<T> =>
    runWithBusabaseContext({ spaceId }, fn);

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-nodeiso-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-nodeiso-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    // A parentless doc also creates that space's root folder, so this seeds both
    // a doc and a folder into each of two distinct spaces.
    await inSpace("space_a", () =>
      client.docs.create({ autoMerge: true, slug: "doc-a", name: "Doc A", body: "a\n" }),
    );
    await inSpace("space_b", () =>
      client.docs.create({ autoMerge: true, slug: "doc-b", name: "Doc B", body: "b\n" }),
    );

    // Drives are file-tree nodes listed via `listFileTreeNodes` — the third P0 fix.
    await inSpace("space_a", () =>
      client.fileTrees.create({ type: "drive", autoMerge: true, slug: "drive-a", name: "Drive A" }),
    );
    await inSpace("space_b", () =>
      client.fileTrees.create({ type: "drive", autoMerge: true, slug: "drive-b", name: "Drive B" }),
    );
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it('nodes.list({ types: ["doc"] }) returns only the active space\'s docs', async () => {
    const a = await inSpace("space_a", () => client.nodes.list({ types: ["doc"] }));
    const b = await inSpace("space_b", () => client.nodes.list({ types: ["doc"] }));
    expect(a.map((d) => d.slug)).toEqual(["doc-a"]);
    expect(b.map((d) => d.slug)).toEqual(["doc-b"]);
  });

  it('nodes.list({ types: ["folder"] }) returns only the active space\'s folders (disjoint across spaces)', async () => {
    const a = await inSpace("space_a", () => client.nodes.list({ types: ["folder"] }));
    const b = await inSpace("space_b", () => client.nodes.list({ types: ["folder"] }));
    expect(a.length).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    const aIds = new Set(a.map((f) => f.id));
    const bIds = new Set(b.map((f) => f.id));
    // No folder id leaks across spaces.
    expect(a.some((f) => bIds.has(f.id))).toBe(false);
    expect(b.some((f) => aIds.has(f.id))).toBe(false);
  });

  it('nodes.list({ types: ["drive"] }) returns only the active space\'s drives', async () => {
    const a = await inSpace("space_a", () => client.nodes.list({ types: ["drive"] }));
    const b = await inSpace("space_b", () => client.nodes.list({ types: ["drive"] }));
    const aSlugs = a.map((d) => d.slug);
    const bSlugs = b.map((d) => d.slug);
    expect(aSlugs).toContain("drive-a");
    expect(aSlugs).not.toContain("drive-b");
    expect(bSlugs).toContain("drive-b");
    expect(bSlugs).not.toContain("drive-a");
  });
});
