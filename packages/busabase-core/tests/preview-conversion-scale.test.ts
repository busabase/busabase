import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * previewFieldConversion no longer loads every field value into memory: totals
 * come from SQL counts, the convertibility scan runs in bounded chunks, and the
 * returned `conflicts` list is a capped SAMPLE. This test drives a base with more
 * conflicts than the sample cap and asserts the exact counts still hold (so the
 * `convertibleCount + nullCount + conflictCount === totalCount` contract stays
 * true) while the conflict array itself stays bounded.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const CONFLICTS = 105; // > the 100 conflict-sample cap
const CONVERTIBLE = 45;
const CONFLICT_SAMPLE_CAP = 100;

describe("previewFieldConversion — bounded scan + exact counts", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";
  let tagFieldId = "";
  let nameFieldId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-preview-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-preview-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "tagged",
      name: "Tagged",
      fields: [
        { slug: "name", name: "Name", type: "text", required: true, options: {} },
        { slug: "tag", name: "Tag", type: "text", required: false, options: {} },
      ],
      autoMerge: true,
    });
    baseId = base.id;
    tagFieldId = base.fields.find((field) => field.slug === "tag")?.id ?? "";
    nameFieldId = base.fields.find((field) => field.slug === "name")?.id ?? "";

    // Non-numeric tags → conflict on text→number; numeric strings → convertible.
    const records = [
      ...Array.from({ length: CONFLICTS }, (_, i) => ({ name: `c${i}`, tag: `apple${i}` })),
      ...Array.from({ length: CONVERTIBLE }, (_, i) => ({ name: `k${i}`, tag: `${1000 + i}` })),
    ];
    const cr = await client.bases.createBulkChangeRequest({ baseId, records, message: "seed" });
    await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
    await client.changeRequests.merge({ changeRequestId: cr.id });
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    for (const dir of [dataDir, storageDir]) {
      if (dir) await rm(dir, { recursive: true, force: true });
    }
  });

  it("returns exact counts while capping the conflict sample", async () => {
    expect(tagFieldId).not.toBe("");
    const preview = await client.bases.previewFieldConversion({
      baseId,
      fieldId: tagFieldId,
      newType: "number",
    });

    expect(preview.totalCount).toBe(CONFLICTS + CONVERTIBLE);
    expect(preview.convertibleCount).toBe(CONVERTIBLE);
    expect(preview.nullCount).toBe(0);

    // Conflict count is exact + derivable even though the sample is capped.
    const derivedConflicts = preview.totalCount - preview.convertibleCount - preview.nullCount;
    expect(derivedConflicts).toBe(CONFLICTS);
    expect(preview.conflicts.length).toBe(CONFLICT_SAMPLE_CAP);
    expect(preview.conflicts.length).toBeLessThan(derivedConflicts);
    // Every sampled conflict carries a real record id + its offending value.
    for (const conflict of preview.conflicts) {
      expect(conflict.recordId).not.toBe("");
      expect(String(conflict.currentValue)).toMatch(/^apple/);
    }
  });

  it("reports zero conflicts when every value converts cleanly", async () => {
    // name is a required text field holding non-empty labels; text→text is a
    // no-op conversion, so nothing conflicts and nothing is null.
    const preview = await client.bases.previewFieldConversion({
      baseId,
      fieldId: nameFieldId,
      newType: "text",
    });
    expect(preview.totalCount).toBe(CONFLICTS + CONVERTIBLE);
    expect(preview.convertibleCount + preview.nullCount).toBe(preview.totalCount);
    expect(preview.conflicts).toHaveLength(0);
  });
});
