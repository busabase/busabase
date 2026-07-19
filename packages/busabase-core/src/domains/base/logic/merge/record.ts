import "server-only";

import { ORPCError } from "@orpc/server";
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
    const first = errors[0];
    throw new ORPCError("BAD_REQUEST", {
      message: `required field missing after schema change: ${first.slug}`,
      data: { errors },
    });
  }
};

/** The record this already-approved operation targets is gone by merge time
 *  (e.g. purged after the CR was created but before it was reviewed) — a
 *  legitimate race reachable through normal usage, not an internal invariant
 *  violation. The primary gate for this is prevalidateMergeableOperations in
 *  cr-lifecycle.ts; this is a defensive re-check in the same spirit. */
const targetRecordNotFound = (recordId: string | null) =>
  new ORPCError("NOT_FOUND", { message: `Target record not found: ${recordId}` });

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
  // Keep only values for slugs the base actually defines — this is what makes
  // field-rules.ts's documented "unknown field slugs are ignored (dropped)"
  // contract true for the record content itself, not just the search-index
  // projection (projectCommitFields already filters unknown slugs there; this
  // mirrors that here so a client-supplied ghost field never survives into the
  // merged commit/record). System-computed fields are always server-owned, so
  // any client-submitted value for them is discarded too — `overrides` below
  // supplies the real value.
  const defsBySlug = new Map(defs.map((def) => [def.slug, def]));
  const userFields: Record<string, unknown> = {};
  for (const [slug, value] of Object.entries(args.fields)) {
    const def = defsBySlug.get(slug);
    if (!def || isSystemFieldType(def.type)) continue;
    userFields[slug] = value;
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
    tx: db,
  });
  await syncRecordAssetUsages(baseId, recordId, headCommit.fields, db);
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
    throw targetRecordNotFound(item.targetRecordId);
  }

  const resolvedFields = ctx.resolvedRecordFields.get(item.id);

  const [currentCommit] = await db
    .select({ fields: busabaseCommits.fields })
    .from(busabaseCommits)
    .where(eq(busabaseCommits.id, targetRecord.headCommitId))
    .limit(1);
  // When no concurrent edit was detected, `resolvedFields` is unset — the 3-way
  // merge branch in cr-lifecycle.ts only runs when the record moved since this
  // operation's base commit. But `headCommit.fields` here is just THIS
  // operation's submitted delta: createUpdateChangeRequest / reviseOperation
  // store only whatever fields the caller actually sent, so an omitted key
  // means "leave it alone", not "clear it" (an explicit `null` still clears —
  // both are own keys on the delta object, `undefined` never is). Carry the
  // record's current full field set forward and let the delta's keys override
  // on top of it, mirroring exactly what threeWayMergeFields already does when
  // it DOES run. Without this, projectCommitFields' full REPLACE of the
  // record's field-value rows (below) used only the delta, silently deleting
  // every field the caller didn't resubmit.
  const fields = await applyComputedRecordFields(ctx, {
    baseId,
    mode: "update",
    fields: resolvedFields ?? { ...(currentCommit?.fields ?? {}), ...headCommit.fields },
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
    tx: db,
  });
  await syncRecordAssetUsages(baseId, targetRecord.id, fields, db);
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
    throw targetRecordNotFound(item.targetRecordId);
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
  await removeRecordAssetUsages(targetRecord.id, db);
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
    throw targetRecordNotFound(item.targetRecordId);
  }
  await db
    .update(busabaseRecords)
    .set({ status: "active", archivedAt: null, updatedAt: timestamp })
    .where(eq(busabaseRecords.id, targetRecord.id));
  // Un-delete ONLY the inbound links that were soft-deleted by this record's
  // archive — matched by the archive timestamp (mergeRecordDelete stamps both the
  // record's archivedAt and the links' deletedAt with the same merge timestamp).
  // A blanket un-delete would resurrect links removed for other reasons (e.g. a
  // source-side unlink before the archive). Mirrors mergeBaseRestore's technique.
  // Auto-number values are untouched — restore preserves the original number.
  if (targetRecord.archivedAt) {
    await db
      .update(busabaseRecordLinks)
      .set({ deletedAt: null, updatedAt: timestamp })
      .where(
        and(
          eq(busabaseRecordLinks.targetRecordId, targetRecord.id),
          eq(busabaseRecordLinks.deletedAt, targetRecord.archivedAt),
        ),
      );
  }
  await db
    .update(busabaseOperations)
    .set({ status: "merged", mergedRecordId: targetRecord.id, updatedAt: timestamp })
    .where(eq(busabaseOperations.id, item.id));
  ctx.mergedRecordIds.push(targetRecord.id);
};
