import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRouterClient } from "@orpc/server";
import type { ChangeRequestVO } from "busabase-contract/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { LOCAL_SPACE_ID, runWithBusabaseContext } from "../src/context";
import { DEMO_BASES, DEMO_FOLDERS } from "../src/demo/dataset";
import { seedScenario } from "../src/logic/store";
import { busabaseRouter } from "../src/router";

/**
 * One-click record revert, end to end through the real Change Request
 * lifecycle on PGLite: `records.revertPreview` and `records.changeRequest`
 * `operation: "revert"` (the one path both the History panel and agents use).
 */
const MIGRATIONS_CWD = path.resolve(__dirname, "../../../apps/busabase");

type Client = ReturnType<typeof createRouterClient<typeof busabaseRouter, Record<never, never>>>;

const as = <T>(actorId: string, permissionLevel: "read" | "changeRequest", fn: () => Promise<T>) =>
  runWithBusabaseContext(
    { spaceId: LOCAL_SPACE_ID, actorId, isSpaceManager: false, permissionLevel },
    fn,
  );

describe("record revert through the Change Request lifecycle", () => {
  let dataDir = "";
  let storageDir = "";
  let originalCwd = "";
  let client: Client;
  let baseId = "";
  let fieldIds: Record<string, string> = {};

  const fieldsOf = async (recordId: string) =>
    (await client.records.get({ recordId })).headCommit.payload;

  const history = (recordId: string) => client.records.listChangeRequests({ recordId });

  const createRecord = async (fields: Record<string, unknown>, message: string) => {
    const created = await client.bases.createChangeRequest({
      baseId,
      fields,
      message,
      autoMerge: true,
    });
    if (!("materialized" in created) || !created.materialized) {
      throw new Error("Expected the record create to merge");
    }
    return created.id;
  };

  const update = async (recordId: string, fields: Record<string, unknown>, message: string) => {
    const result = await client.records.changeRequest({
      operation: "update",
      recordId,
      fields,
      message,
      autoMerge: true,
    });
    if (!result.materialized) throw new Error("Expected the update to merge");
  };

  /** The newest merged change request on the record whose commit message is `message`. */
  const changeRequestFor = async (recordId: string, message: string): Promise<ChangeRequestVO> => {
    const match = (await history(recordId)).find((changeRequest) =>
      changeRequest.operations.some((operation) => operation.headCommit.message === message),
    );
    if (!match) throw new Error(`No change request "${message}" on ${recordId}`);
    return match;
  };

  const revert = (recordId: string, toBeforeChangeRequestId: string, autoMerge?: boolean) =>
    client.records.changeRequest({
      operation: "revert",
      recordId,
      toBeforeChangeRequestId,
      ...(autoMerge === undefined ? {} : { autoMerge }),
    });

  beforeAll(async () => {
    originalCwd = process.cwd();
    process.chdir(MIGRATIONS_CWD);
    dataDir = await mkdtemp(path.join(os.tmpdir(), "busabase-revert-db-"));
    storageDir = await mkdtemp(path.join(os.tmpdir(), "busabase-revert-storage-"));
    process.env.PG_DATABASE_URL = `pglite://${dataDir}`;
    process.env.STORAGE_URL = `local:${storageDir}?base_url=/api/test/storage`;
    client = createRouterClient(busabaseRouter);
    await seedScenario({ folders: DEMO_FOLDERS, bases: DEMO_BASES });

    const base = await client.bases.create({
      slug: "revert-deals",
      name: "Revert Deals",
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
              { id: "lost", name: "Lost" },
            ],
          },
        },
        { slug: "amount", name: "Amount", type: "number" },
        { slug: "notes", name: "Notes", type: "text" },
        { slug: "region", name: "Region", type: "text" },
        { slug: "priority", name: "Priority", type: "text" },
      ],
      autoMerge: true,
    });
    if ("status" in base) throw new Error("Expected materialized BaseVO");
    baseId = base.id;
    fieldIds = Object.fromEntries(base.fields.map((field) => [field.slug, field.id]));
  });

  afterAll(async () => {
    delete process.env.PG_DATABASE_URL;
    delete process.env.STORAGE_URL;
    if (originalCwd) process.chdir(originalCwd);
    if (dataDir) await rm(dataDir, { recursive: true, force: true });
    if (storageDir) await rm(storageDir, { recursive: true, force: true });
  });

  it("A → B → C, revert to before B: post-A values, other records untouched, tagged and itself rollable", async () => {
    const acme = await createRecord(
      { name: "Acme", stage: "qualified", amount: 12000, notes: "Call booked", region: "EMEA" },
      "A: add Acme",
    );
    const globex = await createRecord(
      { name: "Globex", stage: "lead", amount: 3000 },
      "add Globex",
    );
    // B changes BOTH records in one change request.
    const bulk = await client.bases.createBulkUpdateChangeRequest({
      baseId,
      updates: [
        { recordId: acme, fields: { stage: "lost", amount: 0 } },
        { recordId: globex, fields: { amount: 9000 } },
      ],
      message: "B: mark Acme lost",
      autoMerge: true,
    });
    expect(bulk.status).toBe("merged");
    await update(acme, { notes: "Churned", region: "APAC" }, "C: churn notes");
    const postC = await fieldsOf(acme);
    const b = await changeRequestFor(acme, "B: mark Acme lost");
    const c = await changeRequestFor(acme, "C: churn notes");

    const preview = await client.records.revertPreview({
      recordId: acme,
      toBeforeChangeRequestId: b.id,
    });
    expect(preview.action).toBe("update");
    expect(preview.undoneChangeRequests.map((changeRequest) => changeRequest.id)).toEqual([
      c.id,
      b.id,
    ]);
    expect(preview.fields).toEqual({
      stage: "qualified",
      amount: 12000,
      notes: "Call booked",
      region: "EMEA",
    });
    expect(preview.viewerCanRevert).toBe(true);
    expect(preview.willAutoMerge).toBe(true);
    // The preview changed nothing.
    expect(await fieldsOf(acme)).toEqual(postC);

    const result = await revert(acme, b.id);
    expect(result.materialized).toBe(true);
    const rolledBack = await fieldsOf(acme);
    expect(rolledBack).toMatchObject({
      name: "Acme",
      stage: "qualified",
      amount: 12000,
      notes: "Call booked",
      region: "EMEA",
    });
    // B also changed Globex; a revert of Acme leaves it alone.
    expect((await fieldsOf(globex)).amount).toBe(9000);

    const [latest] = await history(acme);
    expect(latest?.status).toBe("merged");
    expect(latest?.sourceMeta).toMatchObject({
      subject: "record_revert",
      revert: {
        recordId: acme,
        toBeforeChangeRequestId: b.id,
        undoneChangeRequestIds: [c.id, b.id],
      },
    });
    expect(latest?.operations.map((operation) => operation.operation)).toEqual(["record_update"]);

    // The revert is an ordinary change: rolling IT back restores post-C.
    const undo = await revert(acme, latest?.id ?? "");
    expect(undo.materialized).toBe(true);
    expect(await fieldsOf(acme)).toMatchObject({
      stage: postC.stage,
      amount: postC.amount,
      notes: postC.notes,
      region: postC.region,
    });
  });

  it("selecting creation restores the initial record instead of trashing it", async () => {
    const id = await createRecord({ name: "Initech", amount: 500 }, "create Initech");
    const created = await changeRequestFor(id, "create Initech");
    await expect(revert(id, created.id)).rejects.toMatchObject({
      code: "CONFLICT",
      data: { reason: "nothing_to_revert" },
    });
    await update(id, { name: "Changed" }, "edit Initech");
    const preview = await client.records.revertPreview({
      recordId: id,
      toBeforeChangeRequestId: created.id,
    });
    expect(preview.action).toBe("update");
    expect(preview.fields).toMatchObject({ name: "Initech" });
    await revert(id, created.id);
    const restored = await client.records.get({ recordId: id });
    expect(restored.status).toBe("active");
    expect(restored.headCommit.payload).toMatchObject({ name: "Initech", amount: 500 });
  });

  it("a trashed record only reverts the delete that trashed it", async () => {
    const id = await createRecord({ name: "Hooli" }, "create Hooli");
    await update(id, { amount: 1 }, "Hooli amount");
    await client.records.changeRequest({ operation: "delete", recordId: id, autoMerge: true });
    const created = await changeRequestFor(id, "create Hooli");
    await expect(revert(id, created.id)).rejects.toMatchObject({
      code: "CONFLICT",
      data: { reason: "record_in_trash" },
    });
  });

  it("a view-only user can preview but not revert", async () => {
    const id = await createRecord({ name: "Viewer test", amount: 1 }, "viewer create");
    await update(id, { amount: 2 }, "viewer edit");
    const edit = await changeRequestFor(id, "viewer edit");
    const create = await changeRequestFor(id, "viewer create");
    await as("vera-viewer", "read", async () => {
      const preview = await client.records.revertPreview({
        recordId: id,
        toBeforeChangeRequestId: edit.id,
      });
      expect(preview.viewerCanRevert).toBe(false);
      await expect(revert(id, edit.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
      // The delete/restore creators have no edit gate of their own; the
      // revert's gate is what stops a viewer trashing a record this way.
      await expect(revert(id, create.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
    expect((await fieldsOf(id)).amount).toBe(2);
    expect((await client.records.get({ recordId: id })).status).toBe("active");
    expect((await history(id)).length).toBe(2);
  });

  it("without write access the revert waits for review, and a retry does not queue a second one", async () => {
    const id = await createRecord({ name: "Review test", amount: 10 }, "review create");
    await update(id, { amount: 20 }, "review edit");
    const edit = await changeRequestFor(id, "review edit");
    const pending = await as("pat-proposer", "changeRequest", async () => {
      const preview = await client.records.revertPreview({
        recordId: id,
        toBeforeChangeRequestId: edit.id,
      });
      expect(preview).toMatchObject({ viewerCanRevert: true, willAutoMerge: false });
      const first = await revert(id, edit.id);
      const retry = await revert(id, edit.id);
      expect(first.materialized).toBe(false);
      expect(retry.materialized).toBe(false);
      expect(retry.id).toBe(first.id);
      // The author cannot approve their own way around the gate.
      await expect(
        client.changeRequests.review({ changeRequestIds: [first.id], verdict: "approved" }),
      ).resolves.toMatchObject({ results: [expect.objectContaining({ ok: false })] });
      return first;
    });
    expect(pending.materialized).toBe(false);
    if (pending.materialized) return;
    expect(pending.status).toBe("in_review");
    expect((await fieldsOf(id)).amount).toBe(20);
    expect(
      (await history(id)).filter(
        (changeRequest) => changeRequest.sourceMeta.subject === "record_revert",
      ),
    ).toHaveLength(1);

    await client.changeRequests.review({ changeRequestIds: [pending.id], verdict: "approved" });
    await client.changeRequests.merge({ changeRequestIds: [pending.id] });
    expect((await fieldsOf(id)).amount).toBe(10);
  });

  it("a field deleted after the target point stops the revert, naming the field, and changes nothing", async () => {
    const id = await createRecord({ name: "Drift", priority: "high", amount: 1 }, "drift create");
    await update(id, { priority: "low", amount: 2 }, "drift edit");
    const edit = await changeRequestFor(id, "drift edit");
    await client.bases.fieldChangeRequest({
      baseId,
      operation: "delete",
      fieldId: fieldIds.priority ?? "",
      autoMerge: true,
    });
    const before = await fieldsOf(id);
    const crsBefore = (await history(id)).length;
    const expected = {
      code: "CONFLICT",
      // Named the way people know it: the deleted field is no longer on the
      // Base the caller holds, so the server sends its display name along.
      data: { reason: "field_deleted", fieldSlug: "priority", fieldName: "Priority" },
      message: expect.stringContaining('"Priority" (priority)'),
    };
    await expect(
      client.records.revertPreview({ recordId: id, toBeforeChangeRequestId: edit.id }),
    ).rejects.toMatchObject(expected);
    await expect(revert(id, edit.id)).rejects.toMatchObject(expected);
    expect(await fieldsOf(id)).toEqual(before);
    expect((await history(id)).length).toBe(crsBefore);
  });

  it("a field converted to another type after the target point stops the revert, naming the field", async () => {
    const id = await createRecord({ name: "Convert", region: "EMEA" }, "convert create");
    await update(id, { region: "APAC" }, "convert edit");
    const edit = await changeRequestFor(id, "convert edit");
    await client.bases.fieldChangeRequest({
      baseId,
      operation: "convert",
      fieldId: fieldIds.region ?? "",
      newType: "longtext",
      autoMerge: true,
    });
    await expect(revert(id, edit.id)).rejects.toMatchObject({
      code: "CONFLICT",
      data: { reason: "field_type_changed", fieldSlug: "region" },
    });
    expect((await fieldsOf(id)).region).toBe("APAC");
  });

  it("inverts what a three-way-merged change actually landed as, not its proposal", async () => {
    const id = await createRecord(
      { name: "Three-way", stage: "lead", notes: "first call" },
      "3w create",
    );
    // A and B are both proposed from the same record version. A moves the
    // stage; B repeats that stage and adds a note. A merges first, so B lands
    // by three-way auto-merge and really changes only the note.
    const propose = async (fields: Record<string, unknown>, message: string) => {
      const result = await client.records.changeRequest({
        operation: "update",
        recordId: id,
        fields,
        message,
        autoMerge: false,
      });
      if (result.materialized) throw new Error("Expected a pending proposal");
      return result.id;
    };
    const a = await propose({ stage: "qualified" }, "3w A: qualify");
    const b = await propose({ stage: "qualified", notes: "signed" }, "3w B: qualify and note");
    for (const changeRequestId of [a, b]) {
      await client.changeRequests.review({
        changeRequestIds: [changeRequestId],
        verdict: "approved",
      });
      const merged = await client.changeRequests.merge({ changeRequestIds: [changeRequestId] });
      expect(merged.results[0]).toMatchObject({ ok: true, status: "merged" });
    }
    expect(await fieldsOf(id)).toMatchObject({ stage: "qualified", notes: "signed" });

    const preview = await client.records.revertPreview({
      recordId: id,
      toBeforeChangeRequestId: b,
    });
    expect(preview.fields).toEqual({ notes: "first call" });
    expect((await revert(id, b)).materialized).toBe(true);
    // A's stage stays: reverting B must not undo a value B merely repeated.
    expect(await fieldsOf(id)).toMatchObject({ stage: "qualified", notes: "first call" });
  });

  it("finds the landed change of a proposal that was revised before its three-way merge", async () => {
    const id = await createRecord(
      { name: "Revised", stage: "lead", notes: "first call" },
      "rv create",
    );
    const propose = async (fields: Record<string, unknown>, message: string) => {
      const result = await client.records.changeRequest({
        operation: "update",
        recordId: id,
        fields,
        message,
        autoMerge: false,
      });
      if (result.materialized) throw new Error("Expected a pending proposal");
      return result;
    };
    const a = await propose({ stage: "qualified" }, "rv A");
    const b = await propose({ notes: "draft" }, "rv B");
    // B is revised (a new commit on the same operation) before anything merges.
    const bOperation = b.operations[0];
    if (!bOperation) throw new Error("Expected B's operation");
    await client.operations.revise({
      operationId: bOperation.id,
      fields: { stage: "qualified", notes: "signed" },
      message: "rv B (revised)",
    });
    for (const changeRequestId of [a.id, b.id]) {
      await client.changeRequests.review({
        changeRequestIds: [changeRequestId],
        verdict: "approved",
      });
      const merged = await client.changeRequests.merge({ changeRequestIds: [changeRequestId] });
      expect(merged.results[0]).toMatchObject({ ok: true, status: "merged" });
    }
    const preview = await client.records.revertPreview({
      recordId: id,
      toBeforeChangeRequestId: b.id,
    });
    expect(preview.fields).toEqual({ notes: "first call" });
  });

  it("ignores superseded revisions of a proposal that merged without a three-way merge", async () => {
    const id = await createRecord(
      { name: "Revised plain", amount: 1, notes: "first call" },
      "rvp create",
    );
    const proposal = await client.records.changeRequest({
      operation: "update",
      recordId: id,
      fields: { notes: "draft" },
      message: "rvp proposal",
      autoMerge: false,
    });
    if (proposal.materialized) throw new Error("Expected a pending proposal");
    const operation = proposal.operations[0];
    if (!operation) throw new Error("Expected the proposal's operation");
    // Revised to touch a different field; the first draft never lands.
    await client.operations.revise({
      operationId: operation.id,
      fields: { amount: 7 },
      message: "rvp revised",
    });
    await client.changeRequests.review({ changeRequestIds: [proposal.id], verdict: "approved" });
    await client.changeRequests.merge({ changeRequestIds: [proposal.id] });
    expect(await fieldsOf(id)).toMatchObject({ amount: 7, notes: "first call" });
    const preview = await client.records.revertPreview({
      recordId: id,
      toBeforeChangeRequestId: proposal.id,
    });
    expect(preview.fields).toEqual({ amount: 1 });
  });

  it("a revert waiting for review merges over later edits to other fields, and does not overwrite a later edit to its own", async () => {
    const id = await createRecord({ name: "Pending", amount: 1, notes: "n1" }, "pending create");
    await update(id, { amount: 2 }, "pending edit");
    const edit = await changeRequestFor(id, "pending edit");
    const submit = () =>
      as("pat-proposer", "changeRequest", async () => {
        const result = await revert(id, edit.id);
        if (result.materialized) throw new Error("Expected a pending revert");
        return result.id;
      });

    // Someone edits a DIFFERENT field before approval: both survive.
    const first = await submit();
    await update(id, { notes: "n2" }, "pending other-field edit");
    await client.changeRequests.review({ changeRequestIds: [first], verdict: "approved" });
    await client.changeRequests.merge({ changeRequestIds: [first] });
    expect(await fieldsOf(id)).toMatchObject({ amount: 1, notes: "n2" });

    // Someone edits the SAME field before approval: the later value is not
    // silently overwritten by the older revert.
    await update(id, { amount: 3 }, "pending edit 2");
    const edit2 = await changeRequestFor(id, "pending edit 2");
    const second = await as("pat-proposer", "changeRequest", async () => {
      const result = await revert(id, edit2.id);
      if (result.materialized) throw new Error("Expected a pending revert");
      return result.id;
    });
    await update(id, { amount: 9 }, "pending same-field edit");
    await client.changeRequests.review({ changeRequestIds: [second], verdict: "approved" });
    const merged = await client.changeRequests.merge({ changeRequestIds: [second] });
    // The ordinary three-way merge refuses it, naming the field, for review.
    expect(merged.results[0]).toMatchObject({
      ok: false,
      code: "CONFLICT",
      data: { conflicts: ["amount"] },
    });
    expect((await fieldsOf(id)).amount).toBe(9);
  });

  it("refuses a confirm whose preview is stale, writing nothing, and accepts the fresh one", async () => {
    const id = await createRecord({ name: "Stale", amount: 1, notes: "n1" }, "stale create");
    await update(id, { amount: 2 }, "stale edit");
    const edit = await changeRequestFor(id, "stale edit");
    const shown = await client.records.revertPreview({
      recordId: id,
      toBeforeChangeRequestId: edit.id,
    });
    expect(shown.undoneChangeRequests).toHaveLength(1);

    // A teammate's edit lands while the dialog is open; reverting to before
    // "stale edit" would now undo it too, which the preview never showed.
    await update(id, { notes: "teammate" }, "teammate edit");
    const before = await fieldsOf(id);
    const crsBefore = (await history(id)).length;
    await expect(
      client.records.changeRequest({
        operation: "revert",
        recordId: id,
        toBeforeChangeRequestId: edit.id,
        expectedPlanFingerprint: shown.planFingerprint,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT", data: { reason: "plan_changed" } });
    expect(await fieldsOf(id)).toEqual(before);
    expect((await history(id)).length).toBe(crsBefore);

    const fresh = await client.records.revertPreview({
      recordId: id,
      toBeforeChangeRequestId: edit.id,
    });
    expect(fresh.planFingerprint).not.toBe(shown.planFingerprint);
    expect(fresh.undoneChangeRequests).toHaveLength(2);
    const result = await client.records.changeRequest({
      operation: "revert",
      recordId: id,
      toBeforeChangeRequestId: edit.id,
      expectedPlanFingerprint: fresh.planFingerprint,
    });
    expect(result.materialized).toBe(true);
    expect(await fieldsOf(id)).toMatchObject({ amount: 1, notes: "n1" });
  });

  it("rejects a change request outside the record's history and one that never landed", async () => {
    const id = await createRecord({ name: "Scope", amount: 1 }, "scope create");
    const other = await createRecord({ name: "Scope other" }, "scope other create");
    const otherCreate = await changeRequestFor(other, "scope other create");
    await expect(revert(id, otherCreate.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    const proposal = await client.records.changeRequest({
      operation: "update",
      recordId: id,
      fields: { amount: 5 },
      message: "scope proposal",
      autoMerge: false,
    });
    if (proposal.materialized) throw new Error("Expected a pending proposal");
    await expect(revert(id, proposal.id)).rejects.toMatchObject({
      code: "CONFLICT",
      data: { reason: "target_not_merged" },
    });
    // ...and it is listed as pending, unaffected, in a preview of a real target.
    const create = await changeRequestFor(id, "scope create");
    await update(id, { amount: 3 }, "scope edit");
    const edit = await changeRequestFor(id, "scope edit");
    const preview = await client.records.revertPreview({
      recordId: id,
      toBeforeChangeRequestId: edit.id,
    });
    expect(preview.pendingChangeRequests.map((changeRequest) => changeRequest.id)).toEqual([
      proposal.id,
    ]);
    expect(preview.undoneChangeRequests.map((changeRequest) => changeRequest.id)).not.toContain(
      create.id,
    );
  });
});
