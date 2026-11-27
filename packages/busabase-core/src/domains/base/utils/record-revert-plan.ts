import type { ChangeRequestVO, FieldType, OperationVO } from "busabase-contract/types";
import { extractOperationFieldChanges, valuesEqual } from "../../dashboard/helpers/operation-diff";
import { isReadOnlyFieldDef } from "../field-types";

// ============================================================================
// Record revert, as a pure function of the record's Change Request history.
//
// Reverting to before X undoes X and every later merged Change Request, except
// that a creation target is retained and the result is its state after creation.
// Changes are inverted newest first:
//   record_update / record_delete → set each changed field back to its stored
//                                   before-value (the same extraction the review
//                                   diff renders, `extractOperationFieldChanges`)
//   record_create                 → keep the initial state; undo later changes
//   record_restore                → it was in the Trash
// Walking newest → oldest means the OLDEST undone change's before-value wins for
// a field several of them touched — the value at the selected boundary.
//
// The server half (`logic/record-revert.ts`) loads the history and schema
// changes, then submits the result as one ordinary Change Request.
// ============================================================================

export type RecordRevertAction = "update" | "delete" | "restore";

export type RecordRevertPlanErrorReason =
  | "target_not_found"
  | "target_not_merged"
  | "record_in_trash"
  | "restore_then_edit"
  | "delete_with_field_changes"
  | "unsupported_operation"
  | "field_deleted"
  | "field_type_changed"
  | "nothing_to_revert";

/** Maps to a 404 for `target_not_found` and a 409 for every other reason. */
export class RecordRevertPlanError extends Error {
  readonly reason: RecordRevertPlanErrorReason;
  readonly fieldSlug?: string;

  constructor(reason: RecordRevertPlanErrorReason, message: string, fieldSlug?: string) {
    super(message);
    this.name = "RecordRevertPlanError";
    this.reason = reason;
    this.fieldSlug = fieldSlug;
  }
}

export interface RevertFieldDef {
  slug: string;
  type: FieldType;
  options?: { reverseOfFieldId?: unknown } | null;
}

/**
 * Field-schema changes since the oldest undone Change Request was created. Its
 * stored before-values are in the field's OLD shape, so writing them back into a
 * deleted or converted field would be a silent coercion — refused instead.
 */
export interface RevertSchemaChanges {
  /** Slugs of fields deleted since (or deleted and re-created under the same slug). */
  deleted: ReadonlyMap<string, RevertFieldDef>;
  /** Slugs of live fields converted to another type since. */
  converted: ReadonlySet<string>;
}

export interface RecordRevertPlanInput {
  recordId: string;
  recordStatus: string;
  currentFields: Record<string, unknown>;
  /** Change Requests touching the record, any status, any order. */
  history: ReadonlyArray<ChangeRequestVO>;
  toBeforeChangeRequestId: string;
  /** The Base's live fields. */
  fieldDefs: ReadonlyArray<RevertFieldDef>;
  schemaChanges: RevertSchemaChanges;
}

export interface RecordRevertFieldChange {
  slug: string;
  beforeValue: unknown;
  afterValue: unknown;
}

export interface RecordRevertPlan {
  action: RecordRevertAction;
  /** Newest first; includes the target unless it is the retained creation. */
  undone: ChangeRequestVO[];
  /** Unmerged Change Requests touching the record — unaffected by the revert. */
  pending: ChangeRequestVO[];
  /** Field values the revert writes (`update` only). */
  fields: Record<string, unknown>;
  /** Current → reverted value for each field in `fields`. */
  fieldChanges: RecordRevertFieldChange[];
}

const PENDING_STATUSES: ReadonlySet<string> = new Set([
  "in_review",
  "changes_requested",
  "approved",
  "conflict",
]);

const LANDED_OPERATION_STATUSES: ReadonlySet<string> = new Set(["merged", "archived"]);

/**
 * The operations of a Change Request that changed THIS record. An operation
 * that only names it as `sourceRecordId` created a different record from it.
 */
export const recordOperationsOf = (changeRequest: ChangeRequestVO, recordId: string) =>
  changeRequest.operations.filter(
    (operation) => operation.targetRecordId === recordId || operation.mergedRecordId === recordId,
  );

const landedRecordOperations = (changeRequest: ChangeRequestVO, recordId: string) =>
  recordOperationsOf(changeRequest, recordId).filter((operation) =>
    LANDED_OPERATION_STATUSES.has(operation.status),
  );

/** True only for a creation that actually landed on this record. */
export const isRecordCreation = (changeRequest: ChangeRequestVO, recordId: string) =>
  changeRequest.status === "merged" &&
  landedRecordOperations(changeRequest, recordId).some(
    (operation) => operation.operation === "record_create",
  );

const mergedOrder = (left: ChangeRequestVO, right: ChangeRequestVO) =>
  (right.mergedAt ?? "").localeCompare(left.mergedAt ?? "") ||
  right.createdAt.localeCompare(left.createdAt) ||
  right.id.localeCompare(left.id);

/** Merged Change Requests that changed the record, newest first. */
export const mergedRecordHistory = (
  history: ReadonlyArray<ChangeRequestVO>,
  recordId: string,
): ChangeRequestVO[] =>
  history
    .filter(
      (changeRequest) =>
        changeRequest.status === "merged" &&
        landedRecordOperations(changeRequest, recordId).length > 0,
    )
    .sort(mergedOrder);

/**
 * Candidate merged Change Requests, newest first with the target last. The
 * planner retains a creation target as the boundary and excludes it from undo.
 * Throws when the target is not a merged change of this record.
 */
export const findUndoneChangeRequests = (
  history: ReadonlyArray<ChangeRequestVO>,
  recordId: string,
  toBeforeChangeRequestId: string,
): ChangeRequestVO[] => {
  const merged = mergedRecordHistory(history, recordId);
  const targetIndex = merged.findIndex(
    (changeRequest) => changeRequest.id === toBeforeChangeRequestId,
  );
  if (targetIndex >= 0) return merged.slice(0, targetIndex + 1);
  const unmerged = history.find((changeRequest) => changeRequest.id === toBeforeChangeRequestId);
  if (unmerged && recordOperationsOf(unmerged, recordId).length > 0) {
    throw new RecordRevertPlanError(
      "target_not_merged",
      unmerged.status === "merged"
        ? `Change request ${toBeforeChangeRequestId} did not land on this record — only changes that landed can be reverted.`
        : `Change request ${toBeforeChangeRequestId} is ${unmerged.status}, not merged — only changes that landed can be reverted.`,
    );
  }
  throw new RecordRevertPlanError(
    "target_not_found",
    `Change request ${toBeforeChangeRequestId} is not in the history of record ${recordId}.`,
  );
};

type LifecycleState = "active" | "archived";

const invertFieldChanges = (operation: OperationVO, into: Map<string, unknown>) => {
  for (const change of extractOperationFieldChanges(operation)) {
    // A field with no prior value goes back to having none.
    into.set(change.slug, change.status === "added" ? null : change.beforeValue);
  }
};

export const planRecordRevert = (input: RecordRevertPlanInput): RecordRevertPlan => {
  const { recordId } = input;
  const candidates = findUndoneChangeRequests(
    input.history,
    recordId,
    input.toBeforeChangeRequestId,
  );
  const target = candidates[candidates.length - 1];
  // A creation marks the first existing state of a record. Keep it and undo
  // only the later changes, so selecting it restores that initial state.
  const createsRecord = isRecordCreation(target, recordId);
  const undone = createsRecord ? candidates.slice(0, -1) : candidates;
  const pending = input.history
    .filter(
      (changeRequest) =>
        PENDING_STATUSES.has(changeRequest.status) &&
        recordOperationsOf(changeRequest, recordId).length > 0,
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

  // Newest → oldest; inside one Change Request, last operation first.
  const revertValues = new Map<string, unknown>();
  let stateBefore: LifecycleState = "active";
  for (const changeRequest of undone) {
    for (const operation of landedRecordOperations(changeRequest, recordId).reverse()) {
      switch (operation.operation) {
        case "record_update":
        case "record_delete":
          invertFieldChanges(operation, revertValues);
          stateBefore = "active";
          break;
        case "record_restore":
          stateBefore = "archived";
          break;
        default:
          throw new RecordRevertPlanError(
            "unsupported_operation",
            `Change request ${changeRequest.id} contains a ${operation.operation} operation on this record, which cannot be reverted.`,
          );
      }
    }
  }

  const empty = { fields: {}, fieldChanges: [] };
  if (input.recordStatus === "archived") {
    // From the Trash, the only supported revert is undoing the delete that
    // put it there — which must then be the latest change to the record.
    const latest = undone.length === 1 ? landedRecordOperations(undone[0], recordId) : [];
    const isTheDelete =
      latest.length > 0 && latest.every((operation) => operation.operation === "record_delete");
    if (!isTheDelete) {
      throw new RecordRevertPlanError(
        "record_in_trash",
        "This record is in the Trash. Restore it first, or revert to before the change that deleted it.",
      );
    }
    // Today's delete path stores the record's fields unchanged, so this never
    // fires; if a deletion ever carries edits, refuse rather than drop them.
    if (resolveFieldChanges(revertValues, input, false).length > 0) {
      throw new RecordRevertPlanError(
        "delete_with_field_changes",
        "The deletion also changed field values, which a revert cannot re-apply yet. Restore the record from the Trash instead.",
      );
    }
    return { action: "restore", undone, pending, ...empty };
  }

  if (stateBefore === "archived") {
    // Back to the Trash. Edits made after the restore would ride along into the
    // Trash unreverted, so they have to be reverted first.
    if (resolveFieldChanges(revertValues, input, false).length > 0) {
      throw new RecordRevertPlanError(
        "restore_then_edit",
        "The record was edited after it was restored. Revert to before those edits first, then to before the restore.",
      );
    }
    return { action: "delete", undone, pending, ...empty };
  }

  const fieldChanges = resolveFieldChanges(revertValues, input, true);
  if (fieldChanges.length === 0) {
    throw new RecordRevertPlanError(
      "nothing_to_revert",
      "The record already matches its state before this change — there is nothing to revert.",
    );
  }
  const fields = Object.fromEntries(fieldChanges.map((change) => [change.slug, change.afterValue]));
  return { action: "update", undone, pending, fields, fieldChanges };
};

/**
 * The writable fields whose reverted value differs from the current one.
 * `strict`: a field deleted or converted since is an error naming it (the
 * `update` path). Otherwise such fields are only skipped — the lifecycle
 * branches use this to ask "would anything be left unreverted?".
 */
const resolveFieldChanges = (
  revertValues: ReadonlyMap<string, unknown>,
  input: RecordRevertPlanInput,
  strict: boolean,
): RecordRevertFieldChange[] => {
  const liveDefs = new Map(input.fieldDefs.map((def) => [def.slug, def]));
  const changes: RecordRevertFieldChange[] = [];
  for (const [slug, value] of revertValues) {
    const def = liveDefs.get(slug);
    const deleted = input.schemaChanges.deleted.get(slug);
    if (!def || deleted) {
      // A computed column that has since gone needs nothing written back.
      if (!strict || (deleted && isReadOnlyFieldDef(deleted))) continue;
      throw new RecordRevertPlanError(
        "field_deleted",
        `Field "${slug}" was deleted after these changes, so its earlier value cannot be restored. Nothing was changed.`,
        slug,
      );
    }
    // System, formula, lookup and reverse-relation columns are recomputed by
    // the merge; writing them would be ignored (or, for a reverse relation,
    // edit a DIFFERENT record). That holds for one converted INTO such a type
    // too, so this is checked before the conversion refusal below.
    if (isReadOnlyFieldDef(def)) continue;
    if (input.schemaChanges.converted.has(slug)) {
      if (!strict) continue;
      throw new RecordRevertPlanError(
        "field_type_changed",
        `Field "${slug}" was converted to another type after these changes, so its earlier value no longer fits. Nothing was changed.`,
        slug,
      );
    }
    const current = input.currentFields[slug] ?? null;
    const next = value ?? null;
    if (valuesEqual(current, next)) continue;
    changes.push({ slug, beforeValue: current, afterValue: next });
  }
  return changes;
};

/** One line describing the target, for the revert's default commit message. */
export const describeRevertTarget = (changeRequest: ChangeRequestVO, recordId: string): string =>
  recordOperationsOf(changeRequest, recordId)[0]?.headCommit.message?.trim() || changeRequest.id;
