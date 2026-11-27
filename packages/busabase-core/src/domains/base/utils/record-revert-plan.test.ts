import type {
  ChangeRequestStatus,
  ChangeRequestVO,
  OperationKind,
  OperationStatus,
  OperationVO,
} from "busabase-contract/types";
import { describe, expect, it } from "vitest";
import {
  describeRevertTarget,
  findUndoneChangeRequests,
  isRecordCreation,
  mergedRecordHistory,
  planRecordRevert,
  RecordRevertPlanError,
  type RecordRevertPlanErrorReason,
  type RecordRevertPlanInput,
  type RevertFieldDef,
  type RevertSchemaChanges,
} from "./record-revert-plan";

// ============================================================================
// Fixtures. A Change Request is reduced to what the planner reads: status,
// merge/create times, and per-operation kind, status, record ids, before
// (`baseFields`) and after (`headCommit.payload`).
// ============================================================================

const RECORD = "rec_deal";
const OTHER = "rec_other";

/** ISO time `minute` minutes into a fixed day — later minute = later change. */
const at = (minute: number) => new Date(Date.UTC(2026, 10, 1, 9, minute)).toISOString();

let opSeq = 0;
const op = (
  operation: OperationKind,
  options: {
    recordId?: string;
    before?: Record<string, unknown> | null;
    after?: Record<string, unknown>;
    status?: OperationStatus;
    sourceRecordId?: string | null;
    message?: string;
  } = {},
): OperationVO => {
  opSeq += 1;
  const recordId = options.recordId ?? RECORD;
  const isCreate = operation === "record_create";
  return {
    id: `opr_${opSeq}`,
    changeRequestId: "",
    baseId: "bas_deals",
    targetType: "base",
    nodeId: null,
    operation,
    status: options.status ?? "merged",
    // A creation has no target yet; it names the record it made once merged.
    targetRecordId: isCreate ? null : recordId,
    targetViewId: null,
    filePath: null,
    sourceRecordId: options.sourceRecordId ?? null,
    sourceCommitId: null,
    baseCommitId: null,
    headCommitId: `cmt_${opSeq}`,
    deleteMode: "archive",
    mergedRecordId: recordId,
    mergedViewId: null,
    position: 0,
    createdAt: at(0),
    updatedAt: at(0),
    headCommit: {
      id: `cmt_${opSeq}`,
      baseId: "bas_deals",
      targetType: "base",
      nodeId: null,
      operationId: `opr_${opSeq}`,
      parentCommitId: null,
      payload: options.after ?? {},
      operation,
      message: options.message ?? "",
      author: "usr_kelly",
      createdAt: at(0),
    },
    baseFields: options.before === undefined ? null : options.before,
  } as OperationVO;
};

const createOp = (fields: Record<string, unknown>, recordId = RECORD) =>
  op("record_create", { recordId, after: fields });

/** `before` is the full record before the change; `after` the stored delta. */
const updateOp = (
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  recordId = RECORD,
) => op("record_update", { recordId, before, after });

/** Today's delete path stores the record's fields unchanged. */
const deleteOp = (fields: Record<string, unknown>, recordId = RECORD) =>
  op("record_delete", { recordId, before: fields, after: fields });

const restoreOp = (fields: Record<string, unknown>, recordId = RECORD) =>
  op("record_restore", { recordId, after: fields });

const cr = (
  id: string,
  minute: number,
  operations: OperationVO[],
  options: { status?: ChangeRequestStatus; mergedMinute?: number } = {},
): ChangeRequestVO => {
  const status = options.status ?? "merged";
  return {
    id,
    baseId: "bas_deals",
    targetType: "base",
    nodeId: null,
    status,
    submittedBy: "usr_kelly",
    sourceMeta: {},
    reviewPolicySnapshot: {},
    mergeSummary: {},
    rejectedReason: null,
    reviewedAt: null,
    mergedAt: status === "merged" ? at(options.mergedMinute ?? minute) : null,
    createdAt: at(minute),
    updatedAt: at(options.mergedMinute ?? minute),
    base: null,
    node: null,
    operations: operations.map((operation) => ({ ...operation, changeRequestId: id })),
    primaryOperation: operations[0] ?? null,
    operationCount: operations.length,
    reviews: [],
  } as ChangeRequestVO;
};

const fieldDefs: RevertFieldDef[] = [
  { slug: "name", type: "text" },
  { slug: "stage", type: "select" },
  { slug: "amount", type: "number" },
  { slug: "notes", type: "longtext" },
  { slug: "owner", type: "text" },
  { slug: "meta", type: "json" },
  { slug: "updated", type: "updated_time" },
  { slug: "score", type: "formula" },
  { slug: "deals", type: "relation", options: { reverseOfFieldId: "fld_customer" } },
];

const noSchemaChanges: RevertSchemaChanges = { deleted: new Map(), converted: new Set() };

const plan = (
  overrides: Partial<RecordRevertPlanInput> &
    Pick<RecordRevertPlanInput, "history" | "toBeforeChangeRequestId" | "currentFields">,
) =>
  planRecordRevert({
    recordId: RECORD,
    recordStatus: "active",
    fieldDefs,
    schemaChanges: noSchemaChanges,
    ...overrides,
  });

const planError = (run: () => unknown): RecordRevertPlanError => {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(RecordRevertPlanError);
    return error as RecordRevertPlanError;
  }
  throw new Error("Expected the planner to refuse this revert");
};

const expectRefusal = (
  run: () => unknown,
  reason: RecordRevertPlanErrorReason,
  fieldSlug?: string,
) => {
  const error = planError(run);
  expect(error.reason).toBe(reason);
  expect(error.fieldSlug).toBe(fieldSlug);
  return error;
};

const ids = (changeRequests: ReadonlyArray<ChangeRequestVO>) =>
  changeRequests.map((changeRequest) => changeRequest.id);

// A → B → C on one deal: create, then stage+amount, then notes.
const afterA = { name: "Acme", stage: "lead", amount: 100, notes: "first call" };
const afterB = { ...afterA, stage: "won", amount: 500 };
const afterC = { ...afterB, notes: "signed" };
const chain = () => {
  const A = cr("crq_A", 1, [createOp(afterA)]);
  const B = cr("crq_B", 2, [updateOp(afterA, { stage: "won", amount: 500 })]);
  const C = cr("crq_C", 3, [updateOp(afterB, { notes: "signed" })]);
  return { A, B, C, history: [A, B, C] };
};

// ============================================================================

describe("planRecordRevert — what a change actually landed as", () => {
  // Two proposals from the same base: A sets stage Open → Won and merges first;
  // B ALSO proposes stage=Won plus a note, and lands by three-way auto-merge.
  // Hydration reports B as it landed (A's stage as its base), so only the note
  // is B's to undo. The proposal diff (stage Open → Won) must not be inverted.
  const base = { name: "Acme", stage: "Open", notes: "first call" };
  const afterA = { ...base, stage: "Won" };
  const afterB = { ...afterA, notes: "signed" };

  it("inverts the before → after it is given, so A's stage survives a revert to before B", () => {
    const created = cr("crq_create", 1, [createOp(base)]);
    const a = cr("crq_A", 2, [updateOp(base, { stage: "Won" })]);
    const b = cr("crq_B", 3, [updateOp(afterA, afterB)]);
    const result = plan({
      history: [created, a, b],
      toBeforeChangeRequestId: b.id,
      currentFields: afterB,
    });
    expect(result.fields).toEqual({ notes: "first call" });
  });
});

describe("planRecordRevert — field updates", () => {
  it("rolls a single-field update back to the stored before-value", () => {
    const { C, history } = chain();
    const result = plan({ history, toBeforeChangeRequestId: C.id, currentFields: afterC });
    expect(result.action).toBe("update");
    expect(result.fields).toEqual({ notes: "first call" });
    expect(result.fieldChanges).toEqual([
      { slug: "notes", beforeValue: "signed", afterValue: "first call" },
    ]);
    expect(ids(result.undone)).toEqual(["crq_C"]);
    expect(result.pending).toEqual([]);
  });

  it("reverts every field a multi-field change request touched, and only those", () => {
    const before = { name: "Acme", stage: "lead", amount: 100, owner: "ana", notes: "x" };
    const M = cr("crq_M", 2, [updateOp(before, { stage: "won", amount: 900, owner: "bo" })]);
    const current = { ...before, stage: "won", amount: 900, owner: "bo" };
    const result = plan({
      history: [cr("crq_A", 1, [createOp(before)]), M],
      toBeforeChangeRequestId: M.id,
      currentFields: current,
    });
    expect(result.action).toBe("update");
    expect(result.fields).toEqual({ stage: "lead", amount: 100, owner: "ana" });
    expect(result.fieldChanges).toEqual(
      expect.arrayContaining([
        { slug: "stage", beforeValue: "won", afterValue: "lead" },
        { slug: "amount", beforeValue: 900, afterValue: 100 },
        { slug: "owner", beforeValue: "bo", afterValue: "ana" },
      ]),
    );
    expect(result.fieldChanges).toHaveLength(3);
  });

  it("reverting to before B undoes C too, newest first, landing on the post-A values", () => {
    const { B, history } = chain();
    const result = plan({ history, toBeforeChangeRequestId: B.id, currentFields: afterC });
    expect(result.action).toBe("update");
    expect(ids(result.undone)).toEqual(["crq_C", "crq_B"]);
    expect(result.fields).toEqual({
      stage: afterA.stage,
      amount: afterA.amount,
      notes: afterA.notes,
    });
    // Untouched by B and C, so not part of the revert.
    expect(result.fields).not.toHaveProperty("name");
  });

  it("lets the OLDEST undone change's before-value win for a field several of them changed", () => {
    const B = cr("crq_B", 2, [updateOp(afterA, { stage: "won" })]);
    const C = cr("crq_C", 3, [updateOp({ ...afterA, stage: "won" }, { stage: "lost" })]);
    const result = plan({
      history: [cr("crq_A", 1, [createOp(afterA)]), B, C],
      toBeforeChangeRequestId: B.id,
      currentFields: { ...afterA, stage: "lost" },
    });
    expect(result.fields).toEqual({ stage: "lead" });
  });

  it("inside one change request, inverts the operations last-first", () => {
    const X = cr("crq_X", 2, [
      updateOp(afterA, { stage: "won" }),
      updateOp({ ...afterA, stage: "won" }, { stage: "lost" }),
    ]);
    const result = plan({
      history: [cr("crq_A", 1, [createOp(afterA)]), X],
      toBeforeChangeRequestId: X.id,
      currentFields: { ...afterA, stage: "lost" },
    });
    expect(result.fields).toEqual({ stage: "lead" });
  });

  it("orders the undone set by merge time, not by when a change was authored", () => {
    // B was authored before C but sat in review and merged after it, so B is
    // the newer change: reverting to before C undoes B as well.
    const A = cr("crq_A", 1, [createOp(afterA)]);
    const B = cr("crq_B", 2, [updateOp(afterA, { stage: "won" })], { mergedMinute: 10 });
    const C = cr("crq_C", 3, [updateOp(afterA, { notes: "signed" })], { mergedMinute: 4 });
    const current = { ...afterA, stage: "won", notes: "signed" };
    expect(ids(mergedRecordHistory([A, B, C], RECORD))).toEqual(["crq_B", "crq_C", "crq_A"]);
    const result = plan({
      history: [C, A, B],
      toBeforeChangeRequestId: C.id,
      currentFields: current,
    });
    expect(ids(result.undone)).toEqual(["crq_B", "crq_C"]);
    expect(result.fields).toEqual({ stage: "lead", notes: "first call" });
    // Reverting to before B (the newest) leaves C's edit in place.
    const onlyB = plan({
      history: [A, B, C],
      toBeforeChangeRequestId: B.id,
      currentFields: current,
    });
    expect(ids(onlyB.undone)).toEqual(["crq_B"]);
    expect(onlyB.fields).toEqual({ stage: "lead" });
  });

  it("an added field (no prior value) reverts to null", () => {
    const B = cr("crq_B", 2, [updateOp(afterA, { owner: "kelly" })]);
    const result = plan({
      history: [cr("crq_A", 1, [createOp(afterA)]), B],
      toBeforeChangeRequestId: B.id,
      currentFields: { ...afterA, owner: "kelly" },
    });
    expect(result.action).toBe("update");
    expect(result.fields).toEqual({ owner: null });
    expect(result.fieldChanges).toEqual([
      { slug: "owner", beforeValue: "kelly", afterValue: null },
    ]);
  });
});

describe("planRecordRevert — create, delete and restore", () => {
  it("identifies only landed creation operations on this record, including mixed requests", () => {
    expect(isRecordCreation(cr("mixed", 1, [createOp({}), updateOp({}, {})]), RECORD)).toBe(true);
    expect(isRecordCreation(cr("other", 1, [createOp({}, OTHER)]), RECORD)).toBe(false);
    expect(
      isRecordCreation(
        cr("source", 1, [op("record_create", { recordId: OTHER, sourceRecordId: RECORD })]),
        RECORD,
      ),
    ).toBe(false);
    expect(
      isRecordCreation(cr("pending-op", 1, [op("record_create", { status: "pending" })]), RECORD),
    ).toBe(false);
    expect(
      isRecordCreation(cr("pending-cr", 1, [createOp({})], { status: "in_review" }), RECORD),
    ).toBe(false);
  });
  it("selecting creation restores the record to its initial fields", () => {
    const { A, history } = chain();
    const result = plan({ history, toBeforeChangeRequestId: A.id, currentFields: afterC });
    expect(result.action).toBe("update");
    expect(ids(result.undone)).toEqual(["crq_C", "crq_B"]);
  });

  it("keeps updates in the creation change request and undoes later edits", () => {
    const initial = { name: "Alice" };
    const created = cr("creation", 1, [
      createOp({ name: "Draft" }),
      updateOp({ name: "Draft" }, initial),
    ]);
    const edited = cr("edit", 2, [updateOp(initial, { name: "Bob" })]);
    const result = plan({
      history: [created, edited],
      toBeforeChangeRequestId: created.id,
      currentFields: { name: "Bob" },
    });
    expect(result.action).toBe("update");
    expect(result.fields).toMatchObject({ name: "Alice" });
    expect(ids(result.undone)).toEqual(["edit"]);
    expect(() =>
      plan({ history: [created], toBeforeChangeRequestId: created.id, currentFields: initial }),
    ).toThrow(RecordRevertPlanError);
  });

  it("selecting creation without later changes does not delete the record", () => {
    const { A } = chain();
    expect(() =>
      plan({
        history: [A],
        toBeforeChangeRequestId: A.id,
        currentFields: A.operations[0].headCommit?.payload ?? {},
      }),
    ).toThrow(RecordRevertPlanError);
  });

  it("for a record in the Trash, reverting the delete that put it there restores it", () => {
    const { history } = chain();
    const D = cr("crq_D", 4, [deleteOp(afterC)]);
    const result = plan({
      history: [...history, D],
      recordStatus: "archived",
      toBeforeChangeRequestId: D.id,
      currentFields: afterC,
    });
    expect(result.action).toBe("restore");
    expect(ids(result.undone)).toEqual(["crq_D"]);
    expect(result.fields).toEqual({});
    expect(result.fieldChanges).toEqual([]);
  });

  it.each(["crq_C", "crq_B", "crq_A"])(
    "for a record in the Trash, refuses a revert to before %s (not the delete)",
    (target) => {
      const { history } = chain();
      const D = cr("crq_D", 4, [deleteOp(afterC)]);
      expectRefusal(
        () =>
          plan({
            history: [...history, D],
            recordStatus: "archived",
            toBeforeChangeRequestId: target,
            currentFields: afterC,
          }),
        "record_in_trash",
      );
    },
  );

  it("refuses to restore when the deletion also changed field values", () => {
    const { history } = chain();
    const D = cr("crq_D", 4, [
      op("record_delete", { before: afterC, after: { ...afterC, notes: "deleted by bot" } }),
    ]);
    expectRefusal(
      () =>
        plan({
          history: [...history, D],
          recordStatus: "archived",
          toBeforeChangeRequestId: D.id,
          currentFields: { ...afterC, notes: "deleted by bot" },
        }),
      "delete_with_field_changes",
    );
  });

  // A → B → D(delete) → R(restore) → E(edit after restore)
  const restoredChain = (withEditAfterRestore: boolean) => {
    const { A, B } = chain();
    const D = cr("crq_D", 4, [deleteOp(afterB)]);
    const R = cr("crq_R", 5, [restoreOp(afterB)]);
    const E = cr("crq_E", 6, [updateOp(afterB, { notes: "after restore" })]);
    return {
      R,
      history: withEditAfterRestore ? [A, B, D, R, E] : [A, B, D, R],
      current: withEditAfterRestore ? { ...afterB, notes: "after restore" } : afterB,
    };
  };

  it("undoing a restore with real edits after it is refused (restore_then_edit)", () => {
    const { R, history, current } = restoredChain(true);
    expectRefusal(
      () => plan({ history, toBeforeChangeRequestId: R.id, currentFields: current }),
      "restore_then_edit",
    );
  });

  it("undoing a restore with no later edits sends the record back to the Trash", () => {
    const { R, history, current } = restoredChain(false);
    const result = plan({ history, toBeforeChangeRequestId: R.id, currentFields: current });
    expect(result.action).toBe("delete");
    expect(ids(result.undone)).toEqual(["crq_R"]);
    expect(result.fields).toEqual({});
  });

  it("undoing a restore whose later edits cancel out is still just a delete", () => {
    const { A, B } = chain();
    const D = cr("crq_D", 4, [deleteOp(afterB)]);
    const R = cr("crq_R", 5, [restoreOp(afterB)]);
    const E1 = cr("crq_E1", 6, [updateOp(afterB, { notes: "oops" })]);
    const E2 = cr("crq_E2", 7, [updateOp({ ...afterB, notes: "oops" }, { notes: "first call" })]);
    const result = plan({
      history: [A, B, D, R, E1, E2],
      toBeforeChangeRequestId: R.id,
      currentFields: afterB,
    });
    expect(result.action).toBe("delete");
    expect(ids(result.undone)).toEqual(["crq_E2", "crq_E1", "crq_R"]);
  });

  it("reverting past a delete + restore pair to an earlier edit is a plain update", () => {
    const { A, B } = chain();
    const D = cr("crq_D", 4, [deleteOp(afterB)]);
    const R = cr("crq_R", 5, [restoreOp(afterB)]);
    const result = plan({
      history: [A, B, D, R],
      toBeforeChangeRequestId: B.id,
      currentFields: afterB,
    });
    expect(result.action).toBe("update");
    expect(ids(result.undone)).toEqual(["crq_R", "crq_D", "crq_B"]);
    expect(result.fields).toEqual({ stage: "lead", amount: 100 });
  });
});

describe("planRecordRevert — which operations count", () => {
  it("in a bulk change request, inverts only this record's operation", () => {
    const { A } = chain();
    const bulk = cr("crq_bulk", 2, [
      updateOp(
        { region: "EMEA", stage: "OTHER_BEFORE" },
        { region: "APAC", stage: "OTHER_AFTER" },
        OTHER,
      ),
      updateOp(afterA, { stage: "won" }),
      createOp({ name: "Brand new", stage: "OTHER_CREATED" }, "rec_third"),
    ]);
    const result = plan({
      history: [A, bulk],
      toBeforeChangeRequestId: bulk.id,
      currentFields: { ...afterA, stage: "won" },
    });
    expect(result.action).toBe("update");
    expect(result.fields).toEqual({ stage: "lead" });
    const written = JSON.stringify([result.fields, result.fieldChanges]);
    expect(written).not.toContain("region");
    expect(written).not.toContain("OTHER_");
    expect(written).not.toContain("Brand new");
  });

  it("ignores an operation that only names the record as its source", () => {
    const { C, history } = chain();
    // Newest change: duplicate the deal into a new record (rec_copy).
    const duplicate = cr("crq_dup", 9, [
      op("record_create", {
        recordId: "rec_copy",
        sourceRecordId: RECORD,
        after: { name: "Acme (copy)" },
      }),
    ]);
    const all = [...history, duplicate];
    expect(ids(mergedRecordHistory(all, RECORD))).toEqual(["crq_C", "crq_B", "crq_A"]);
    // Not part of the undone set — so this stays an update, not a delete.
    const result = plan({ history: all, toBeforeChangeRequestId: C.id, currentFields: afterC });
    expect(result.action).toBe("update");
    expect(ids(result.undone)).toEqual(["crq_C"]);
    expect(result.fields).toEqual({ notes: "first call" });
    // And it cannot itself be the target.
    expectRefusal(
      () => plan({ history: all, toBeforeChangeRequestId: duplicate.id, currentFields: afterC }),
      "target_not_found",
    );
  });

  it("skips this record's operations that did not land (failed / pending)", () => {
    const { A, B, C } = chain();
    const failed = cr("crq_failed", 4, [
      op("record_update", { before: afterC, after: { notes: "never landed" }, status: "failed" }),
    ]);
    const history = [A, B, C, failed];
    expect(ids(mergedRecordHistory(history, RECORD))).toEqual(["crq_C", "crq_B", "crq_A"]);
    const result = plan({ history, toBeforeChangeRequestId: B.id, currentFields: afterC });
    expect(ids(result.undone)).toEqual(["crq_C", "crq_B"]);
  });

  it("refuses an operation kind it cannot invert", () => {
    const { A } = chain();
    const odd = cr("crq_odd", 2, [
      op("view_update" as OperationKind, { before: {}, after: { name: "x" } }),
    ]);
    expectRefusal(
      () => plan({ history: [A, odd], toBeforeChangeRequestId: odd.id, currentFields: afterA }),
      "unsupported_operation",
    );
  });
});

describe("planRecordRevert — target validation", () => {
  it.each(["in_review", "changes_requested", "approved", "rejected", "abandoned"] as const)(
    "refuses a %s target (target_not_merged)",
    (status) => {
      const { history } = chain();
      const unmerged = cr(
        "crq_unmerged",
        4,
        [op("record_update", { before: afterC, after: { stage: "lost" }, status: "pending" })],
        { status },
      );
      expectRefusal(
        () =>
          plan({
            history: [...history, unmerged],
            toBeforeChangeRequestId: unmerged.id,
            currentFields: afterC,
          }),
        "target_not_merged",
      );
    },
  );

  it("refuses an id outside the record's history (target_not_found)", () => {
    const { history } = chain();
    expectRefusal(
      () => plan({ history, toBeforeChangeRequestId: "crq_nope", currentFields: afterC }),
      "target_not_found",
    );
  });

  it("refuses a merged change request that only changed a different record", () => {
    const { history } = chain();
    const elsewhere = cr("crq_elsewhere", 4, [updateOp({ stage: "a" }, { stage: "b" }, OTHER)]);
    expectRefusal(
      () =>
        plan({
          history: [...history, elsewhere],
          toBeforeChangeRequestId: elsewhere.id,
          currentFields: afterC,
        }),
      "target_not_found",
    );
  });

  it("findUndoneChangeRequests returns the target and everything newer, newest first", () => {
    const { history } = chain();
    expect(ids(findUndoneChangeRequests(history, RECORD, "crq_A"))).toEqual([
      "crq_C",
      "crq_B",
      "crq_A",
    ]);
    expect(ids(findUndoneChangeRequests(history, RECORD, "crq_C"))).toEqual(["crq_C"]);
  });
});

describe("planRecordRevert — schema changes since", () => {
  it("refuses when a field to restore was deleted since, naming it", () => {
    const { B, history } = chain();
    expectRefusal(
      () =>
        plan({
          history,
          toBeforeChangeRequestId: B.id,
          currentFields: afterC,
          fieldDefs: fieldDefs.filter((def) => def.slug !== "amount"),
          schemaChanges: {
            deleted: new Map([["amount", { slug: "amount", type: "number" }]]),
            converted: new Set(),
          },
        }),
      "field_deleted",
      "amount",
    );
  });

  it("refuses when a field to restore is simply gone from the Base", () => {
    const { C, history } = chain();
    expectRefusal(
      () =>
        plan({
          history,
          toBeforeChangeRequestId: C.id,
          currentFields: afterC,
          fieldDefs: fieldDefs.filter((def) => def.slug !== "notes"),
        }),
      "field_deleted",
      "notes",
    );
  });

  it("refuses when a field was deleted and re-created under the same slug", () => {
    const { C, history } = chain();
    expectRefusal(
      () =>
        plan({
          history,
          toBeforeChangeRequestId: C.id,
          currentFields: afterC,
          schemaChanges: {
            deleted: new Map([["notes", { slug: "notes", type: "longtext" }]]),
            converted: new Set(),
          },
        }),
      "field_deleted",
      "notes",
    );
  });

  it.each([
    ["formula", { slug: "total", type: "formula" }],
    ["updated_time", { slug: "total", type: "updated_time" }],
  ] as const)("skips a deleted read-only field (%s) instead of refusing", (_label, deletedDef) => {
    const before = { ...afterA, total: 1 };
    const B = cr("crq_B", 2, [updateOp(before, { stage: "won", total: 2 })]);
    const result = plan({
      history: [cr("crq_A", 1, [createOp(before)]), B],
      toBeforeChangeRequestId: B.id,
      currentFields: { ...before, stage: "won", total: 2 },
      schemaChanges: {
        deleted: new Map([["total", deletedDef as RevertFieldDef]]),
        converted: new Set(),
      },
    });
    expect(result.action).toBe("update");
    expect(result.fields).toEqual({ stage: "lead" });
  });

  it("refuses when a field to restore was converted to another type since, naming it", () => {
    const { B, history } = chain();
    expectRefusal(
      () =>
        plan({
          history,
          toBeforeChangeRequestId: B.id,
          currentFields: afterC,
          schemaChanges: { deleted: new Map(), converted: new Set(["stage"]) },
        }),
      "field_type_changed",
      "stage",
    );
  });

  it("skips a field converted into a computed type since — the merge recomputes it anyway", () => {
    const { B, history } = chain();
    const result = plan({
      history,
      toBeforeChangeRequestId: B.id,
      currentFields: afterC,
      fieldDefs: fieldDefs.map((def) =>
        def.slug === "stage" ? { slug: "stage", type: "formula" as const } : def,
      ),
      schemaChanges: { deleted: new Map(), converted: new Set(["stage"]) },
    });
    expect(result.fields).toEqual({ amount: 100, notes: "first call" });
  });

  it("a deleted or converted field the revert does not touch is irrelevant", () => {
    const { C, history } = chain();
    const result = plan({
      history,
      toBeforeChangeRequestId: C.id,
      currentFields: afterC,
      fieldDefs: fieldDefs.filter((def) => def.slug !== "owner"),
      schemaChanges: {
        deleted: new Map([["owner", { slug: "owner", type: "text" }]]),
        converted: new Set(["stage"]),
      },
    });
    expect(result.fields).toEqual({ notes: "first call" });
  });
});

describe("planRecordRevert — what is written back", () => {
  const computedBefore = {
    ...afterA,
    updated: "2026-11-01T09:01:00.000Z",
    score: 10,
    deals: [],
  };

  it("never writes read-only columns (system, formula, reverse relation)", () => {
    const B = cr("crq_B", 2, [
      updateOp(computedBefore, {
        stage: "won",
        updated: "2026-11-01T09:02:00.000Z",
        score: 42,
        deals: ["rec_x"],
      }),
    ]);
    const result = plan({
      history: [cr("crq_A", 1, [createOp(computedBefore)]), B],
      toBeforeChangeRequestId: B.id,
      currentFields: {
        ...computedBefore,
        stage: "won",
        updated: "2026-11-01T09:02:00.000Z",
        score: 42,
        deals: ["rec_x"],
      },
    });
    expect(result.fields).toEqual({ stage: "lead" });
    expect(result.fieldChanges.map((change) => change.slug)).toEqual(["stage"]);
  });

  it("is nothing_to_revert when only read-only columns changed", () => {
    const B = cr("crq_B", 2, [
      updateOp(computedBefore, { updated: "2026-11-01T09:02:00.000Z", score: 42 }),
    ]);
    expectRefusal(
      () =>
        plan({
          history: [cr("crq_A", 1, [createOp(computedBefore)]), B],
          toBeforeChangeRequestId: B.id,
          currentFields: { ...computedBefore, updated: "2026-11-01T09:02:00.000Z", score: 42 },
        }),
      "nothing_to_revert",
    );
  });

  it("does not write a field that is already at its earlier value", () => {
    // B: stage lead → won. C: stage won → lead (by hand) and amount 100 → 200.
    const B = cr("crq_B", 2, [updateOp(afterA, { stage: "won" })]);
    const C = cr("crq_C", 3, [
      updateOp({ ...afterA, stage: "won" }, { stage: "lead", amount: 200 }),
    ]);
    const result = plan({
      history: [cr("crq_A", 1, [createOp(afterA)]), B, C],
      toBeforeChangeRequestId: B.id,
      currentFields: { ...afterA, amount: 200 },
    });
    expect(result.fields).toEqual({ amount: 100 });
    expect(result.fieldChanges).toEqual([{ slug: "amount", beforeValue: 200, afterValue: 100 }]);
  });

  it("is nothing_to_revert when every field is already at its earlier value", () => {
    const B = cr("crq_B", 2, [updateOp(afterA, { stage: "won" })]);
    const C = cr("crq_C", 3, [updateOp({ ...afterA, stage: "won" }, { stage: "lead" })]);
    expectRefusal(
      () =>
        plan({
          history: [cr("crq_A", 1, [createOp(afterA)]), B, C],
          toBeforeChangeRequestId: B.id,
          currentFields: afterA,
        }),
      "nothing_to_revert",
    );
  });

  it("compares structurally: object key order and missing-vs-null do not count as a change", () => {
    const before = { ...afterA, meta: { a: 1, b: 2 } };
    const B = cr("crq_B", 2, [updateOp(before, { meta: { a: 9 }, owner: "bo" })]);
    expectRefusal(
      () =>
        plan({
          history: [cr("crq_A", 1, [createOp(before)]), B],
          toBeforeChangeRequestId: B.id,
          // meta is back (different key order) and owner is absent ≙ null.
          currentFields: { ...afterA, meta: { b: 2, a: 1 } },
        }),
      "nothing_to_revert",
    );
  });
});

describe("planRecordRevert — pending change requests", () => {
  it("returns unmerged change requests touching the record without letting them affect fields", () => {
    const { B, history } = chain();
    const pendingOld = cr(
      "crq_pending_old",
      5,
      [op("record_update", { before: afterC, after: { stage: "lost" }, status: "pending" })],
      { status: "in_review" },
    );
    const pendingNew = cr(
      "crq_pending_new",
      7,
      [op("record_update", { before: afterC, after: { amount: 1 }, status: "pending" })],
      { status: "changes_requested" },
    );
    const otherRecord = cr(
      "crq_pending_other",
      8,
      [
        op("record_update", {
          recordId: OTHER,
          before: {},
          after: { stage: "x" },
          status: "pending",
        }),
      ],
      { status: "in_review" },
    );
    const rejected = cr(
      "crq_rejected",
      6,
      [op("record_update", { before: afterC, after: { notes: "no" }, status: "pending" })],
      { status: "rejected" },
    );
    const result = plan({
      history: [pendingOld, ...history, otherRecord, rejected, pendingNew],
      toBeforeChangeRequestId: B.id,
      currentFields: afterC,
    });
    expect(ids(result.pending)).toEqual(["crq_pending_new", "crq_pending_old"]);
    expect(ids(result.undone)).toEqual(["crq_C", "crq_B"]);
    expect(result.fields).toEqual({ stage: "lead", amount: 100, notes: "first call" });
  });
});

describe("describeRevertTarget", () => {
  it("uses this record's operation message, falling back to the change request id", () => {
    const named = cr("crq_named", 1, [
      op("record_update", { recordId: OTHER, message: "Other record" }),
      op("record_update", { message: "  Mark Acme won  " }),
    ]);
    expect(describeRevertTarget(named, RECORD)).toBe("Mark Acme won");
    const unnamed = cr("crq_unnamed", 1, [op("record_update", { message: "   " })]);
    expect(describeRevertTarget(unnamed, RECORD)).toBe("crq_unnamed");
  });
});
