import "server-only";

import { and, eq, isNull, max } from "drizzle-orm";
import { getContextSpaceId, resolveActorId } from "../../../../context";
import type { BaseFieldPO, CommitPO, OperationPO } from "../../../../db/schema";
import {
  busabaseBaseFields,
  busabaseCommits,
  busabaseFieldValues,
  busabaseOperations,
  busabaseRecordLinks,
  busabaseRecords,
} from "../../../../db/schema";
import type { MergeCtx } from "../../../../logic/cr-lifecycle";
import { projectCommitFields } from "../../../../logic/field-values";
import { CURRENT_USER_ID, id, requireBaseId } from "../../../../logic/kernel";
import { removeRecordAssetUsages, syncRecordAssetUsages } from "../../../assets/handlers";
import { computeSystemFieldValues, validateRecordFields } from "../../field-rules";
import { isSystemFieldType } from "../../field-types";

/**
 * Re-validate the final merged fields against the base's CURRENT schema. A CR can
 * be authored while a field is optional and merged after that field became
 * required (or otherwise constrained); without this the stale record would slip
 * past the new constraint. Throws BAD_REQUEST naming the offending field(s).
 */
const assertMergedFieldsValid = async (
  ctx: MergeCtx,
  baseId: string,
  fields: Record<string, unknown>,
) => {
  const defs = await loadBaseFieldDefs(ctx.db, baseId);
  const errors = validateRecordFields(fields, defs);
  if (errors.length > 0) {
    const { ORPCError } = await import("@orpc/server");
    const first = errors[0];
    throw new ORPCError("BAD_REQUEST", {
      message: `required field missing after schema change: ${first.slug}`,
      data: { errors },
    });
  }
};

export const loadBaseFieldDefs = (db: MergeCtx["db"], baseId: string): Promise<BaseFieldPO[]> =>
  db.select().from(busabaseBaseFields).where(eq(busabaseBaseFields.baseId, baseId));

const nextAutoNumber = async (
  db: MergeCtx["db"],
  baseId: string,
  field: BaseFieldPO,
): Promise<number> => {
  const [row] = await db
    .select({ value: max(busabaseFieldValues.valueNumber) })
    .from(busabaseFieldValues)
    .where(and(eq(busabaseFieldValues.baseId, baseId), eq(busabaseFieldValues.fieldId, field.id)));
  return Math.floor(Number(row?.value ?? 0)) + 1;
};

export const applyComputedRecordFields = async (
  ctx: MergeCtx,
  args: {
    baseId: string;
    mode: "create" | "update";
    fields: Record<string, unknown>;
    existing?: Record<string, unknown>;
  },
): Promise<Record<string, unknown>> => {
  const defs = await loadBaseFieldDefs(ctx.db, args.baseId);
  const autoNumbers = new Map<string, number>();
  if (args.mode === "create") {
    for (const def of defs) {
      if (def.type === "auto_number") {
        autoNumbers.set(def.slug, await nextAutoNumber(ctx.db, args.baseId, def));
      }
    }
  }
  const overrides = computeSystemFieldValues({
    defs,
    mode: args.mode,
    actorId: ctx.actorId,
    timestampIso: ctx.timestamp.toISOString(),
    existing: args.existing,
    nextAutoNumber: (def) => autoNumbers.get(def.slug) ?? 1,
  });
  const userFields = { ...args.fields };
  for (const def of defs) {
    if (isSystemFieldType(def.type)) delete userFields[def.slug];
  }
  return { ...userFields, ...overrides };
};

export const mergeRecordCreate = async (ctx: MergeCtx, item: OperationPO, headCommit: CommitPO) => {
  const { db, timestamp } = ctx;
  const baseId = requireBaseId(item.baseId, item.operation);
  const fields = await applyComputedRecordFields(ctx, {
    baseId,
    mode: "create",
    fields: headCommit.fields,
  });
  // Validate against the CURRENT schema before any write (no transaction wraps
  // the merge, so an early insert would orphan a row if validation later fails).
  await assertMergedFieldsValid(ctx, baseId, fields);
  const recordId = id("rec");
  await db.insert(busabaseRecords).values({
    id: recordId,
    spaceId: getContextSpaceId(),
    baseId,
    headCommitId: item.headCommitId,
    parentRecordId: item.sourceRecordId,
    parentCommitId: item.sourceCommitId,
    status: "active",
    createdBy: resolveActorId(CURRENT_USER_ID),
    archivedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.update(busabaseCommits).set({ fields }).where(eq(busabaseCommits.id, item.headCommitId));
  await projectCommitFields({
    baseId,
    commitId: item.headCommitId,
    recordId,
    fields,
  });
  await syncRecordAssetUsages(baseId, recordId, headCommit.fields);
  await db
    .update(busabaseOperations)
    .set({ status: "merged", mergedRecordId: recordId, updatedAt: timestamp })
    .where(eq(busabaseOperations.id, item.id));
  ctx.mergedRecordIds.push(recordId);
};

export const mergeRecordUpdate = async (ctx: MergeCtx, item: OperationPO, headCommit: CommitPO) => {
  const { db, timestamp } = ctx;
  const baseId = requireBaseId(item.baseId, item.operation);
  const targetRecord = item.targetRecordId
    ? ctx.targetRecordsById.get(item.targetRecordId)
    : undefined;
  if (!targetRecord) {
    throw new Error(`Target record not found: ${item.targetRecordId}`);
  }

  const resolvedFields = ctx.resolvedRecordFields.get(item.id);

  const [currentCommit] = await db
    .select({ fields: busabaseCommits.fields })
    .from(busabaseCommits)
    .where(eq(busabaseCommits.id, targetRecord.headCommitId))
    .limit(1);
  const fields = await applyComputedRecordFields(ctx, {
    baseId,
    mode: "update",
    fields: resolvedFields ?? headCommit.fields,
    existing: currentCommit?.fields ?? undefined,
  });
  await assertMergedFieldsValid(ctx, baseId, fields);

  let headCommitId = item.headCommitId;
  if (resolvedFields) {
    headCommitId = id("cmt");
    await db.insert(busabaseCommits).values({
      id: headCommitId,
      baseId,
      targetType: "base",
      nodeId: null,
      operationId: item.id,
      parentCommitId: targetRecord.headCommitId,
      fields,
      operation: "record_update",
      message: `${headCommit.message} (auto-merged)`,
      author: headCommit.author,
      createdAt: timestamp,
    });
  } else {
    await db.update(busabaseCommits).set({ fields }).where(eq(busabaseCommits.id, headCommitId));
  }

  await db
    .update(busabaseRecords)
    .set({ headCommitId, updatedAt: timestamp })
    .where(eq(busabaseRecords.id, targetRecord.id));
  await projectCommitFields({
    baseId,
    commitId: headCommitId,
    recordId: targetRecord.id,
    fields,
  });
  await syncRecordAssetUsages(baseId, targetRecord.id, fields);
  await db
    .update(busabaseOperations)
    .set({ status: "merged", mergedRecordId: targetRecord.id, updatedAt: timestamp })
    .where(eq(busabaseOperations.id, item.id));
  ctx.mergedRecordIds.push(targetRecord.id);
};

export const mergeRecordDelete = async (
  ctx: MergeCtx,
  item: OperationPO,
  _headCommit: CommitPO,
) => {
  const { db, timestamp } = ctx;
  const targetRecord = item.targetRecordId
    ? ctx.targetRecordsById.get(item.targetRecordId)
    : undefined;
  if (!targetRecord) {
    throw new Error(`Target record not found: ${item.targetRecordId}`);
  }
  await db
    .update(busabaseRecords)
    .set({ status: "archived", archivedAt: timestamp, updatedAt: timestamp })
    .where(eq(busabaseRecords.id, targetRecord.id));
  // Soft-delete inbound links so they leave listRecordLinks while the target is
  // archived (mergeRecordRestore un-deletes them).
  await db
    .update(busabaseRecordLinks)
    .set({ deletedAt: timestamp, updatedAt: timestamp })
    .where(
      and(
        eq(busabaseRecordLinks.targetRecordId, targetRecord.id),
        isNull(busabaseRecordLinks.deletedAt),
      ),
    );
  await removeRecordAssetUsages(targetRecord.id);
  await db
    .update(busabaseOperations)
    .set({ status: "archived", mergedRecordId: targetRecord.id, updatedAt: timestamp })
    .where(eq(busabaseOperations.id, item.id));
  ctx.mergedRecordIds.push(targetRecord.id);
};

export const mergeRecordRestore = async (
  ctx: MergeCtx,
  item: OperationPO,
  _headCommit: CommitPO,
) => {
  const { db, timestamp } = ctx;
  const targetRecord = item.targetRecordId
    ? ctx.targetRecordsById.get(item.targetRecordId)
    : undefined;
  if (!targetRecord) {
    throw new Error(`Target record not found: ${item.targetRecordId}`);
  }
  await db
    .update(busabaseRecords)
    .set({ status: "active", archivedAt: null, updatedAt: timestamp })
    .where(eq(busabaseRecords.id, targetRecord.id));
  // Un-delete the inbound links that were soft-deleted when this record was
  // archived (mirror of mergeRecordDelete). Auto-number values are untouched —
  // restore intentionally preserves the original assigned number.
  await db
    .update(busabaseRecordLinks)
    .set({ deletedAt: null, updatedAt: timestamp })
    .where(eq(busabaseRecordLinks.targetRecordId, targetRecord.id));
  await db
    .update(busabaseOperations)
    .set({ status: "merged", mergedRecordId: targetRecord.id, updatedAt: timestamp })
    .where(eq(busabaseOperations.id, item.id));
  ctx.mergedRecordIds.push(targetRecord.id);
};
