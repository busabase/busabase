import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import type { ChangeRequestVO } from "busabase-contract/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { extractOperationFieldChanges } from "../src/domains/dashboard/helpers/operation-diff";
import { seedScenario } from "../src/logic/store";
import { busabaseRouter } from "../src/router";

/**
 * A change request that landed by three-way auto-merge reports what it ACTUALLY
 * changed. A and B are proposed from the same record version; A moves the
 * stage and merges first, B repeats that stage and adds a note. B's proposal
 * says "stage lead → qualified, notes …", but B really changed only the note —
 * its review page, the record history and the API used to show both.
 */
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

describe("merged change requests show the change that landed", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-landed-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-landed-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    await seedScenario({ folders: DEMO_FOLDERS, bases: DEMO_BASES });
    const base = await client.bases.create({
      slug: "landed-diff",
      name: "Landed Diff",
      fields: [
        { slug: "name", name: "Deal", type: "text" },
        {
          slug: "stage",
          name: "Stage",
          type: "select",
          options: {
            choices: [
              { id: "lead", name: "Lead" },
              { id: "qualified", name: "Qualified" },
            ],
          },
        },
        { slug: "notes", name: "Notes", type: "text" },
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

  const createRecord = async (name: string) => {
    const created = await client.bases.createChangeRequest({
      baseId,
      fields: { name, stage: "lead", notes: "first call" },
      autoMerge: true,
    });
    if (!("materialized" in created) || !created.materialized) throw new Error("Expected a record");
    return created.id;
  };
  const propose = async (recordId: string, fields: Record<string, unknown>, message: string) => {
    const result = await client.records.changeRequest({
      operation: "update",
      recordId,
      fields,
      message,
      autoMerge: false,
    });
    if (result.materialized) throw new Error("Expected a pending proposal");
    return result;
  };
  const approveAndMerge = async (changeRequestId: string) => {
    await client.changeRequests.review({
      changeRequestIds: [changeRequestId],
      verdict: "approved",
    });
    const merged = await client.changeRequests.merge({ changeRequestIds: [changeRequestId] });
    expect(merged.results[0]).toMatchObject({ ok: true, status: "merged" });
  };
  const changedSlugs = (changeRequest: ChangeRequestVO | null) => {
    const operation = changeRequest?.operations[0];
    if (!operation) throw new Error("Expected an operation");
    return extractOperationFieldChanges(operation).map((change) => ({
      slug: change.slug,
      before: change.beforeValue,
      after: change.afterValue,
    }));
  };
  const userChanges = (changes: ReturnType<typeof changedSlugs>) =>
    changes.filter((change) => ["name", "stage", "notes"].includes(change.slug));

  it("reports the landed before → after for a three-way merge, keeping the operation's identity", async () => {
    const id = await createRecord("Three-way");
    const a = await propose(id, { stage: "qualified" }, "A: qualify");
    const b = await propose(id, { stage: "qualified", notes: "signed" }, "B: qualify and note");
    const proposalHead = b.operations[0]?.headCommitId;
    await approveAndMerge(a.id);
    await approveAndMerge(b.id);

    const detail = await client.changeRequests.get({ changeRequestId: b.id });
    expect(userChanges(changedSlugs(detail))).toEqual([
      { slug: "notes", before: "first call", after: "signed" },
    ]);
    const operation = detail?.operations[0];
    // Identity, message and review state stay anchored to the proposal.
    expect(operation?.headCommitId).toBe(proposalHead);
    expect(operation?.headCommit.id).toBe(proposalHead);
    expect(operation?.headCommit.message).toBe("B: qualify and note");
    const review = detail?.reviews.find((item) => item.verdict === "approved");
    expect(review?.visibleOperationHeads[operation?.id ?? ""]).toBe(operation?.headCommitId);

    // The record history (capped list hydration) agrees.
    const history = await client.records.listChangeRequests({ recordId: id, limit: 5 });
    const listed = history.find((changeRequest) => changeRequest.id === b.id) ?? null;
    expect(userChanges(changedSlugs(listed))).toEqual([
      { slug: "notes", before: "first call", after: "signed" },
    ]);

    // A merged without a three-way merge: unchanged.
    const first = await client.changeRequests.get({ changeRequestId: a.id });
    expect(userChanges(changedSlugs(first))).toEqual([
      { slug: "stage", before: "lead", after: "qualified" },
    ]);
  });

  it("keeps showing a pending proposal as proposed", async () => {
    const id = await createRecord("Pending");
    const pending = await propose(id, { notes: "draft" }, "pending note");
    const detail = await client.changeRequests.get({ changeRequestId: pending.id });
    expect(userChanges(changedSlugs(detail))).toEqual([
      { slug: "notes", before: "first call", after: "draft" },
    ]);
  });

  it("ignores superseded revisions of a proposal that merged without a three-way merge", async () => {
    const id = await createRecord("Revised plain");
    const proposal = await propose(id, { notes: "draft" }, "rvp proposal");
    await client.operations.revise({
      operationId: proposal.operations[0]?.id ?? "",
      fields: { name: "Revised plain (renamed)" },
      message: "rvp revised",
    });
    await approveAndMerge(proposal.id);
    const detail = await client.changeRequests.get({ changeRequestId: proposal.id });
    expect(userChanges(changedSlugs(detail))).toEqual([
      { slug: "name", before: "Revised plain", after: "Revised plain (renamed)" },
    ]);
  });

  it("uses the landed commit, not a superseded revision, for a revised proposal", async () => {
    const id = await createRecord("Revised");
    const a = await propose(id, { stage: "qualified" }, "rv A");
    const b = await propose(id, { notes: "draft" }, "rv B");
    const operationId = b.operations[0]?.id ?? "";
    await client.operations.revise({
      operationId,
      fields: { stage: "qualified", notes: "signed" },
      message: "rv B (revised)",
    });
    await approveAndMerge(a.id);
    await approveAndMerge(b.id);
    const detail = await client.changeRequests.get({ changeRequestId: b.id });
    expect(userChanges(changedSlugs(detail))).toEqual([
      { slug: "notes", before: "first call", after: "signed" },
    ]);
  });
});
