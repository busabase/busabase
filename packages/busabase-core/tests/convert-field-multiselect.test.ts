import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * A multiselect cell is comma-separated, and `fromText` splits it before matching each
 * part against a choice NAME. `auto_create` used to mint ONE choice from the whole cell
 * (`"a,b"`), so every comma-containing value matched nothing: the column silently
 * converted to `[]` while a junk `"a,b"` choice sat on the field. `previewFieldConversion`
 * called that same wipe "convertible", so the dry run reported zero conflicts for a
 * conversion that was about to destroy the data.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const MULTI = "google-sem,google-video";
const SINGLE = "reddit";

describe("mergeBaseConvertField — text → multiselect keeps every comma-separated part", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";
  let platformsFieldId = "";
  const recordIdByValue = new Map<string, string>();

  const approveAndMerge = async (changeRequestId: string) => {
    await client.changeRequests.review({
      changeRequestIds: [changeRequestId],
      verdict: "approved",
    });
    const [result] = (await client.changeRequests.merge({ changeRequestIds: [changeRequestId] }))
      .results;
    if (!result?.ok)
      throw Object.assign(new Error(result?.error ?? "Change request merge returned no result"), {
        code: result?.code,
        data: result?.data,
      });
    return result;
  };

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-multiselect-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-multiselect-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "ad-reports",
      name: "Ad reports",
      fields: [
        { slug: "title", name: "Title", type: "text", required: true, options: {} },
        { slug: "platforms", name: "Platforms", type: "text", required: false, options: {} },
      ],
      autoMerge: true,
    });
    baseId = base.id;
    platformsFieldId = base.fields.find((field) => field.slug === "platforms")?.id ?? "";

    const cr = await client.bases.createBulkChangeRequest({
      baseId,
      records: [
        { title: "r0", platforms: MULTI },
        { title: "r1", platforms: SINGLE },
      ],
      message: "seed",
    });
    await approveAndMerge(cr.id);

    const page = await client.records.list({ baseId, limit: 50 });
    for (const record of page.records) {
      const value = record.headCommit.payload.platforms;
      if (typeof value === "string") recordIdByValue.set(value, record.id);
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

  it("preview flags the wipe under null_on_missing and stays clean under auto_create", async () => {
    // The field has no choices yet, so nothing can match: dropping the column is exactly
    // what `null_on_missing` would do, and the preview has to say so.
    const strict = await client.bases.previewFieldConversion({
      baseId,
      fieldId: platformsFieldId,
      newType: "multiselect",
      selectChoiceMode: "null_on_missing",
    });
    expect(strict.totalCount).toBe(2);
    expect(strict.convertibleCount).toBe(0);
    expect(strict.conflicts).toHaveLength(2);

    // `auto_create` mints a choice per part, so the same values are genuinely convertible.
    const lenient = await client.bases.previewFieldConversion({
      baseId,
      fieldId: platformsFieldId,
      newType: "multiselect",
      selectChoiceMode: "auto_create",
    });
    expect(lenient.totalCount).toBe(2);
    expect(lenient.convertibleCount).toBe(2);
    expect(lenient.conflicts).toHaveLength(0);
  });

  it("auto_create mints one choice per comma-separated part, not one per cell", async () => {
    const convertCr = await client.bases.fieldChangeRequest({
      operation: "convert",
      baseId,
      fieldId: platformsFieldId,
      newType: "multiselect",
      selectChoiceMode: "auto_create",
    });
    await approveAndMerge(convertCr.id);

    const updatedBase = (await client.bases.list({})).find((base) => base.id === baseId);
    const field = updatedBase?.fields.find((f) => f.slug === "platforms");
    expect(field?.type).toBe("multiselect");

    const choiceNames = (field?.options?.choices ?? []).map((choice) => choice.name).sort();
    expect(choiceNames).toEqual(["google-sem", "google-video", "reddit"]);
    // The whole-cell string must NOT survive as a choice of its own.
    expect(choiceNames).not.toContain(MULTI);

    const choiceIdByName = new Map(
      (field?.options?.choices ?? []).map((choice) => [choice.name, choice.id]),
    );

    const multiRecordId = recordIdByValue.get(MULTI);
    expect(multiRecordId).toBeDefined();
    if (multiRecordId) {
      const record = await client.records.get({ recordId: multiRecordId });
      expect(record?.headCommit.payload.platforms).toEqual([
        choiceIdByName.get("google-sem"),
        choiceIdByName.get("google-video"),
      ]);
    }

    const singleRecordId = recordIdByValue.get(SINGLE);
    expect(singleRecordId).toBeDefined();
    if (singleRecordId) {
      const record = await client.records.get({ recordId: singleRecordId });
      expect(record?.headCommit.payload.platforms).toEqual([choiceIdByName.get("reddit")]);
    }
  });
});
