import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { seedScenario } from "../src/logic/store";
import { busabaseRouter } from "../src/router";

/**
 * Regression tests for a validation-layer counterpart to the partial-update
 * data-loss bug covered in record-update-partial-fields.test.ts:
 * `createUpdateChangeRequest` used to validate the caller's raw SUBMITTED
 * DELTA (`parsed.fields`) against the base's required fields, instead of the
 * merged view (current committed fields + delta). Any base with ANY required
 * field rejected every partial update that didn't happen to resubmit that
 * field's current value — even though the field already had a value on the
 * record and this update never intended to touch it.
 *
 * Fixed in packages/busabase-core/src/domains/base/logic/record-ops.ts
 * (createUpdateChangeRequest): fetch the record's current committed fields via
 * its headCommitId (same lookup `mergeRecordUpdate` in merge/record.ts already
 * does) and validate `{ ...currentFields, ...parsed.fields }` instead of
 * `parsed.fields` alone. What gets PERSISTED as the commit's delta is
 * unchanged — only the requiredness CHECK sees the merged view.
 *
 * Kept in its own file (rather than appended to
 * record-update-partial-fields.test.ts) because PGLite state is a
 * process-global singleton keyed off `PG_DATABASE_URL` at first init — a
 * second describe block in the same file pointing at a different data dir
 * reuses the FIRST describe's already-initialized (and by then deleted)
 * PGLite instance instead of actually reconnecting, corrupting the run.
 */
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("record_update — required-field validation sees the MERGED view, not just the delta", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-required-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-required-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    await seedScenario({ folders: DEMO_FOLDERS, bases: DEMO_BASES });

    const base = await client.bases.create({
      slug: "required-field-partial-update-test",
      name: "Required Field Partial Update Test",
      fields: [
        { slug: "title", name: "Title", type: "text" },
        {
          slug: "req_multi",
          name: "Req Multi",
          type: "multiselect",
          required: true,
          options: {
            choices: [
              { id: "m1", name: "One" },
              { id: "m2", name: "Two" },
            ],
          },
        },
      ],
      autoMerge: true,
    });
    if ("status" in base) throw new Error("Expected materialized BaseVO");
    baseId = base.id;
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  const approveAndMerge = async (changeRequestId: string) => {
    await client.changeRequests.review({ changeRequestId, verdict: "approved" });
    return client.changeRequests.merge({ changeRequestId });
  };

  const createRecord = async (fields: Record<string, unknown>) => {
    const cr = await client.bases.createChangeRequest({
      baseId,
      fields,
      message: "Create",
      submittedBy: "agent",
      autoMerge: false,
    });
    const merged = await approveAndMerge(cr.id);
    if (!merged.record) throw new Error("expected a created record");
    return merged.record.id;
  };

  const getFields = async (recordId: string) => {
    const record = await client.records.get({ recordId });
    if (!record) throw new Error("expected record to exist");
    return record.headCommit.fields;
  };

  it("a partial update that omits an already-set required field succeeds, and the required field's value survives", async () => {
    const recordId = await createRecord({ title: "G0", req_multi: ["m1"] });

    // Only touches `title` — never mentions req_multi at all. Previously 400'd
    // with "Req Multi is required" even though it already has a value.
    const updateCr = await client.records.updateChangeRequest({
      recordId,
      fields: { title: "G1" },
      autoMerge: false,
    });
    await approveAndMerge(updateCr.id);

    const fields = await getFields(recordId);
    expect(fields.title).toBe("G1");
    expect(fields.req_multi).toEqual(["m1"]); // untouched, survives via merge
  });

  it("explicitly clearing the required field in the SAME partial update still correctly fails", async () => {
    const recordId = await createRecord({ title: "H0", req_multi: ["m1"] });

    await expect(
      client.records.updateChangeRequest({
        recordId,
        fields: { title: "H1", req_multi: [] },
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("Req Multi is required"),
    });

    await expect(
      client.records.updateChangeRequest({
        recordId,
        fields: { title: "H1", req_multi: null },
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("Req Multi is required"),
    });

    // Neither rejected attempt should have changed anything.
    const fields = await getFields(recordId);
    expect(fields.title).toBe("H0");
    expect(fields.req_multi).toEqual(["m1"]);
  });
});
