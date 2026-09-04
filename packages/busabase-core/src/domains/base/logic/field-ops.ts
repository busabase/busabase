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
import type { FieldType, LookupRollup } from "busabase-contract/types";
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
import { insertCommit } from "../../../logic/commits";
import {
  closeChangeRequest,
  finalizeChangeRequest,
  getChangeRequest,
  recordMergedOperation,
} from "../../../logic/cr-lifecycle";
import { CURRENT_USER_ID, id, now } from "../../../logic/kernel";
import { publishChangeRequestPendingReview } from "../../../logic/live-events";
import { assertNodePermission } from "../../../logic/node-acl";
import { ensureReady } from "../../../logic/seed";
import { fieldSchema } from "../../../logic/store";
import { assertValidFormulaField } from "../field-rules";
import { isSystemFieldType } from "../field-types";
import { FormulaError } from "../formula";
import { isRollupCompatible, rollupPreservesTargetUnit } from "../lookup/rollup";
import { busabaseFieldValues } from "../schema";
import { convertFieldValue } from "../utils/field-conversion";
import { isPrimaryField, PRIMARY_FIELD_DELETE_MESSAGE } from "../utils/primary-field";
import { baseNotFound } from "./errors";
import { getBase } from "./queries";
import { assertRelationOnlyOptionsOrThrow, resolveRelationFieldOptions } from "./relation-options";

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

/** Caller-supplied fieldId doesn't resolve (or is soft-deleted) — a genuine "not found" client error. */
const fieldNotFound = (fieldId: string) =>
  new ORPCError("NOT_FOUND", { message: `Field not found: ${fieldId}` });

/** Requested field-type conversion is intentionally disallowed — a client validation error, not a server fault. */
const conversionNotSupported = (fromType: FieldType, newType: FieldType) =>
  new ORPCError("BAD_REQUEST", { message: `Cannot convert from "${fromType}" to "${newType}"` });

/** Caller declared type: "relation" but didn't supply a target Base — a client input error, not a server fault. */
const relationRequiresTargetBase = () =>
  new ORPCError("BAD_REQUEST", { message: "Relation field requires a target Base" });

/** field-rules.ts's `assertValidFormulaField` throws plain `FormulaError` (it's a
 *  pure/isomorphic module, no oRPC dependency) — translate to the ORPCError
 *  shape this domain's handlers use everywhere else. */
const assertValidFormulaFieldOrThrow: typeof assertValidFormulaField = (...args) => {
  try {
    assertValidFormulaField(...args);
  } catch (error) {
    if (error instanceof FormulaError) {
      throw new ORPCError("BAD_REQUEST", { message: error.message });
    }
    throw error;
  }
};

/**
 * Validate AND resolve a `lookup` field's options — the lookup-side counterpart
 * to `resolveRelationFieldOptions` (which resolves targetBaseSlug → targetBaseId
 * on the relation side). Returns `options` unchanged for every other field type.
 *
 * Validates: the relation hop exists and really is a `relation`, the target field
 * exists on the related Base, and the chosen rollup fits the target field's type.
 *
 * Resolves: copies the target field's `options.number` (currency / locale) onto
 * the lookup, so a `sum` over a currency column renders as currency. The client
 * only ever has its OWN Base's field definitions, so without this snapshot it has
 * no way to know the rolled-up number is money. Same denormalization bika does
 * with `lookupTargetFieldType`; the tradeoff is it goes stale if the target field
 * later changes currency, which is rare and cheap to fix by re-saving the field.
 *
 * Targeting another `lookup` is rejected outright. Vika/bika both allow nesting
 * and both need a whole cross-table dependency graph plus cycle detection to
 * make it safe; forbidding one hop removes that entire class of bug by
 * construction. Chain through a `formula` field on the related Base if you need
 * a derived value.
 */
export const resolveLookupFieldOptions = async <
  TOptions extends {
    lookup?: { relationFieldSlug?: string; targetFieldSlug?: string; rollup?: string };
    number?: { format?: "plain" | "currency"; currency?: string; locale?: string };
  },
>(
  type: FieldType,
  slug: string,
  options: TOptions,
  siblingFields: ReadonlyArray<{
    slug: string;
    type: FieldType;
    options?: { targetBaseId?: string } | null;
  }>,
): Promise<TOptions> => {
  if (type !== "lookup") return options;
  const config = options.lookup;
  if (!config?.relationFieldSlug || !config.targetFieldSlug) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Lookup field requires options.lookup.relationFieldSlug and options.lookup.targetFieldSlug: ${slug}`,
    });
  }
  const relationField = siblingFields.find((field) => field.slug === config.relationFieldSlug);
  if (!relationField || relationField.type !== "relation") {
    throw new ORPCError("BAD_REQUEST", {
      message: `Lookup field "${slug}" must point at a relation field on this Base — no relation field named "${config.relationFieldSlug}"`,
    });
  }
  const targetBaseId = relationField.options?.targetBaseId;
  if (!targetBaseId) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Relation field "${config.relationFieldSlug}" has no target Base, so "${slug}" has nothing to look up`,
    });
  }
  const targetBase = await getBase(targetBaseId);
  if (!targetBase) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Lookup target Base not found: ${targetBaseId}`,
    });
  }
  const targetField = targetBase.fields.find((field) => field.slug === config.targetFieldSlug);
  if (!targetField) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Lookup target field "${config.targetFieldSlug}" not found on Base "${targetBase.slug}"`,
    });
  }
  if (targetField.type === "lookup") {
    throw new ORPCError("BAD_REQUEST", {
      message: `Lookup field "${slug}" cannot target another lookup field ("${config.targetFieldSlug}") — chained lookups are not supported`,
    });
  }
  const rollup = (config.rollup ?? "values") as LookupRollup;
  if (!isRollupCompatible(rollup, targetField.type)) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Rollup "${rollup}" needs a numeric target field, but "${config.targetFieldSlug}" is a ${targetField.type} field`,
    });
  }
  const targetNumber = targetField.options?.number;
  if (targetNumber && rollupPreservesTargetUnit(rollup)) {
    return { ...options, number: targetNumber };
  }
  // Drop a formatting snapshot left over from a previous target/rollup — e.g.
  // switching a `sum` to a `count`, where currency would now be nonsense.
  if (options.number) {
    const { number: _dropped, ...rest } = options;
    return rest as TOptions;
  }
  return options;
};

export const createBaseField = async (baseId: string, input: z.infer<typeof fieldSchema>) => {
  await ensureReady();
  const db = await getDb();
  const base = await getBase(baseId);
  if (!base) {
    throw baseNotFound(baseId);
  }
  await assertNodePermission(base.nodeId, "write");
  const parsed = fieldSchema.parse(input);
  assertRelationOnlyOptionsOrThrow(parsed.type, parsed.slug, parsed.options);
  const relationResolved = await resolveRelationFieldOptions(db, parsed.options);
  if (parsed.type === "relation" && !relationResolved.targetBaseId) {
    throw relationRequiresTargetBase();
  }
  assertValidFormulaFieldOrThrow(parsed.type, parsed.slug, relationResolved, base.fields);
  const options = await resolveLookupFieldOptions(
    parsed.type,
    parsed.slug,
    relationResolved,
    base.fields,
  );
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
    throw baseNotFound(baseId);
  }

  const parsed = createFieldChangeRequestInputSchema.parse(input);
  assertRelationOnlyOptionsOrThrow(parsed.type, parsed.slug, parsed.options);
  const relationResolved = await resolveRelationFieldOptions(db, parsed.options);
  if (parsed.type === "relation" && !relationResolved.targetBaseId) {
    throw relationRequiresTargetBase();
  }
  assertValidFormulaFieldOrThrow(parsed.type, parsed.slug, relationResolved, base.fields);
  const options = await resolveLookupFieldOptions(
    parsed.type,
    parsed.slug,
    relationResolved,
    base.fields,
  );
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

  await insertCommit(db, {
    id: commitId,
    baseId: base.id,
    operationId: null,
    parentCommitId: null,
    payload: fields,
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
  return finalizeChangeRequest({
    changeRequestId,
    nodeId: base.nodeId,
    requestedAutoMerge: parsed.autoMerge,
    submittedBy: parsed.submittedBy,
    baseId: base.id,
    label: "field create",
    kind: "structural",
  });
};

export const createDeleteFieldChangeRequest = async (
  baseId: string,
  fieldId: string,
  submittedBy = "local-editor",
  message?: string,
  autoMerge?: boolean,
) => {
  await ensureReady();
  const db = await getDb();
  const base = await getBase(baseId);
  if (!base) {
    throw baseNotFound(baseId);
  }
  const [field] = await db
    .select()
    .from(busabaseBaseFields)
    .where(and(eq(busabaseBaseFields.id, fieldId), eq(busabaseBaseFields.baseId, base.id)))
    .limit(1);
  if (!field) {
    throw fieldNotFound(fieldId);
  }
  if (field.deletedAt) {
    throw new Error(`Field is already deleted: ${fieldId}`);
  }
  if (isSystemFieldType(field.type)) {
    throw new Error(`Cannot delete system field: ${field.slug}`);
  }
  if (isPrimaryField(base, field.id)) {
    throw new ORPCError("BAD_REQUEST", { message: PRIMARY_FIELD_DELETE_MESSAGE });
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

  await insertCommit(db, {
    id: commitId,
    baseId: base.id,
    operationId: null,
    parentCommitId: null,
    payload: fields,
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
  // Permission-aware, same as the add/update/reorder/restore siblings. Deleting
  // a field SOFT-deletes it and its stored values, and `restore` brings both
  // back — which is why it is no longer pinned review-first for everyone (see
  // `busabase-contract/src/contract/auto-merge.ts`).
  return finalizeChangeRequest({
    changeRequestId,
    nodeId: base.nodeId,
    requestedAutoMerge: autoMerge,
    submittedBy,
    baseId: base.id,
    label: "field delete",
    kind: "structural",
  });
};

export const createUpdateFieldChangeRequest = async (
  baseId: string,
  fieldId: string,
  patch: { name?: iString; required?: boolean; options?: Record<string, unknown> },
  submittedBy = "local-editor",
  message?: string,
  autoMerge?: boolean,
) => {
  await ensureReady();
  const db = await getDb();
  const base = await getBase(baseId);
  if (!base) {
    throw baseNotFound(baseId);
  }
  const [field] = await db
    .select()
    .from(busabaseBaseFields)
    .where(and(eq(busabaseBaseFields.id, fieldId), eq(busabaseBaseFields.baseId, base.id)))
    .limit(1);
  if (!field || field.deletedAt) {
    throw fieldNotFound(fieldId);
  }

  const changeRequestId = id("crq");
  const operationId = id("opr");
  const commitId = id("cmt");
  const timestamp = now();
  if (patch.options !== undefined) {
    assertRelationOnlyOptionsOrThrow(field.type, field.slug, patch.options);
  }
  let options =
    patch.options !== undefined
      ? await resolveRelationFieldOptions(db, patch.options)
      : field.options;
  if (patch.options !== undefined) {
    assertValidFormulaFieldOrThrow(field.type, field.slug, options, base.fields);
    options = await resolveLookupFieldOptions(field.type, field.slug, options, base.fields);
  }
  const fields = {
    fieldId: field.id,
    slug: field.slug,
    name: patch.name ?? iStringFromText(field.name),
    type: field.type,
    required: patch.required ?? field.required,
    options,
  };

  await insertCommit(db, {
    id: commitId,
    baseId: base.id,
    operationId: null,
    parentCommitId: null,
    payload: fields,
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
  return finalizeChangeRequest({
    changeRequestId,
    nodeId: base.nodeId,
    requestedAutoMerge: autoMerge,
    submittedBy: submittedBy,
    baseId: base.id,
    label: "field update",
    kind: "structural",
  });
};

// Bound the field-value scan so a large base can't OOM the preview: process
// non-null rows in id-keyset chunks and return at most a sample of conflicts.
const PREVIEW_SCAN_CHUNK = 1000;
const PREVIEW_CONFLICT_SAMPLE_CAP = 100;

export const previewFieldConversion = async (
  baseId: string,
  fieldId: string,
  newType: FieldType,
  selectChoiceMode: "auto_create" | "null_on_missing" = "null_on_missing",
) => {
  await ensureReady();
  const db = await getDb();
  const base = await getBase(baseId);
  if (!base) {
    throw baseNotFound(baseId);
  }
  const [field] = await db
    .select()
    .from(busabaseBaseFields)
    .where(and(eq(busabaseBaseFields.id, fieldId), eq(busabaseBaseFields.baseId, base.id)))
    .limit(1);
  if (!field || field.deletedAt) {
    throw fieldNotFound(fieldId);
  }
  if (isSystemFieldType(field.type)) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Cannot convert system field: ${field.slug}`,
    });
  }
  if (field.type === "relation" || field.type === "attachment") {
    throw conversionNotSupported(field.type, newType);
  }
  if (isSystemFieldType(newType) || newType === "relation" || newType === "attachment") {
    throw conversionNotSupported(field.type, newType);
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
        // A conversion to a list type that yields `[]` from a non-empty source dropped
        // every item — for the caller that is data loss, not a success, so it has to be
        // reported as a conflict. Counting it as convertible is how a preview could
        // report "0 conflicts" for a change that wipes the column.
        //
        // Under `auto_create` it is NOT a loss: the merge mints a choice per value (per
        // comma-separated part, for multiselect) before converting, so the value that
        // matches nothing today will match tomorrow. Only `null_on_missing` really drops it.
        const mintsMissingChoices =
          selectChoiceMode === "auto_create" && (newType === "select" || newType === "multiselect");
        const sourceWasEmpty =
          currentValue === "" || (Array.isArray(currentValue) && currentValue.length === 0);
        const droppedEveryItem =
          !mintsMissingChoices &&
          !sourceWasEmpty &&
          Array.isArray(converted) &&
          converted.length === 0;
        const droppedScalar =
          (converted === null || converted === undefined) && !mintsMissingChoices;
        if (droppedScalar || droppedEveryItem) {
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
  autoMerge?: boolean,
) => {
  await ensureReady();
  const db = await getDb();
  const base = await getBase(baseId);
  if (!base) {
    throw baseNotFound(baseId);
  }
  const [field] = await db
    .select()
    .from(busabaseBaseFields)
    .where(and(eq(busabaseBaseFields.id, fieldId), eq(busabaseBaseFields.baseId, base.id)))
    .limit(1);
  if (!field || field.deletedAt) {
    throw fieldNotFound(fieldId);
  }
  if (isSystemFieldType(field.type)) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Cannot convert system field: ${field.slug}`,
    });
  }
  if (field.type === "relation" || field.type === "attachment") {
    throw conversionNotSupported(field.type, newType);
  }
  if (isSystemFieldType(newType) || newType === "relation" || newType === "attachment") {
    throw conversionNotSupported(field.type, newType);
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

  await insertCommit(db, {
    id: commitId,
    baseId: base.id,
    operationId: null,
    parentCommitId: null,
    payload: fields,
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
  // Permission-aware. A convert can drop values that do not fit the new type,
  // which is what `previewFieldConversion` is for — the dry run is the safeguard,
  // not a mandatory second human. Callers who want the sign-off pass
  // `autoMerge: false`.
  return finalizeChangeRequest({
    changeRequestId,
    nodeId: base.nodeId,
    requestedAutoMerge: autoMerge,
    submittedBy,
    baseId: base.id,
    label: "field convert",
    kind: "structural",
  });
};

export const createReorderFieldsChangeRequest = async (
  baseId: string,
  fieldIds: string[],
  submittedBy = "local-editor",
  message?: string,
  autoMerge?: boolean,
) => {
  await ensureReady();
  const db = await getDb();
  const base = await getBase(baseId);
  if (!base) {
    throw baseNotFound(baseId);
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

  await insertCommit(db, {
    id: commitId,
    baseId: base.id,
    operationId: null,
    parentCommitId: null,
    payload: fields,
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
  return finalizeChangeRequest({
    changeRequestId,
    nodeId: base.nodeId,
    requestedAutoMerge: autoMerge,
    submittedBy: submittedBy,
    baseId: base.id,
    label: "reorder fields",
    kind: "structural",
  });
};

export const createRestoreFieldChangeRequest = async (
  baseId: string,
  fieldId: string,
  submittedBy = "local-editor",
  message?: string,
  autoMerge?: boolean,
) => {
  await ensureReady();
  const db = await getDb();
  const base = await getBase(baseId);
  if (!base) {
    throw baseNotFound(baseId);
  }
  const [field] = await db
    .select()
    .from(busabaseBaseFields)
    .where(and(eq(busabaseBaseFields.id, fieldId), eq(busabaseBaseFields.baseId, base.id)))
    .limit(1);
  if (!field) {
    throw fieldNotFound(fieldId);
  }
  if (!field.deletedAt) {
    throw new ORPCError("CONFLICT", { message: `Field is not deleted: ${fieldId}` });
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

  await insertCommit(db, {
    id: commitId,
    baseId: base.id,
    operationId: null,
    parentCommitId: null,
    payload: fields,
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
  return finalizeChangeRequest({
    changeRequestId,
    nodeId: base.nodeId,
    requestedAutoMerge: autoMerge,
    submittedBy: submittedBy,
    baseId: base.id,
    label: "restore field",
    kind: "structural",
  });
};
