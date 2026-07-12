import "server-only";

import { ORPCError } from "@orpc/server";
import {
  convertFieldChangeRequestInputSchema,
  createFieldChangeRequestInputSchema,
  deleteFieldChangeRequestInputSchema,
  previewFieldConversionInputSchema,
  reorderFieldsChangeRequestInputSchema,
  restoreFieldChangeRequestInputSchema,
  updateFieldChangeRequestInputSchema,
} from "busabase-contract/domains/base/contract/base-schemas";
import type { FieldType } from "busabase-contract/types";
import { and, asc, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import { type iString, iStringFromText, iStringToText } from "openlib/i18n/i-string";
import type { z } from "zod";
import { getContextSpaceId, resolveActorId, withContextSourceMeta } from "../../../context";
import { getDb } from "../../../db";
import {
  busabaseBaseFields,
  busabaseChangeRequests,
  busabaseCommits,
  busabaseOperations,
} from "../../../db/schema";
import { insertAuditEvent } from "../../../logic/audit";
import {
  closeChangeRequest,
  getChangeRequest,
  recordMergedOperation,
} from "../../../logic/cr-lifecycle";
import { CURRENT_USER_ID, id, now } from "../../../logic/kernel";
import { publishChangeRequestPendingReview } from "../../../logic/live-events";
import { ensureReady } from "../../../logic/seed";
import { fieldSchema } from "../../../logic/store";
import { isSystemFieldType } from "../field-types";
import { busabaseFieldValues } from "../schema";
import { ConversionNotSupportedError, convertFieldValue } from "../utils/field-conversion";
import { getBase } from "./queries";
import { resolveRelationFieldOptions } from "./relation-options";

export {
  convertFieldChangeRequestInputSchema,
  createFieldChangeRequestInputSchema,
  deleteFieldChangeRequestInputSchema,
  fieldSchema,
  previewFieldConversionInputSchema,
  reorderFieldsChangeRequestInputSchema,
  restoreFieldChangeRequestInputSchema,
  updateFieldChangeRequestInputSchema,
};

export const createBaseField = async (baseId: string, input: z.infer<typeof fieldSchema>) => {
  await ensureReady();
  const db = await getDb();
  const base = await getBase(baseId);
  if (!base) {
    throw new Error(`Base not found: ${baseId}`);
  }
  const parsed = fieldSchema.parse(input);
  const options = await resolveRelationFieldOptions(db, parsed.options);
  if (parsed.type === "relation" && !options.targetBaseId) {
    throw new Error("Relation field requires a target Base");
  }
  const [existing] = await db
    .select()
    .from(busabaseBaseFields)
    .where(
      and(
        eq(busabaseBaseFields.baseId, base.id),
        eq(busabaseBaseFields.slug, parsed.slug),
        isNull(busabaseBaseFields.deletedAt),
      ),
    )
    .limit(1);
  if (existing) {
    throw new ORPCError("CONFLICT", { message: `Field already exists: ${parsed.slug}` });
  }
  const fieldCount = base.fields.length;
  await db.insert(busabaseBaseFields).values({
    id: id("bsf"),
    baseId: base.id,
    slug: parsed.slug,
    name: iStringToText(parsed.name),
    type: parsed.type,
    required: parsed.required,
    position: fieldCount,
    options,
  });
  const updatedBase = await getBase(base.id);
  if (!updatedBase) {
    throw new Error("Failed to create field");
  }
  // Record the field add as an auto-merged ChangeRequest (audit + history +
  // rollback), replacing the old bespoke `field.created` audit action.
  await recordMergedOperation({
    operation: "base_add_field",
    targetType: "base",
    baseId: base.id,
    fields: {
      name: parsed.name,
      slug: parsed.slug,
      type: parsed.type,
      required: parsed.required,
      options: parsed.options,
    },
    message: `Add field ${parsed.slug}`,
    submittedBy: resolveActorId(CURRENT_USER_ID),
    reviewPolicySnapshot: base.reviewPolicy,
    sourceMeta: withContextSourceMeta({ subject: "base_field", fieldSlug: parsed.slug }),
    auditMetadata: { fieldSlug: parsed.slug },
  });
  return updatedBase;
};

export const createFieldChangeRequest = async (
  baseId: string,
  input: z.input<typeof createFieldChangeRequestInputSchema>,
) => {
  await ensureReady();
  const db = await getDb();
  const base = await getBase(baseId);
  if (!base) {
    throw new Error(`Base not found: ${baseId}`);
  }

  const parsed = createFieldChangeRequestInputSchema.parse(input);
  const options = await resolveRelationFieldOptions(db, parsed.options);
  if (parsed.type === "relation" && !options.targetBaseId) {
    throw new Error("Relation field requires a target Base");
  }
  const [existing] = await db
    .select()
    .from(busabaseBaseFields)
    .where(
      and(
        eq(busabaseBaseFields.baseId, base.id),
        eq(busabaseBaseFields.slug, parsed.slug),
        isNull(busabaseBaseFields.deletedAt),
      ),
    )
    .limit(1);
  if (existing) {
    throw new ORPCError("CONFLICT", { message: `Field already exists: ${parsed.slug}` });
  }

  const changeRequestId = id("crq");
  const operationId = id("opr");
  const commitId = id("cmt");
  const timestamp = now();
  const fields = {
    name: parsed.name,
    slug: parsed.slug,
    type: parsed.type,
    required: parsed.required,
    options,
  };

  await db.insert(busabaseCommits).values({
    id: commitId,
    baseId: base.id,
    operationId: null,
    parentCommitId: null,
    fields,
    operation: "base_add_field",
    message: parsed.message,
    author: parsed.submittedBy,
    createdAt: timestamp,
  });
  await db.insert(busabaseChangeRequests).values({
    id: changeRequestId,
    baseId: base.id,
    status: "in_review",
    submittedBy: resolveActorId(parsed.submittedBy),
    sourceMeta: withContextSourceMeta({ subject: "base_field", fieldSlug: parsed.slug }),
    reviewPolicySnapshot: base.reviewPolicy,
    mergeSummary: {},
    rejectedReason: null,
    reviewedAt: null,
    mergedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.insert(busabaseOperations).values({
    id: operationId,
    changeRequestId,
    baseId: base.id,
    operation: "base_add_field",
    status: "pending",
    targetRecordId: null,
    targetViewId: null,
    sourceRecordId: null,
    sourceCommitId: null,
    baseCommitId: null,
    headCommitId: commitId,
    deleteMode: "archive",
    mergedRecordId: null,
    mergedViewId: null,
    position: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.update(busabaseCommits).set({ operationId }).where(eq(busabaseCommits.id, commitId));
  await insertAuditEvent(db, {
    action: "change_request.created",
    actorId: parsed.submittedBy,
    baseId: base.id,
    changeRequestId,
    commitId,
    operationId,
    metadata: { operation: "base_add_field", fieldSlug: parsed.slug },
  });
  await publishChangeRequestPendingReview({
    spaceId: getContextSpaceId(),
    baseId: base.id,
    changeRequestId,
    submittedBy: resolveActorId(parsed.submittedBy),
  });

  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error("Failed to create field change request");
  }
  return changeRequest;
};

export const createDeleteFieldChangeRequest = async (
  baseId: string,
  fieldId: string,
  submittedBy = "local-editor",
  message?: string,
) => {
  await ensureReady();
  const db = await getDb();
  const base = await getBase(baseId);
  if (!base) {
    throw new Error(`Base not found: ${baseId}`);
  }
  const [field] = await db
    .select()
    .from(busabaseBaseFields)
    .where(and(eq(busabaseBaseFields.id, fieldId), eq(busabaseBaseFields.baseId, base.id)))
    .limit(1);
  if (!field) {
    throw new Error(`Field not found: ${fieldId}`);
  }
  if (field.deletedAt) {
    throw new Error(`Field is already deleted: ${fieldId}`);
  }
  if (isSystemFieldType(field.type)) {
    throw new Error(`Cannot delete system field: ${field.slug}`);
  }

  const changeRequestId = id("crq");
  const operationId = id("opr");
  const commitId = id("cmt");
  const timestamp = now();
  const fields = {
    fieldId: field.id,
    slug: field.slug,
    name: iStringFromText(field.name),
    type: field.type,
    required: field.required,
    options: field.options,
  };

  await db.insert(busabaseCommits).values({
    id: commitId,
    baseId: base.id,
    operationId: null,
    parentCommitId: null,
    fields,
    operation: "base_delete_field",
    message: message ?? "Delete field",
    author: submittedBy,
    createdAt: timestamp,
  });
  await db.insert(busabaseChangeRequests).values({
    id: changeRequestId,
    baseId: base.id,
    status: "in_review",
    submittedBy: resolveActorId(submittedBy),
    sourceMeta: withContextSourceMeta({ subject: "base_field", fieldSlug: field.slug }),
    reviewPolicySnapshot: base.reviewPolicy,
    mergeSummary: {},
    rejectedReason: null,
    reviewedAt: null,
    mergedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.insert(busabaseOperations).values({
    id: operationId,
    changeRequestId,
    baseId: base.id,
    operation: "base_delete_field",
    status: "pending",
    targetRecordId: null,
    targetViewId: null,
    sourceRecordId: null,
    sourceCommitId: null,
    baseCommitId: null,
    headCommitId: commitId,
    deleteMode: "archive",
    mergedRecordId: null,
    mergedViewId: null,
    position: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.update(busabaseCommits).set({ operationId }).where(eq(busabaseCommits.id, commitId));
  await insertAuditEvent(db, {
    action: "change_request.created",
    actorId: submittedBy,
    baseId: base.id,
    changeRequestId,
    commitId,
    operationId,
    metadata: { operation: "base_delete_field", fieldSlug: field.slug },
  });
  await publishChangeRequestPendingReview({
    spaceId: getContextSpaceId(),
    baseId: base.id,
    changeRequestId,
    submittedBy: resolveActorId(submittedBy),
  });

  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error("Failed to create delete field change request");
  }
  return changeRequest;
};

export const createUpdateFieldChangeRequest = async (
  baseId: string,
  fieldId: string,
  patch: { name?: iString; required?: boolean; options?: Record<string, unknown> },
  submittedBy = "local-editor",
  message?: string,
) => {
  await ensureReady();
  const db = await getDb();
  const base = await getBase(baseId);
  if (!base) {
    throw new Error(`Base not found: ${baseId}`);
  }
  const [field] = await db
    .select()
    .from(busabaseBaseFields)
    .where(and(eq(busabaseBaseFields.id, fieldId), eq(busabaseBaseFields.baseId, base.id)))
    .limit(1);
  if (!field || field.deletedAt) {
    throw new Error(`Field not found: ${fieldId}`);
  }

  const changeRequestId = id("crq");
  const operationId = id("opr");
  const commitId = id("cmt");
  const timestamp = now();
  const options =
    patch.options !== undefined
      ? await resolveRelationFieldOptions(db, patch.options)
      : field.options;
  const fields = {
    fieldId: field.id,
    slug: field.slug,
    name: patch.name ?? iStringFromText(field.name),
    type: field.type,
    required: patch.required ?? field.required,
    options,
  };

  await db.insert(busabaseCommits).values({
    id: commitId,
    baseId: base.id,
    operationId: null,
    parentCommitId: null,
    fields,
    operation: "base_update_field",
    message: message ?? "Update field",
    author: submittedBy,
    createdAt: timestamp,
  });
  await db.insert(busabaseChangeRequests).values({
    id: changeRequestId,
    baseId: base.id,
    status: "in_review",
    submittedBy: resolveActorId(submittedBy),
    sourceMeta: withContextSourceMeta({ subject: "base_field", fieldSlug: field.slug }),
    reviewPolicySnapshot: base.reviewPolicy,
    mergeSummary: {},
    rejectedReason: null,
    reviewedAt: null,
    mergedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.insert(busabaseOperations).values({
    id: operationId,
    changeRequestId,
    baseId: base.id,
    operation: "base_update_field",
    status: "pending",
    targetRecordId: null,
    targetViewId: null,
    sourceRecordId: null,
    sourceCommitId: null,
    baseCommitId: null,
    headCommitId: commitId,
    deleteMode: "archive",
    mergedRecordId: null,
    mergedViewId: null,
    position: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.update(busabaseCommits).set({ operationId }).where(eq(busabaseCommits.id, commitId));
  await insertAuditEvent(db, {
    action: "change_request.updated",
    actorId: submittedBy,
    baseId: base.id,
    changeRequestId,
    commitId,
    operationId,
    metadata: { operation: "base_update_field", fieldSlug: field.slug },
  });
  await publishChangeRequestPendingReview({
    spaceId: getContextSpaceId(),
    baseId: base.id,
    changeRequestId,
    submittedBy: resolveActorId(submittedBy),
  });

  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error("Failed to create update field change request");
  }
  return changeRequest;
};

// Bound the field-value scan so a large base can't OOM the preview: process
// non-null rows in id-keyset chunks and return at most a sample of conflicts.
const PREVIEW_SCAN_CHUNK = 1000;
const PREVIEW_CONFLICT_SAMPLE_CAP = 100;

export const previewFieldConversion = async (
  baseId: string,
  fieldId: string,
  newType: FieldType,
) => {
  await ensureReady();
  const db = await getDb();
  const base = await getBase(baseId);
  if (!base) {
    throw new Error(`Base not found: ${baseId}`);
  }
  const [field] = await db
    .select()
    .from(busabaseBaseFields)
    .where(and(eq(busabaseBaseFields.id, fieldId), eq(busabaseBaseFields.baseId, base.id)))
    .limit(1);
  if (!field || field.deletedAt) {
    throw new Error(`Field not found: ${fieldId}`);
  }
  if (isSystemFieldType(field.type)) {
    throw new Error(`Cannot convert system field: ${field.slug}`);
  }
  if (field.type === "relation" || field.type === "attachment") {
    throw new ConversionNotSupportedError(field.type, newType);
  }
  if (isSystemFieldType(newType) || newType === "relation" || newType === "attachment") {
    throw new ConversionNotSupportedError(field.type, newType);
  }

  const scopeFilter = and(
    eq(busabaseFieldValues.baseId, base.id),
    eq(busabaseFieldValues.fieldId, fieldId),
    isNull(busabaseFieldValues.changeRequestId),
  );

  // Exact totals straight from SQL — no row materialization. A row counts as
  // "null" iff ALL four value columns are NULL, mirroring the JS nullish check
  // (valueJson ?? valueText ?? valueNumber ?? valueBool).
  const [totals] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(busabaseFieldValues)
    .where(scopeFilter);
  const totalCount = totals?.count ?? 0;
  const [nulls] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(busabaseFieldValues)
    .where(
      and(
        scopeFilter,
        isNull(busabaseFieldValues.valueJson),
        isNull(busabaseFieldValues.valueText),
        isNull(busabaseFieldValues.valueNumber),
        isNull(busabaseFieldValues.valueBool),
      ),
    );
  const nullCount = nulls?.count ?? 0;

  // Convertibility needs the per-row JS conversion, so scan the NON-null rows in
  // bounded chunks (keyset by id) rather than loading the whole column at once,
  // and cap the returned conflict SAMPLE. `convertibleCount` stays exact (every
  // non-null row is examined); the true conflict count is derivable as
  // totalCount - convertibleCount - nullCount.
  const notAllNull = or(
    isNotNull(busabaseFieldValues.valueJson),
    isNotNull(busabaseFieldValues.valueText),
    isNotNull(busabaseFieldValues.valueNumber),
    isNotNull(busabaseFieldValues.valueBool),
  );
  const conflicts: Array<{ recordId: string; currentValue: unknown }> = [];
  let convertibleCount = 0;
  let cursor = "";
  for (;;) {
    const chunk = await db
      .select()
      .from(busabaseFieldValues)
      .where(and(scopeFilter, notAllNull, gt(busabaseFieldValues.id, cursor)))
      .orderBy(asc(busabaseFieldValues.id))
      .limit(PREVIEW_SCAN_CHUNK);
    if (chunk.length === 0) {
      break;
    }
    for (const row of chunk) {
      const currentValue =
        row.valueJson ?? row.valueText ?? row.valueNumber ?? row.valueBool ?? null;
      if (currentValue === null || currentValue === undefined) {
        continue; // notAllNull guarantees this can't happen; defensive only.
      }
      try {
        const converted = convertFieldValue(currentValue, field.type, newType, {
          choices: field.options?.choices ?? [],
        });
        if (converted === null || converted === undefined) {
          if (conflicts.length < PREVIEW_CONFLICT_SAMPLE_CAP) {
            conflicts.push({ recordId: row.recordId ?? "", currentValue });
          }
        } else {
          convertibleCount++;
        }
      } catch {
        if (conflicts.length < PREVIEW_CONFLICT_SAMPLE_CAP) {
          conflicts.push({ recordId: row.recordId ?? "", currentValue });
        }
      }
    }
    const lastRow = chunk[chunk.length - 1];
    if (!lastRow || chunk.length < PREVIEW_SCAN_CHUNK) {
      break;
    }
    cursor = lastRow.id;
  }

  return {
    totalCount,
    convertibleCount,
    nullCount,
    conflicts,
  };
};

export const createConvertFieldChangeRequest = async (
  baseId: string,
  fieldId: string,
  newType: FieldType,
  selectChoiceMode: "auto_create" | "null_on_missing" = "null_on_missing",
  submittedBy = "local-editor",
  message?: string,
) => {
  await ensureReady();
  const db = await getDb();
  const base = await getBase(baseId);
  if (!base) {
    throw new Error(`Base not found: ${baseId}`);
  }
  const [field] = await db
    .select()
    .from(busabaseBaseFields)
    .where(and(eq(busabaseBaseFields.id, fieldId), eq(busabaseBaseFields.baseId, base.id)))
    .limit(1);
  if (!field || field.deletedAt) {
    throw new Error(`Field not found: ${fieldId}`);
  }
  if (isSystemFieldType(field.type)) {
    throw new Error(`Cannot convert system field: ${field.slug}`);
  }
  if (field.type === "relation" || field.type === "attachment") {
    throw new ConversionNotSupportedError(field.type, newType);
  }
  if (isSystemFieldType(newType) || newType === "relation" || newType === "attachment") {
    throw new ConversionNotSupportedError(field.type, newType);
  }

  // A field may only have one in-review convert CR at a time. But a CR that has
  // sat unreviewed for more than 7 days is treated as abandoned: it is auto-closed
  // so a fresh convert can proceed (Fix 7 — convert-lock timeout).
  const CONVERT_LOCK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const existingCrs = await db
    .select()
    .from(busabaseChangeRequests)
    .where(
      and(
        eq(busabaseChangeRequests.baseId, base.id),
        eq(busabaseChangeRequests.status, "in_review"),
      ),
    );
  for (const cr of existingCrs) {
    const meta = cr.sourceMeta as Record<string, unknown>;
    if (meta?.subject === "base_convert_field" && meta?.fieldId === fieldId) {
      const ageMs = Date.now() - cr.createdAt.getTime();
      if (ageMs > CONVERT_LOCK_TTL_MS) {
        await closeChangeRequest(cr.id, "Auto-closed: convert lock expired after 7 days");
        continue;
      }
      throw new Error(`A convert change request is already in review for field: ${field.slug}`);
    }
  }

  const changeRequestId = id("crq");
  const operationId = id("opr");
  const commitId = id("cmt");
  const timestamp = now();
  const fields = {
    fieldId: field.id,
    slug: field.slug,
    fromType: field.type,
    newType,
    selectChoiceMode,
    choices: field.options?.choices ?? [],
  };

  await db.insert(busabaseCommits).values({
    id: commitId,
    baseId: base.id,
    operationId: null,
    parentCommitId: null,
    fields,
    operation: "base_convert_field",
    message: message ?? `Convert field ${field.slug} from ${field.type} to ${newType}`,
    author: submittedBy,
    createdAt: timestamp,
  });
  await db.insert(busabaseChangeRequests).values({
    id: changeRequestId,
    baseId: base.id,
    status: "in_review",
    submittedBy: resolveActorId(submittedBy),
    sourceMeta: withContextSourceMeta({
      subject: "base_convert_field",
      fieldId: field.id,
      fieldSlug: field.slug,
    }),
    reviewPolicySnapshot: base.reviewPolicy,
    mergeSummary: {},
    rejectedReason: null,
    reviewedAt: null,
    mergedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.insert(busabaseOperations).values({
    id: operationId,
    changeRequestId,
    baseId: base.id,
    operation: "base_convert_field",
    status: "pending",
    targetRecordId: null,
    targetViewId: null,
    sourceRecordId: null,
    sourceCommitId: null,
    baseCommitId: null,
    headCommitId: commitId,
    deleteMode: "archive",
    mergedRecordId: null,
    mergedViewId: null,
    position: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.update(busabaseCommits).set({ operationId }).where(eq(busabaseCommits.id, commitId));
  await insertAuditEvent(db, {
    action: "change_request.created",
    actorId: submittedBy,
    baseId: base.id,
    changeRequestId,
    commitId,
    operationId,
    metadata: { operation: "base_convert_field", fieldSlug: field.slug, newType },
  });
  await publishChangeRequestPendingReview({
    spaceId: getContextSpaceId(),
    baseId: base.id,
    changeRequestId,
    submittedBy: resolveActorId(submittedBy),
  });

  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error("Failed to create convert field change request");
  }
  return changeRequest;
};

export const createReorderFieldsChangeRequest = async (
  baseId: string,
  fieldIds: string[],
  submittedBy = "local-editor",
  message?: string,
) => {
  await ensureReady();
  const db = await getDb();
  const base = await getBase(baseId);
  if (!base) {
    throw new Error(`Base not found: ${baseId}`);
  }

  // All active (non-deleted) field IDs must be included
  const activeFieldIds = new Set(base.fields.map((f) => f.id));
  const providedSet = new Set(fieldIds);
  for (const activeId of activeFieldIds) {
    if (!providedSet.has(activeId)) {
      throw new Error(`Reorder must include all active fields. Missing field: ${activeId}`);
    }
  }

  const changeRequestId = id("crq");
  const operationId = id("opr");
  const commitId = id("cmt");
  const timestamp = now();
  const fields = { fieldIds };

  await db.insert(busabaseCommits).values({
    id: commitId,
    baseId: base.id,
    operationId: null,
    parentCommitId: null,
    fields,
    operation: "base_reorder_fields",
    message: message ?? "Reorder fields",
    author: submittedBy,
    createdAt: timestamp,
  });
  await db.insert(busabaseChangeRequests).values({
    id: changeRequestId,
    baseId: base.id,
    status: "in_review",
    submittedBy: resolveActorId(submittedBy),
    sourceMeta: withContextSourceMeta({ subject: "base_reorder_fields" }),
    reviewPolicySnapshot: base.reviewPolicy,
    mergeSummary: {},
    rejectedReason: null,
    reviewedAt: null,
    mergedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.insert(busabaseOperations).values({
    id: operationId,
    changeRequestId,
    baseId: base.id,
    operation: "base_reorder_fields",
    status: "pending",
    targetRecordId: null,
    targetViewId: null,
    sourceRecordId: null,
    sourceCommitId: null,
    baseCommitId: null,
    headCommitId: commitId,
    deleteMode: "archive",
    mergedRecordId: null,
    mergedViewId: null,
    position: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.update(busabaseCommits).set({ operationId }).where(eq(busabaseCommits.id, commitId));
  await insertAuditEvent(db, {
    action: "change_request.created",
    actorId: submittedBy,
    baseId: base.id,
    changeRequestId,
    commitId,
    operationId,
    metadata: { operation: "base_reorder_fields" },
  });
  await publishChangeRequestPendingReview({
    spaceId: getContextSpaceId(),
    baseId: base.id,
    changeRequestId,
    submittedBy: resolveActorId(submittedBy),
  });

  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error("Failed to create reorder fields change request");
  }
  return changeRequest;
};

export const createRestoreFieldChangeRequest = async (
  baseId: string,
  fieldId: string,
  submittedBy = "local-editor",
  message?: string,
) => {
  await ensureReady();
  const db = await getDb();
  const base = await getBase(baseId);
  if (!base) {
    throw new Error(`Base not found: ${baseId}`);
  }
  const [field] = await db
    .select()
    .from(busabaseBaseFields)
    .where(and(eq(busabaseBaseFields.id, fieldId), eq(busabaseBaseFields.baseId, base.id)))
    .limit(1);
  if (!field) {
    throw new Error(`Field not found: ${fieldId}`);
  }
  if (!field.deletedAt) {
    throw new Error(`Field is not deleted: ${fieldId}`);
  }

  const changeRequestId = id("crq");
  const operationId = id("opr");
  const commitId = id("cmt");
  const timestamp = now();
  const fields = {
    fieldId: field.id,
    slug: field.slug,
    name: iStringFromText(field.name),
    type: field.type,
    required: field.required,
    options: field.options,
  };

  await db.insert(busabaseCommits).values({
    id: commitId,
    baseId: base.id,
    operationId: null,
    parentCommitId: null,
    fields,
    operation: "base_restore_field",
    message: message ?? "Restore field",
    author: submittedBy,
    createdAt: timestamp,
  });
  await db.insert(busabaseChangeRequests).values({
    id: changeRequestId,
    baseId: base.id,
    status: "in_review",
    submittedBy: resolveActorId(submittedBy),
    sourceMeta: withContextSourceMeta({ subject: "base_field", fieldSlug: field.slug }),
    reviewPolicySnapshot: base.reviewPolicy,
    mergeSummary: {},
    rejectedReason: null,
    reviewedAt: null,
    mergedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.insert(busabaseOperations).values({
    id: operationId,
    changeRequestId,
    baseId: base.id,
    operation: "base_restore_field",
    status: "pending",
    targetRecordId: null,
    targetViewId: null,
    sourceRecordId: null,
    sourceCommitId: null,
    baseCommitId: null,
    headCommitId: commitId,
    deleteMode: "archive",
    mergedRecordId: null,
    mergedViewId: null,
    position: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.update(busabaseCommits).set({ operationId }).where(eq(busabaseCommits.id, commitId));
  await insertAuditEvent(db, {
    action: "change_request.created",
    actorId: submittedBy,
    baseId: base.id,
    changeRequestId,
    commitId,
    operationId,
    metadata: { operation: "base_restore_field", fieldSlug: field.slug },
  });
  await publishChangeRequestPendingReview({
    spaceId: getContextSpaceId(),
    baseId: base.id,
    changeRequestId,
    submittedBy: resolveActorId(submittedBy),
  });

  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error("Failed to create restore field change request");
  }
  return changeRequest;
};
