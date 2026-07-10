import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { busabaseRouter } from "../src/router";

/**
 * Safety net for mergeBaseConvertField at scale — the case a chunked rewrite must
 * reproduce byte-identically. Converts a text field to a select with auto_create
 * over enough records to cross the convert scan chunk boundary, with 40 distinct
 * labels spread across the records (so the choice-collection pass must see every
 * distinct value across chunks) plus null-valued records. Asserts every record's
 * authoritative value (commit.fields) maps to its own label's auto-created choice.
 */

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");
const LABELLED = 90; // records with a tag value (cross the chunk boundary)
const DISTINCT = 40; // distinct labels among them
const NULLS = 10; // records with no tag

describe("mergeBaseConvertField — text → select auto_create at scale", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";
  let tagFieldId = "";
  const labelByRecordId = new Map<string, string>();

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-convchunk-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-convchunk-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);

    const base = await client.bases.create({
      slug: "convert",
      name: "Convert",
      fields: [
        { slug: "name", name: "Name", type: "text", required: true, options: {} },
        { slug: "tag", name: "Tag", type: "text", required: false, options: {} },
      ],
      autoMerge: true,
    });
    baseId = base.id;
    tagFieldId = base.fields.find((field) => field.slug === "tag")?.id ?? "";

    const records = [
      ...Array.from({ length: LABELLED }, (_, i) => ({
        name: `r${i}`,
        tag: `label${i % DISTINCT}`,
      })),
      ...Array.from({ length: NULLS }, (_, i) => ({ name: `n${i}` })),
    ];
    const cr = await client.bases.createBulkChangeRequest({ baseId, records, message: "seed" });
    await client.changeRequests.review({ changeRequestId: cr.id, verdict: "approved" });
    await client.changeRequests.merge({ changeRequestId: cr.id });

    // Capture each record's ORIGINAL tag label before the conversion.
    const page = await client.records.listPaged({ baseId, limit: 100 });
    for (const record of page.records) {
      const tag = record.headCommit.fields.tag;
      if (typeof tag === "string" && tag) labelByRecordId.set(record.id, tag);
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

  it("auto-creates a choice per distinct label and maps every record to its own", async () => {
    expect(labelByRecordId.size).toBe(LABELLED);

    const convertCr = await client.bases.convertFieldChangeRequest({
      baseId,
      fieldId: tagFieldId,
      newType: "select",
      selectChoiceMode: "auto_create",
    });
    await client.changeRequests.review({ changeRequestId: convertCr.id, verdict: "approved" });
    await client.changeRequests.merge({ changeRequestId: convertCr.id });

    const updatedBase = (await client.bases.list()).find((base) => base.id === baseId);
    const tagField = updatedBase?.fields.find((field) => field.slug === "tag");
    expect(tagField?.type).toBe("select");
    const choiceIdByName = new Map(
      (tagField?.options?.choices ?? []).map((choice) => [choice.name, choice.id]),
    );
    // One auto choice per distinct label (collected across the whole record set).
    for (let i = 0; i < DISTINCT; i++) {
      expect(choiceIdByName.has(`label${i}`)).toBe(true);
    }

    // Every record's authoritative value (commit.fields) is ITS OWN label's choice
    // id; null-valued records stay null.
    const page = await client.records.listPaged({ baseId, limit: 100 });
    let checkedLabelled = 0;
    let checkedNull = 0;
    for (const record of page.records) {
      const originalLabel = labelByRecordId.get(record.id);
      if (originalLabel) {
        expect(record.headCommit.fields.tag).toBe(choiceIdByName.get(originalLabel));
        checkedLabelled++;
      } else {
        expect(record.headCommit.fields.tag ?? null).toBeNull();
        checkedNull++;
      }
    }
    expect(checkedLabelled).toBe(LABELLED);
    expect(checkedNull).toBe(NULLS);
  });
});
