import "server-only";

import { createHash } from "node:crypto";
import { ORPCError } from "@orpc/server";
import type { revertRecordInputSchema } from "busabase-contract/domains/base/contract/record-schemas";
import type { ChangeRequestVO, RecordRevertPreviewVO } from "busabase-contract/types";
import { and, eq, gte, inArray } from "drizzle-orm";
import { iStringParse } from "openlib/i18n/i-string";
import type { z } from "zod";
import { getContextSpaceId, resolveActorId } from "../../../context";
import { getDb } from "../../../db";
import {
  busabaseBaseFields,
  busabaseCommits,
  busabaseOperations,
  busabaseRecords,
} from "../../../db/schema";
import { getChangeRequest, listRecordChangeRequests } from "../../../logic/cr-lifecycle";
import { assertBaseChangeRequestPermission, hasNodePermission } from "../../../logic/node-acl";
import { ensureReady } from "../../../logic/seed";
import { stableStringify } from "../../dashboard/helpers/operation-diff";
import {
  describeRevertTarget,
  findUndoneChangeRequests,
  isRecordCreation,
  planRecordRevert,
  type RecordRevertPlan,
  RecordRevertPlanError,
  type RevertFieldDef,
  type RevertSchemaChanges,
  recordOperationsOf,
} from "../utils/record-revert-plan";
import { baseNotFound } from "./errors";
import { getBase } from "./queries";
import {
  createDeleteChangeRequest,
  createRestoreChangeRequest,
  createUpdateChangeRequest,
  type RecordChangeRequestTag,
} from "./record-ops";

// ============================================================================
// One-click record revert: one core builder, two front doors.
//
// `buildRevertChangeRequest` turns "revert this record to before change
// request X" into a ready-to-submit change request payload. Both entry points
// reach it through `records.changeRequest` `operation: "revert"` — the
// dashboard's History panel and agents (MCP / REST / SDK) alike — and
// `records.revertPreview` shows the same payload without submitting it.
//
// Submission goes through the ordinary record creators in `./record-ops.ts`, so
// a revert is a normal change request: same author attribution, same
// permission-aware review gate, visible in `records.listChangeRequests`, and
// revertible itself. It never writes record values or history directly.
// ============================================================================

/** `sourceMeta.subject` of a revert change request. */
export const RECORD_REVERT_SUBJECT = "record_revert";

export interface RecordRevertSourceMeta {
  recordId: string;
  toBeforeChangeRequestId: string;
  /** Newest first. */
  undoneChangeRequestIds: string[];
}

export interface RecordRevertPayload {
  recordId: string;
  baseId: string;
  baseNodeId: string;
  /** The record head the plan was computed against; pins the update's base commit. */
  headCommitId: string;
  currentFields: Record<string, unknown>;
  plan: RecordRevertPlan;
  /**
   * Identifies this exact plan. The preview hands it out; a submit that sends
   * it back is refused (409 `plan_changed`) once the record or its history has
   * moved, so what lands is what the person confirmed.
   */
  planFingerprint: string;
  message: string;
  tag: RecordChangeRequestTag;
}

/**
 * 404 for a change request outside the record's history, 409 otherwise. A
 * field-specific refusal carries the field's display name too — a deleted field
 * is no longer in the Base the caller holds, so it could not look the name up.
 */
const toOrpcError = (error: RecordRevertPlanError, fieldNames: ReadonlyMap<string, string>) => {
  const fieldName = error.fieldSlug ? fieldNames.get(error.fieldSlug) : undefined;
  const named = fieldName && fieldName !== error.fieldSlug;
  return new ORPCError(error.reason === "target_not_found" ? "NOT_FOUND" : "CONFLICT", {
    message: named
      ? error.message.replace(`"${error.fieldSlug}"`, `"${fieldName}" (${error.fieldSlug})`)
      : error.message,
    data: {
      reason: error.reason,
      ...(error.fieldSlug ? { fieldSlug: error.fieldSlug } : {}),
      ...(named ? { fieldName } : {}),
    },
  });
};

const loadRecord = async (recordId: string) => {
  const db = await getDb();
  const [record] = await db
    .select()
    .from(busabaseRecords)
    .where(and(eq(busabaseRecords.id, recordId), eq(busabaseRecords.spaceId, getContextSpaceId())))
    .limit(1);
  if (!record) {
    throw new ORPCError("NOT_FOUND", { message: `Record not found: ${recordId}` });
  }
  return record;
};

/**
 * Field deletions and type conversions on the Base since `since`. A field's
 * stored before-values predate them, so the planner refuses to write those back.
 */
const loadSchemaChangesSince = async (
  baseId: string,
  since: Date,
): Promise<{ schemaChanges: RevertSchemaChanges; fieldNames: Map<string, string> }> => {
  const db = await getDb();
  const fieldRows = await db
    .select({
      id: busabaseBaseFields.id,
      slug: busabaseBaseFields.slug,
      name: busabaseBaseFields.name,
      type: busabaseBaseFields.type,
      options: busabaseBaseFields.options,
      deletedAt: busabaseBaseFields.deletedAt,
    })
    .from(busabaseBaseFields)
    .where(eq(busabaseBaseFields.baseId, baseId));
  const deleted = new Map<string, RevertFieldDef>();
  const fieldNames = new Map<string, string>();
  for (const row of fieldRows) {
    if (row.deletedAt && row.deletedAt >= since) deleted.set(row.slug, row);
    // A live field's name wins over a deleted one that shared its slug.
    if (!row.deletedAt || !fieldNames.has(row.slug))
      fieldNames.set(row.slug, iStringParse(row.name));
  }
  const conversions = await db
    .select({ payload: busabaseCommits.payload })
    .from(busabaseOperations)
    .innerJoin(busabaseCommits, eq(busabaseCommits.id, busabaseOperations.headCommitId))
    .where(
      and(
        eq(busabaseOperations.baseId, baseId),
        eq(busabaseOperations.operation, "base_convert_field"),
        inArray(busabaseOperations.status, ["merged", "archived"]),
        gte(busabaseOperations.updatedAt, since),
      ),
    );
  const convertedFieldIds = new Set(
    conversions
      .map((row) => row.payload.fieldId)
      .filter((id): id is string => typeof id === "string"),
  );
  const converted = new Set(
    fieldRows
      .filter((row) => row.deletedAt === null && convertedFieldIds.has(row.id))
      .map((row) => row.slug),
  );
  return { schemaChanges: { deleted, converted }, fieldNames };
};

const planFingerprintOf = (
  record: { id: string; headCommitId: string; status: string },
  plan: RecordRevertPlan,
) =>
  createHash("sha256")
    .update(
      stableStringify({
        recordId: record.id,
        headCommitId: record.headCommitId,
        status: record.status,
        action: plan.action,
        undone: plan.undone.map((changeRequest) => changeRequest.id),
        fields: plan.fields,
      }),
    )
    .digest("hex")
    .slice(0, 32);

const toSourceMeta = (
  recordId: string,
  toBeforeChangeRequestId: string,
  plan: RecordRevertPlan,
) => {
  const revert: RecordRevertSourceMeta = {
    recordId,
    toBeforeChangeRequestId,
    undoneChangeRequestIds: plan.undone.map((changeRequest) => changeRequest.id),
  };
  return { subject: RECORD_REVERT_SUBJECT, revert };
};

/**
 * The shared revert core: everything needed to submit "revert record to
 * before change request X" as one change request, without submitting it.
 * Requires read access on the record; throws 404 for an unknown record or a
 * change request outside its history, and 409 (naming the field, where there is
 * one) for a revert that is not possible.
 */
export const buildRevertChangeRequest = async (
  recordId: string,
  toBeforeChangeRequestId: string,
): Promise<RecordRevertPayload> => {
  await ensureReady();
  const db = await getDb();
  const record = await loadRecord(recordId);
  const base = await getBase(record.baseId);
  if (!base) throw baseNotFound(record.baseId);
  // Gated on read inside (NOT_FOUND / FORBIDDEN) and visibility-filtered.
  // Hydration reports what each merged update actually landed as — for a
  // three-way auto-merge, its landed commit against that commit's parent, not
  // the proposal (`loadLandedRecordChanges` in cr-lifecycle) — so the planner
  // inverts real changes without re-deriving them here.
  const history = await listRecordChangeRequests(recordId, { recordOperationsOnly: true });
  const [headCommit] = await db
    .select({ payload: busabaseCommits.payload })
    .from(busabaseCommits)
    .where(eq(busabaseCommits.id, record.headCommitId))
    .limit(1);
  const currentFields = headCommit?.payload ?? {};

  let fieldNames: ReadonlyMap<string, string> = new Map();
  try {
    const undone = findUndoneChangeRequests(history, recordId, toBeforeChangeRequestId);
    // The oldest moment any undone change was authored: their stored
    // before-values may predate a schema change made while one sat in review.
    const since = new Date(
      Math.min(...undone.map((changeRequest) => Date.parse(changeRequest.createdAt))),
    );
    const schema = await loadSchemaChangesSince(base.id, since);
    fieldNames = schema.fieldNames;
    const plan = planRecordRevert({
      recordId,
      recordStatus: record.status,
      currentFields,
      history,
      toBeforeChangeRequestId,
      fieldDefs: base.fields,
      schemaChanges: schema.schemaChanges,
    });
    const target = undone[undone.length - 1] as ChangeRequestVO;
    const isCreation = isRecordCreation(target, recordId);
    const later = isCreation ? plan.undone.length : plan.undone.length - 1;
    const message = `Revert to ${isCreation ? "after" : "before"} "${describeRevertTarget(target, recordId)}"${
      later > 0 ? ` (and ${later} later change${later === 1 ? "" : "s"})` : ""
    }`;
    const sourceMeta = toSourceMeta(recordId, toBeforeChangeRequestId, plan);
    return {
      recordId,
      baseId: base.id,
      baseNodeId: base.nodeId,
      headCommitId: record.headCommitId,
      currentFields,
      plan,
      planFingerprint: planFingerprintOf(record, plan),
      message,
      tag: {
        sourceMeta,
        auditMetadata: {
          operation: RECORD_REVERT_SUBJECT,
          revertAction: plan.action,
          ...sourceMeta.revert,
        },
      },
    };
  } catch (error) {
    if (error instanceof RecordRevertPlanError) throw toOrpcError(error, fieldNames);
    throw error;
  }
};

const toChangeRequestSummary = (changeRequest: ChangeRequestVO, recordId: string) => {
  const operations = recordOperationsOf(changeRequest, recordId);
  return {
    id: changeRequest.id,
    status: changeRequest.status,
    submittedBy: changeRequest.submittedBy,
    submittedByUser: changeRequest.submittedByUser ?? null,
    message: operations[0]?.headCommit.message ?? "",
    operations: operations.map((operation) => operation.operation),
    createdAt: changeRequest.createdAt,
    mergedAt: changeRequest.mergedAt,
  };
};

/** `records.revertPreview` — the built payload, as the caller will see it land. */
export const previewRecordRevert = async (
  recordId: string,
  toBeforeChangeRequestId: string,
): Promise<RecordRevertPreviewVO> => {
  const built = await buildRevertChangeRequest(recordId, toBeforeChangeRequestId);
  const actorId = resolveActorId("local-editor");
  const [viewerCanRevert, willAutoMerge] = await Promise.all([
    hasNodePermission(built.baseNodeId, "changeRequest", actorId),
    hasNodePermission(built.baseNodeId, "write", actorId),
  ]);
  return {
    recordId,
    baseId: built.baseId,
    toBeforeChangeRequestId,
    action: built.plan.action,
    undoneChangeRequests: built.plan.undone.map((changeRequest) =>
      toChangeRequestSummary(changeRequest, recordId),
    ),
    currentFields: built.currentFields,
    fields: built.plan.fields,
    fieldChanges: built.plan.fieldChanges,
    pendingChangeRequests: built.plan.pending.map((changeRequest) =>
      toChangeRequestSummary(changeRequest, recordId),
    ),
    viewerCanRevert,
    willAutoMerge,
    planFingerprint: built.planFingerprint,
  };
};

const isPendingRevertOf = (
  changeRequest: ChangeRequestVO,
  toBeforeChangeRequestId: string,
  submittedBy: string,
) => {
  const revert = changeRequest.sourceMeta.revert as Partial<RecordRevertSourceMeta> | undefined;
  return (
    changeRequest.sourceMeta.subject === RECORD_REVERT_SUBJECT &&
    revert?.toBeforeChangeRequestId === toBeforeChangeRequestId &&
    changeRequest.submittedBy === submittedBy
  );
};

/**
 * `records.changeRequest` `operation: "revert"`. Requires the same access as
 * editing the record; lands immediately with write access (unless
 * `autoMerge: false`), otherwise waits for review like any other change.
 */
export const createRevertChangeRequest = async (
  recordId: string,
  input: z.infer<typeof revertRecordInputSchema>,
) => {
  const submittedBy = resolveActorId(input.submittedBy);
  const record = await loadRecord(recordId);
  await assertBaseChangeRequestPermission(record.baseId, submittedBy);
  const built = await buildRevertChangeRequest(recordId, input.toBeforeChangeRequestId);
  if (input.expectedPlanFingerprint && input.expectedPlanFingerprint !== built.planFingerprint) {
    // Someone changed the record (or its history) after the preview: the plan
    // now would undo something the person never saw. Nothing is written.
    throw new ORPCError("CONFLICT", {
      message:
        "The record changed after this revert was previewed, so nothing was submitted. Preview it again and confirm the new plan.",
      data: { reason: "plan_changed", planFingerprint: built.planFingerprint },
    });
  }

  // A retried submit while the first is still waiting for review returns that
  // change request instead of queuing a duplicate. (Once one has merged, the
  // record no longer differs from its earlier state, so a retry is a 409
  // `nothing_to_revert` rather than a second revert.)
  const waiting = built.plan.pending.find((changeRequest) =>
    isPendingRevertOf(changeRequest, input.toBeforeChangeRequestId, submittedBy),
  );
  if (waiting) {
    const changeRequest = await getChangeRequest(waiting.id);
    if (changeRequest) return { ...changeRequest, materialized: false as const };
  }

  const message = input.message ?? built.message;
  switch (built.plan.action) {
    case "update":
      return createUpdateChangeRequest(
        recordId,
        {
          fields: built.plan.fields,
          message,
          author: input.submittedBy,
          autoMerge: input.autoMerge,
          // The state the plan was computed from; a concurrent edit is then
          // reconciled by the ordinary three-way merge.
          baseCommitId: built.headCommitId,
        },
        built.tag,
      );
    case "delete":
      return createDeleteChangeRequest(
        recordId,
        {
          message,
          submittedBy: input.submittedBy,
          deleteMode: "archive",
          autoMerge: input.autoMerge,
        },
        built.tag,
      );
    case "restore":
      return createRestoreChangeRequest(
        recordId,
        input.submittedBy,
        message,
        input.autoMerge,
        built.tag,
      );
  }
};
