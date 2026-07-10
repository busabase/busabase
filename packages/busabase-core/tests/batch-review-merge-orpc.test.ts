import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * Batch review + merge: an agent told "just approve/merge all of these" hits one
 * endpoint instead of looping. Failures are isolated — a bad id records an error and
 * the rest still process — so the caller gets a full per-item report.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

describe("Batch review & merge — oRPC integration", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-batch-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-batch-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    const base = await client.bases.create({
      slug: "posts",
      name: "Posts",
      fields: [{ slug: "title", name: "Title", type: "text", required: true, options: {} }],
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

  const proposeRecord = async (title: string): Promise<string> => {
    const cr = await client.bases.createChangeRequest({ baseId, fields: { title } });
    return cr.id;
  };

  it("approves many change requests in one call", async () => {
    const ids = await Promise.all([proposeRecord("A"), proposeRecord("B"), proposeRecord("C")]);
    const { results } = await client.changeRequests.reviewMany({
      changeRequestIds: ids,
      verdict: "approved",
    });
    expect(results.map((r) => r.ok)).toEqual([true, true, true]);
    expect(results.every((r) => r.status === "approved")).toBe(true);
  });

  it("merges many change requests in one call, then all records exist", async () => {
    const ids = await Promise.all([proposeRecord("D"), proposeRecord("E")]);
    await client.changeRequests.reviewMany({ changeRequestIds: ids, verdict: "approved" });

    const { results } = await client.changeRequests.mergeMany({ changeRequestIds: ids });
    expect(results.map((r) => r.ok)).toEqual([true, true]);

    const records = await client.records.list({ baseId, limit: 100 });
    const titles = records.map((r) => r.headCommit.fields.title);
    expect(titles).toEqual(expect.arrayContaining(["D", "E"]));
  });

  it("isolates failures — a bad id is reported, valid ids still process", async () => {
    const goodId = await proposeRecord("Good");
    const { results } = await client.changeRequests.reviewMany({
      changeRequestIds: [goodId, "crq_does_not_exist"],
      verdict: "approved",
    });
    const byId = Object.fromEntries(results.map((r) => [r.changeRequestId, r]));
    expect(byId[goodId]?.ok).toBe(true);
    expect(byId.crq_does_not_exist?.ok).toBe(false);
    expect(byId.crq_does_not_exist?.error).toMatch(/not found/i);
    // The valid one really was approved despite the sibling failure.
    await client.changeRequests.merge({ changeRequestId: goodId });
  });

  it("rejects an empty batch (min 1)", async () => {
    await expect(client.changeRequests.mergeMany({ changeRequestIds: [] })).rejects.toThrow();
  });
});
