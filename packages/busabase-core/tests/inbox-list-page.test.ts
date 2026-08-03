import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * Numbered change request paging (`changeRequests.listPage`), which backs the
 * inbox paginator.
 *
 * The cursor listing (`changeRequests.list`) stays — this is the second access
 * pattern, not a replacement. The risk with adding a second listing is that the
 * two quietly disagree, so the load-bearing assertion here walks a tab BOTH ways
 * and demands the same change requests in the same order.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const PENDING = 47;

describe("changeRequests.listPage", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-listpage-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-listpage-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "listpage",
      name: "List Page",
      fields: [{ slug: "name", name: "Name", type: "text", required: true, options: {} }],
      autoMerge: true,
    });
    for (let i = 0; i < PENDING; i++) {
      await client.bases.createChangeRequest({
        baseId: base.id,
        fields: { name: `Pending ${i}` },
        submittedBy: "local-producer",
        autoMerge: false,
      });
    }
  }, 300_000);

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports the total across the whole tab, not just the page", async () => {
    const page = await client.changeRequests.listPage({
      status: ["in_review"],
      page: 1,
      pageSize: 10,
    } as never);
    expect(page.total).toBe(PENDING);
    expect(page.totalPages).toBe(Math.ceil(PENDING / 10));
    expect(page.changeRequests).toHaveLength(10);
  });

  it("pages through every change request exactly once", async () => {
    const seen = new Set<string>();
    const totalPages = Math.ceil(PENDING / 10);
    for (let n = 1; n <= totalPages; n++) {
      const page = await client.changeRequests.listPage({
        status: ["in_review"],
        page: n,
        pageSize: 10,
      } as never);
      expect(page.page).toBe(n);
      for (const cr of page.changeRequests) {
        expect(seen.has(cr.id)).toBe(false);
        seen.add(cr.id);
      }
    }
    expect(seen.size).toBe(PENDING);
  });

  it("clamps a page number past the end instead of returning nothing useful", async () => {
    const page = await client.changeRequests.listPage({
      status: ["in_review"],
      page: 999,
      pageSize: 10,
    } as never);
    expect(page.page).toBe(Math.ceil(PENDING / 10));
    expect(page.changeRequests.length).toBeGreaterThan(0);
  });

  // The load-bearing one: two listings over the same tab must agree.
  it("returns the same change requests, in the same order, as the cursor listing", async () => {
    const viaCursor: string[] = [];
    let cursor: string | undefined;
    for (let guard = 0; guard < 20; guard++) {
      const page = await client.changeRequests.list({
        status: ["in_review"],
        limit: 10,
        cursor,
      } as never);
      viaCursor.push(...page.changeRequests.map((cr) => cr.id));
      if (!page.nextCursor) break;
      cursor = page.nextCursor;
    }

    const viaPage: string[] = [];
    const totalPages = Math.ceil(PENDING / 10);
    for (let n = 1; n <= totalPages; n++) {
      const page = await client.changeRequests.listPage({
        status: ["in_review"],
        page: n,
        pageSize: 10,
      } as never);
      viaPage.push(...page.changeRequests.map((cr) => cr.id));
    }

    expect(viaPage).toEqual(viaCursor);
  });

  it("scopes the 'created' tab to the acting user", async () => {
    const mine = await client.changeRequests.listPage({ mine: true, pageSize: 100 } as never);
    // Everything above was submitted by local-producer, so the acting user's own
    // tab must not sweep them in — only the Base-creation change request.
    for (const cr of mine.changeRequests) {
      expect(cr.submittedBy).not.toBe("local-producer");
    }
    expect(mine.total).toBeLessThan(PENDING);
  });
});
