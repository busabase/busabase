import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * mergeBaseConvertField rewrites each affected record's head-commit `fields` with
 * that record's OWN converted value. The N+1 fix batched the head-commit reads
 * into two `inArray` queries + per-record maps, so the risk is cross-record
 * contamination: record A ending up with record B's converted value. This test
 * converts a text column with DISTINCT values per record and asserts every record
 * still lands on its own choice id.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const LABELS = ["Apple", "Banana", "Cherry", "Date", "Elderberry"];

describe("mergeBaseConvertField — batched commit rewrite keeps values per-record", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";
  let categoryFieldId = "";
  const recordIdByLabel = new Map<string, string>();

  const approveAndMerge = async (changeRequestId: string) => {
    await client.changeRequests.review({ changeRequestId, verdict: "approved" });
    return client.changeRequests.merge({ changeRequestId });
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-convert-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-convert-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "fruit",
      name: "Fruit",
      fields: [
        { slug: "title", name: "Title", type: "text", required: true, options: {} },
        { slug: "category", name: "Category", type: "text", required: false, options: {} },
      ],
      autoMerge: true,
    });
    baseId = base.id;
    categoryFieldId = base.fields.find((field) => field.slug === "category")?.id ?? "";

    const cr = await client.bases.createBulkChangeRequest({
      baseId,
      records: LABELS.map((label, i) => ({ title: `r${i}`, category: label })),
      message: "seed",
    });
    await approveAndMerge(cr.id);

    const page = await client.records.listPaged({ baseId, limit: 50 });
    for (const record of page.records) {
      const label = record.headCommit.fields.category;
      if (typeof label === "string") recordIdByLabel.set(label, record.id);
    }
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("converts text → select giving every record its own choice id", async () => {
    expect(recordIdByLabel.size).toBe(LABELS.length);

    const convertCr = await client.bases.convertFieldChangeRequest({
      baseId,
      fieldId: categoryFieldId,
      newType: "select",
      selectChoiceMode: "auto_create",
    });
    await approveAndMerge(convertCr.id);

    const updatedBase = (await client.bases.list()).find((base) => base.id === baseId);
    const categoryField = updatedBase?.fields.find((field) => field.slug === "category");
    expect(categoryField?.type).toBe("select");
    const choiceIdByName = new Map(
      (categoryField?.options?.choices ?? []).map((choice) => [choice.name, choice.id]),
    );

    // Each record's authoritative value is now ITS OWN label's choice id.
    for (const label of LABELS) {
      const recordId = recordIdByLabel.get(label);
      expect(recordId).toBeDefined();
      if (!recordId) continue;
      const record = await client.records.get({ recordId });
      expect(record?.headCommit.fields.category).toBe(choiceIdByName.get(label));
    }
  });
});
