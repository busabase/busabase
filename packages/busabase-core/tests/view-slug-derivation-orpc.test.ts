import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const SLUG_PATTERN = /^[a-z0-9-]+$/;

/**
 * A view created without `slug` gets one derived from its name. A name with no
 * ASCII letters ("看板 · 按状态") used to derive `""`, which was stored as the
 * view's slug — and then the next such view on the Base failed with
 * `409 View slug already exists: ` (an empty slug in the message).
 */
describe("view slug derivation - oRPC integration (PGLite)", () => {
  let client: Client;
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let baseId = "";

  const createView = async (input: { name: string; slug?: string }) => {
    const result = await client.views.changeRequest({
      operation: "create",
      baseId,
      ...input,
      autoMerge: true,
    });
    if (!result.materialized) throw new Error("expected the view to merge immediately");
    return result;
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-view-slug-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-view-slug-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    const base = await client.bases.create({
      slug: "todos",
      name: "待办",
      fields: [
        { slug: "title", name: "标题", type: "text", required: true, options: {} },
        { slug: "status", name: "状态", type: "text", required: false, options: {} },
      ],
      autoMerge: true,
    });
    baseId = base.id;
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("gives a CJK-named view a real slug, and a second CJK-named view does not conflict", async () => {
    const board = await createView({ name: "看板 · 按状态" });
    expect(board.slug).toMatch(SLUG_PATTERN);
    expect(board.slug.startsWith("view-")).toBe(true);

    const calendar = await createView({ name: "日历 · 会议" });
    expect(calendar.slug).toMatch(SLUG_PATTERN);
    expect(calendar.slug).not.toBe(board.slug);

    const slugs = (await client.bases.listViews({ baseId })).map((view) => view.slug);
    expect(slugs).not.toContain("");
  });

  it("a derived slug that is already taken moves to the next free suffix instead of failing", async () => {
    const first = await createView({ name: "全部待办" });
    const again = await createView({ name: "全部待办" });
    expect(again.slug).toBe(`${first.slug}-2`);

    const ascii = await createView({ name: "Open tasks" });
    expect(ascii.slug).toBe("open-tasks");
    expect((await createView({ name: "Open tasks!" })).slug).toBe("open-tasks-2");
  });

  it("an explicit slug that is taken is still a conflict, and the message names it", async () => {
    await createView({ name: "看板", slug: "board" });
    await expect(
      client.views.changeRequest({ operation: "create", baseId, name: "看板 2", slug: "board" }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: expect.stringContaining('"board"'),
    });
  });
});
