import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { getDb, getPgliteClient } from "../src/db";
import { busabaseNodes } from "../src/db/schema";
import { rootNodeIdForSpace } from "../src/logic/kernel";
import { ensureReady } from "../src/logic/seed";

const state = globalThis as typeof globalThis & {
  __busabaseReadyBySpace?: Map<string, Promise<void>>;
  __busabaseCoreDbState?: unknown;
};

describe("workspace root initialization against PostgreSQL via PGlite", () => {
  let db: Awaited<ReturnType<typeof getDb>>;
  let connection: Awaited<ReturnType<typeof getPgliteClient>>;
  let dataDir: string;
  let originalCwd: string;
  let originalUrl: string | undefined;
  let originalStorageUrl: string | undefined;

  const initialize = (spaceId: string) => runWithBusabaseContext({ db, spaceId }, ensureReady);
  const roots = (spaceId: string) =>
    db.select().from(busabaseNodes).where(eq(busabaseNodes.spaceId, spaceId));
  const insertRoot = (spaceId: string, values: Partial<typeof busabaseNodes.$inferInsert> = {}) =>
    db.insert(busabaseNodes).values({
      id: rootNodeIdForSpace(spaceId),
      spaceId,
      type: "folder",
      slug: "root",
      name: "My root",
      ...values,
    });

  beforeAll(async () => {
    originalCwd = process.cwd();
    originalUrl = process.env.PG_DATABASE_URL;
    originalStorageUrl = process.env.STORAGE_URL;
    process.chdir(path.resolve(__dirname, "../../../apps/busabase"));
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-readiness-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    state.__busabaseCoreDbState = undefined;
    db = await getDb();
    connection = await getPgliteClient();
  });

  beforeEach(() => {
    state.__busabaseReadyBySpace = new Map();
  });

  afterAll(async () => {
    await connection?.close();
    state.__busabaseCoreDbState = undefined;
    state.__busabaseReadyBySpace = undefined;
    if (originalUrl === undefined) delete process.env.PG_DATABASE_URL;
    else process.env.PG_DATABASE_URL = originalUrl;
    if (originalStorageUrl === undefined) delete process.env.STORAGE_URL;
    else process.env.STORAGE_URL = originalStorageUrl;
    process.chdir(originalCwd);
    await rm(dataDir, { recursive: true, force: true });
  });

  it("shares initialization within a process and isolates concurrent spaces", async () => {
    const queries = vi.spyOn(connection, "query");
    await Promise.all(Array.from({ length: 20 }, () => initialize("same-process")));
    expect(
      queries.mock.calls.filter(([query]) =>
        String(query).startsWith('insert into "busabase_nodes"'),
      ),
    ).toHaveLength(1);
    queries.mockRestore();
    expect(await roots("same-process")).toHaveLength(1);
    await Promise.all([initialize("space-a"), initialize("space-b"), initialize(LOCAL_SPACE_ID)]);
    for (const space of ["space-a", "space-b", LOCAL_SPACE_ID]) {
      expect(await roots(space)).toMatchObject([{ id: rootNodeIdForSpace(space), parentId: null }]);
    }
  });

  it("tolerates independent caches racing to insert the same root without overwriting it", async () => {
    // Each request gets an independent readiness cache, as on separate servers;
    // all inserts still hit the same real database and its uniqueness constraint.
    const attempts = Array.from({ length: 12 }, () => {
      state.__busabaseReadyBySpace = new Map();
      return initialize("independent-caches");
    });
    await Promise.all(attempts);
    const [root] = await roots("independent-caches");
    await db
      .update(busabaseNodes)
      .set({ name: "User workspace", description: "Keep this" })
      .where(eq(busabaseNodes.id, root.id));
    state.__busabaseReadyBySpace = new Map();
    await initialize("independent-caches");
    expect(await roots("independent-caches")).toMatchObject([
      { name: "User workspace", description: "Keep this", createdAt: root.createdAt },
    ]);
  });

  it("evicts a failed attempt so a later request recovers without restarting", async () => {
    await db.execute(
      sql`ALTER TABLE busabase_nodes ADD CONSTRAINT readiness_failure CHECK (space_id <> 'retry-space')`,
    );
    await expect(initialize("retry-space")).rejects.toThrow();
    expect(state.__busabaseReadyBySpace?.has("retry-space")).toBe(false);
    await db.execute(sql`ALTER TABLE busabase_nodes DROP CONSTRAINT readiness_failure`);
    await initialize("retry-space");
    expect(await roots("retry-space")).toHaveLength(1);
  });

  it("preserves a newer cache entry when an older in-flight attempt fails", async () => {
    await db.execute(
      sql`ALTER TABLE busabase_nodes ADD CONSTRAINT readiness_newer_failure CHECK (space_id <> 'newer-cache')`,
    );
    const attempt = initialize("newer-cache");
    const replacement = Promise.resolve();
    state.__busabaseReadyBySpace?.set("newer-cache", replacement);
    await expect(attempt).rejects.toThrow();
    expect(state.__busabaseReadyBySpace?.get("newer-cache")).toBe(replacement);
    await db.execute(sql`ALTER TABLE busabase_nodes DROP CONSTRAINT readiness_newer_failure`);
  });

  it.each([
    ["wrong-type", { type: "doc" as const }],
    ["wrong-slug", { slug: "something-else" }],
    ["wrong-space", { spaceId: "another-space" }],
  ])("rejects a canonical id occupied by %s without changing it", async (spaceId, values) => {
    await insertRoot(spaceId, values);
    await expect(initialize(spaceId)).rejects.toThrow("Invalid workspace root");
    const [stored] = await db
      .select()
      .from(busabaseNodes)
      .where(eq(busabaseNodes.id, rootNodeIdForSpace(spaceId)));
    expect(stored).toMatchObject(values);
  });

  it("rejects a canonical root nested under another folder", async () => {
    await insertRoot("parent-root");
    await insertRoot("nested-root", { parentId: rootNodeIdForSpace("parent-root") });
    await expect(initialize("nested-root")).rejects.toThrow("Invalid workspace root");
  });

  it("propagates an unrelated unique-slug conflict rather than treating it as readiness", async () => {
    await insertRoot("slug-conflict", { id: "some-other-root-id" });
    await expect(initialize("slug-conflict")).rejects.toThrow();
    expect(state.__busabaseReadyBySpace?.has("slug-conflict")).toBe(false);
    expect(await roots("slug-conflict")).toMatchObject([{ id: "some-other-root-id" }]);
  });
});
