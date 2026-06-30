import "server-only";

import { ORPCError } from "@orpc/server";
import { and, eq, isNull } from "drizzle-orm";
import type { z } from "zod";
import { resolveActorId } from "../../../context";
import { getDb } from "../../../db";
import {
  busabaseBaseFields,
  busabaseChangeRequests,
  busabaseCommits,
  busabaseOperations,
} from "../../../db/schema";
import { insertAuditEvent } from "../../../logic/audit";
import { closeChangeRequest, getChangeRequest } from "../../../logic/cr-lifecycle";
import { id, now } from "../../../logic/kernel";
import { ensureReady } from "../../../logic/seed";
import { fieldSchema } from "../../../logic/store";
import type { FieldType } from "../../../types";
import {
  convertFieldChangeRequestInputSchema,
  createFieldChangeRequestInputSchema,
  deleteFieldChangeRequestInputSchema,
  previewFieldConversionInputSchema,
  reorderFieldsChangeRequestInputSchema,
  restoreFieldChangeRequestInputSchema,
  updateFieldChangeRequestInputSchema,
} from "../contract/base-schemas";
import { isSystemFieldType } from "../field-types";
import { busabaseFieldValues } from "../schema";
import { ConversionNotSupportedError, convertFieldValue } from "../utils/field-conversion";
import { getBase } from "./queries";

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
  if (parsed.type === "relation" && !parsed.options.targetBaseId) {
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
    name: parsed.name,
    type: parsed.type,
    required: parsed.required,
    position: fieldCount,
    options: parsed.options,
  });
  const updatedBase = await getBase(base.id);
  if (!updatedBase) {
    throw new Error("Failed to create field");
  }
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
  if (parsed.type === "relation" && !parsed.options.targetBaseId) {
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
    options: parsed.options,
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
    sourceMeta: { subject: "base_field", fieldSlug: parsed.slug },
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
    name: field.name,
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
    sourceMeta: { subject: "base_field", fieldSlug: field.slug },
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

  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error("Failed to create delete field change request");
  }
  return changeRequest;
};

export const createUpdateFieldChangeRequest = async (
  baseId: string,
  fieldId: string,
  patch: { name?: string; required?: boolean; options?: Record<string, unknown> },
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
  const fields = {
    fieldId: field.id,
    slug: field.slug,
    name: patch.name ?? field.name,
    type: field.type,
    required: patch.required ?? field.required,
    options: patch.options !== undefined ? patch.options : field.options,
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
    sourceMeta: { subject: "base_field", fieldSlug: field.slug },
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

  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error("Failed to create update field change request");
  }
  return changeRequest;
};

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

  // Load record-level field values for this field only
  const valueRows = await db
    .select()
    .from(busabaseFieldValues)
    .where(
      and(
        eq(busabaseFieldValues.baseId, base.id),
        eq(busabaseFieldValues.fieldId, fieldId),
        isNull(busabaseFieldValues.changeRequestId),
      ),
    );

  const totalCount = valueRows.length;
  const conflicts: Array<{ recordId: string; currentValue: unknown }> = [];
  let nullCount = 0;
  let convertibleCount = 0;

  for (const row of valueRows) {
    const currentValue = row.valueJson ?? row.valueText ?? row.valueNumber ?? row.valueBool ?? null;
    if (currentValue === null || currentValue === undefined) {
      nullCount++;
      continue;
    }
    try {
      const converted = convertFieldValue(currentValue, field.type, newType, {
        choices: field.options?.choices ?? [],
      });
      if (converted === null || converted === undefined) {
        conflicts.push({ recordId: row.recordId ?? "", currentValue });
      } else {
        convertibleCount++;
      }
    } catch {
      conflicts.push({ recordId: row.recordId ?? "", currentValue });
    }
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
    sourceMeta: { subject: "base_convert_field", fieldId: field.id, fieldSlug: field.slug },
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
    sourceMeta: { subject: "base_reorder_fields" },
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
    name: field.name,
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
    sourceMeta: { subject: "base_field", fieldSlug: field.slug },
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

  const changeRequest = await getChangeRequest(changeRequestId);
  if (!changeRequest) {
    throw new Error("Failed to create restore field change request");
  }
  return changeRequest;
};
