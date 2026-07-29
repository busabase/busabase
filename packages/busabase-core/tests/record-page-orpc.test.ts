import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("records.listPage - oRPC integration", () => {
  let client: Client;
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let baseId = "";
  let filteredViewId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-record-page-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-record-page-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "paged-items",
      name: "Paged items",
      fields: [
        { slug: "name", name: "Name", type: "text", required: true, options: {} },
        {
          slug: "status",
          name: "Status",
          type: "select",
          required: false,
          options: {
            choices: [
              { id: "needs-review", name: "Needs review" },
              { id: "done", name: "Done" },
            ],
          },
        },
      ],
      autoMerge: true,
    });
    baseId = base.id;

    const records = Array.from({ length: 12 }, (_, index) => {
      const number = index + 1;
      return {
        name: `Item ${number}`,
        status: number % 2 === 0 ? "needs-review" : "done",
      };
    });
    const bulk = await client.bases.createBulkChangeRequest({
      baseId,
      records,
      message: "Seed numbered pagination",
    });
    await client.changeRequests.review({ changeRequestIds: [bulk.id], verdict: "approved" });
    await client.changeRequests.merge({ changeRequestIds: [bulk.id] });

    const viewCr = await client.views.changeRequest({
      operation: "create",
      baseId,
      slug: "review-items",
      name: "Review items",
      config: {
        filters: [{ fieldSlug: "status", operator: "equals", value: "needs-review" }],
        sorts: [{ fieldSlug: "name", direction: "desc" }],
      },
    });
    await client.changeRequests.review({ changeRequestIds: [viewCr.id], verdict: "approved" });
    const merged = await client.changeRequests.merge({ changeRequestIds: [viewCr.id] });
    const mergeResult = merged.results[0];
    if (!mergeResult?.ok) throw new Error(mergeResult?.error ?? "Merge returned no result");
    filteredViewId = mergeResult.view?.id ?? "";
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("jumps directly to the last page and returns page metadata", async () => {
    const result = await client.records.listPage({ baseId, page: 3, pageSize: 5 });

    expect(result.records).toHaveLength(2);
    expect(result.total).toBe(12);
    expect(result.totalPages).toBe(3);
    expect(result.page).toBe(3);
    expect(result.pageSize).toBe(5);
  });

  it("filters and sorts the whole saved view before slicing", async () => {
    const result = await client.records.listPage({
      baseId,
      viewId: filteredViewId,
      page: 2,
      pageSize: 2,
    });

    expect(result.total).toBe(6);
    expect(result.totalPages).toBe(3);
    expect(result.records.map((item) => item.headCommit.fields.name)).toEqual(["Item 8", "Item 6"]);
    expect(result.records.every((item) => item.headCommit.fields.status === "needs-review")).toBe(
      true,
    );
  });

  it("clamps an out-of-range page to the current last page", async () => {
    const result = await client.records.listPage({ baseId, page: 99, pageSize: 5 });
    expect(result.page).toBe(3);
    expect(result.records).toHaveLength(2);
  });

  it("rejects a view that does not belong to the resolved base", async () => {
    const otherBase = await client.bases.create({
      slug: "other-page-base",
      name: "Other",
      fields: [{ slug: "name", name: "Name", type: "text", required: true, options: {} }],
      autoMerge: true,
    });

    await expect(
      client.records.listPage({
        baseId: otherBase.id,
        viewId: filteredViewId,
        page: 1,
        pageSize: 5,
      }),
    ).rejects.toThrow(/view not found/i);
  });

  it("rejects page sizes above the contract maximum", async () => {
    await expect(client.records.listPage({ baseId, page: 1, pageSize: 101 })).rejects.toThrow();
  });
});
