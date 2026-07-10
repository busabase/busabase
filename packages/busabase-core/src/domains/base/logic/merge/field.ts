import "server-only";

import { and, asc, eq, gt, inArray, isNull, ne } from "drizzle-orm";
import { type iString, iStringToText } from "openlib/i18n/i-string";
import { getContextSpaceId } from "../../../../context";
import type { BaseFieldPO, CommitPO, OperationPO } from "../../../../db/schema";
import { busabaseBaseFields, busabaseBases, busabaseOperations } from "../../../../db/schema";
import type { MergeCtx } from "../../../../logic/cr-lifecycle";
import { id, requireBaseId } from "../../../../logic/kernel";

export const mergeBaseAddField = async (ctx: MergeCtx, item: OperationPO, headCommit: CommitPO) => {
  const { db, timestamp } = ctx;
  const baseId = requireBaseId(item.baseId, item.operation);
  const fieldData = headCommit.fields as {
    name?: iString;
    slug?: string;
    type?: import("busabase-contract/types").FieldType;
    required?: boolean;
    options?: Record<string, unknown>;
  };
  if (!fieldData.name || !fieldData.slug) {
    throw new Error(`base_add_field commit missing name or slug: ${item.id}`);
  }
  const fieldCount = await db
    .select()
    .from(busabaseBaseFields)
    .where(and(eq(busabaseBaseFields.baseId, baseId), isNull(busabaseBaseFields.deletedAt)))
    .then((rows) => rows.length);
  // Resolve spaceId: query the base row (most reliable across local + cloud).
  const [baseRow] = await db
    .select({ spaceId: busabaseBases.spaceId })
    .from(busabaseBases)
    .where(eq(busabaseBases.id, baseId))
    .limit(1);
  const spaceId = baseRow?.spaceId ?? getContextSpaceId();
  await db.insert(busabaseBaseFields).values({
    id: id("bsf"),
    baseId,
    spaceId,
    slug: fieldData.slug,
    name: iStringToText(fieldData.name),
    type: fieldData.type ?? "text",
    required: fieldData.required ?? false,
    position: fieldCount,
    options: (fieldData.options ?? {}) as BaseFieldPO["options"],
  });
  await db
    .update(busabaseOperations)
    .set({ status: "merged", updatedAt: timestamp })
    .where(eq(busabaseOperations.id, item.id));
};

export const mergeBaseDeleteField = async (
  ctx: MergeCtx,
  item: OperationPO,
  headCommit: CommitPO,
) => {
  const { db, timestamp } = ctx;
  const fieldData = headCommit.fields as {
    fieldId?: string;
    slug?: string;
  };
  if (!fieldData.fieldId) {
    throw new Error(`base_delete_field commit missing fieldId: ${item.id}`);
  }
  await db
    .update(busabaseBaseFields)
    .set({ deletedAt: timestamp })
    .where(eq(busabaseBaseFields.id, fieldData.fieldId));

  // Soft-delete the projected field values so they leave search/lookup results.
  const { busabaseFieldValues } = await import("../../../../db/schema");
  await db
    .update(busabaseFieldValues)
    .set({ deletedAt: timestamp })
    .where(
      and(
        eq(busabaseFieldValues.fieldId, fieldData.fieldId),
        isNull(busabaseFieldValues.deletedAt),
      ),
    );

  // Remove the deleted field from all view filters, sorts, and visibleFieldSlugs
  const { busabaseViews } = await import("../../../../db/schema");
  if (item.baseId && fieldData.slug) {
    const views = await db
      .select()
      .from(busabaseViews)
      .where(and(eq(busabaseViews.baseId, item.baseId), eq(busabaseViews.status, "active")));
    const deletedFieldId = fieldData.fieldId;
    for (const view of views) {
      const config = view.config as {
        filters?: Array<{ fieldSlug: string; fieldId?: string }>;
        sorts?: Array<{ fieldSlug: string; fieldId?: string }>;
        visibleFieldSlugs?: string[];
      };
      const slug = fieldData.slug;
      // Drop by stable fieldId when present (slug-reuse safe); fall back to slug
      // for legacy entries that predate the fieldId migration.
      const matchesDeleted = (entry: { fieldSlug: string; fieldId?: string }) =>
        entry.fieldId ? entry.fieldId === deletedFieldId : entry.fieldSlug === slug;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updatedConfig: any = {
        ...config,
        filters: config.filters?.filter((f) => !matchesDeleted(f)),
        sorts: config.sorts?.filter((s) => !matchesDeleted(s)),
        visibleFieldSlugs: config.visibleFieldSlugs?.filter((s) => s !== slug),
      };
      await db
        .update(busabaseViews)
        .set({ config: updatedConfig, updatedAt: timestamp })
        .where(eq(busabaseViews.id, view.id));
    }
  }

  await db
    .update(busabaseOperations)
    .set({ status: "merged", updatedAt: timestamp })
    .where(eq(busabaseOperations.id, item.id));
};

export const mergeBaseUpdateField = async (
  ctx: MergeCtx,
  item: OperationPO,
  headCommit: CommitPO,
) => {
  const { db, timestamp } = ctx;
  const fieldData = headCommit.fields as {
    fieldId?: string;
    name?: iString;
    required?: boolean;
    options?: Record<string, unknown>;
  };
  if (!fieldData.fieldId) {
    throw new Error(`base_update_field commit missing fieldId: ${item.id}`);
  }

  // When a field is being promoted to required, every active record must already
  // carry a non-empty value — otherwise the new constraint would be retroactively
  // violated. Block the merge and surface the offending record ids.
  if (fieldData.required === true) {
    const { ORPCError } = await import("@orpc/server");
    const [currentField] = await db
      .select()
      .from(busabaseBaseFields)
      .where(eq(busabaseBaseFields.id, fieldData.fieldId))
      .limit(1);
    if (currentField && !currentField.required) {
      const { busabaseFieldValues } = await import("../../../../db/schema");
      const { busabaseRecords } = await import("../../../../db/schema");
      const { isEmptyFieldValue } = await import("../../field-types");
      // Scan active records in bounded id-keyset chunks (loading each chunk's
      // values via inArray) instead of the whole base + whole column at once.
      const GUARD_SCAN_CHUNK = 500;
      const offending: string[] = [];
      let cursor = "";
      for (;;) {
        const recordChunk = await db
          .select({ id: busabaseRecords.id })
          .from(busabaseRecords)
          .where(
            and(
              eq(busabaseRecords.baseId, currentField.baseId),
              eq(busabaseRecords.status, "active"),
              gt(busabaseRecords.id, cursor),
            ),
          )
          .orderBy(asc(busabaseRecords.id))
          .limit(GUARD_SCAN_CHUNK);
        if (recordChunk.length === 0) break;
        const recordIds = recordChunk.map((record) => record.id);
        const valueRows = await db
          .select()
          .from(busabaseFieldValues)
          .where(
            and(
              eq(busabaseFieldValues.fieldId, fieldData.fieldId),
              isNull(busabaseFieldValues.deletedAt),
              isNull(busabaseFieldValues.changeRequestId),
              inArray(busabaseFieldValues.recordId, recordIds),
            ),
          );
        const valueByRecord = new Map(valueRows.map((row) => [row.recordId, row]));
        for (const record of recordChunk) {
          const row = valueByRecord.get(record.id);
          const raw = row
            ? (row.valueJson ?? row.valueText ?? row.valueNumber ?? row.valueBool ?? null)
            : null;
          if (isEmptyFieldValue(raw)) {
            offending.push(record.id);
          }
        }
        const last = recordChunk[recordChunk.length - 1];
        if (!last || recordChunk.length < GUARD_SCAN_CHUNK) break;
        cursor = last.id;
      }
      if (offending.length > 0) {
        throw new ORPCError("BAD_REQUEST", {
          message: `Cannot make "${currentField.slug}" required — ${offending.length} active record${
            offending.length === 1 ? "" : "s"
          } ${offending.length === 1 ? "has" : "have"} no value. Fill them in first.`,
          data: { fieldId: fieldData.fieldId, recordIds: offending },
        });
      }
    }
  }

  // When choices are removed from a select/multiselect field, any active record
  // still referencing a removed choice id would be left with a dangling value.
  // Block the merge so the user consciously resolves those records first.
  if (fieldData.options && Array.isArray((fieldData.options as { choices?: unknown }).choices)) {
    const { ORPCError } = await import("@orpc/server");
    const [currentField] = await db
      .select()
      .from(busabaseBaseFields)
      .where(eq(busabaseBaseFields.id, fieldData.fieldId))
      .limit(1);
    if (currentField && (currentField.type === "select" || currentField.type === "multiselect")) {
      const nextChoiceIds = new Set(
        ((fieldData.options as { choices?: Array<{ id: string }> }).choices ?? []).map((c) => c.id),
      );
      const prevChoiceIds = new Set((currentField.options.choices ?? []).map((c) => c.id));
      const removed = [...prevChoiceIds].filter((cid) => !nextChoiceIds.has(cid));
      if (removed.length > 0) {
        const { busabaseFieldValues } = await import("../../../../db/schema");
        const { busabaseRecords } = await import("../../../../db/schema");
        // Scan the projected values in bounded id-keyset chunks rather than the
        // whole column at once.
        const GUARD_SCAN_CHUNK = 500;
        const removedSet = new Set(removed);
        const affected = new Set<string>();
        let cursor = "";
        for (;;) {
          const valueRows = await db
            .select({
              id: busabaseFieldValues.id,
              recordId: busabaseFieldValues.recordId,
              valueJson: busabaseFieldValues.valueJson,
              valueText: busabaseFieldValues.valueText,
              status: busabaseRecords.status,
            })
            .from(busabaseFieldValues)
            .innerJoin(busabaseRecords, eq(busabaseFieldValues.recordId, busabaseRecords.id))
            .where(
              and(
                eq(busabaseFieldValues.fieldId, fieldData.fieldId),
                isNull(busabaseFieldValues.deletedAt),
                isNull(busabaseFieldValues.changeRequestId),
                gt(busabaseFieldValues.id, cursor),
              ),
            )
            .orderBy(asc(busabaseFieldValues.id))
            .limit(GUARD_SCAN_CHUNK);
          if (valueRows.length === 0) break;
          for (const row of valueRows) {
            if (row.status !== "active" || !row.recordId) continue;
            const raw = row.valueJson ?? row.valueText ?? null;
            const ids = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
            if (ids.some((cid) => typeof cid === "string" && removedSet.has(cid))) {
              affected.add(row.recordId);
            }
          }
          const last = valueRows[valueRows.length - 1];
          if (!last || valueRows.length < GUARD_SCAN_CHUNK) break;
          cursor = last.id;
        }
        if (affected.size > 0) {
          throw new ORPCError("BAD_REQUEST", {
            message: `Cannot remove ${removed.length} choice${
              removed.length === 1 ? "" : "s"
            } from "${currentField.slug}" — ${affected.size} active record${
              affected.size === 1 ? "" : "s"
            } still reference ${removed.length === 1 ? "it" : "them"}. Reassign those records first.`,
            data: {
              fieldId: fieldData.fieldId,
              removedChoiceIds: removed,
              affectedRecordIds: [...affected],
            },
          });
        }
      }
    }
  }

  const updateSet: Record<string, unknown> = {};
  if (fieldData.name !== undefined) updateSet.name = iStringToText(fieldData.name);
  if (fieldData.required !== undefined) updateSet.required = fieldData.required;
  if (fieldData.options !== undefined) updateSet.options = fieldData.options;

  if (Object.keys(updateSet).length > 0) {
    await db
      .update(busabaseBaseFields)
      .set(updateSet as Partial<BaseFieldPO>)
      .where(eq(busabaseBaseFields.id, fieldData.fieldId));
  }
  await db
    .update(busabaseOperations)
    .set({ status: "merged", updatedAt: timestamp })
    .where(eq(busabaseOperations.id, item.id));
};

export const mergeBaseConvertField = async (
  ctx: MergeCtx,
  item: OperationPO,
  headCommit: CommitPO,
) => {
  const { db, timestamp } = ctx;
  const fieldData = headCommit.fields as {
    fieldId?: string;
    slug?: string;
    fromType?: import("busabase-contract/types").FieldType;
    newType?: import("busabase-contract/types").FieldType;
    selectChoiceMode?: "auto_create" | "null_on_missing";
    choices?: Array<{ id: string; name: string; color?: string }>;
  };
  if (!fieldData.fieldId || !fieldData.newType || !fieldData.fromType) {
    throw new Error(`base_convert_field commit missing required fields: ${item.id}`);
  }

  const { busabaseFieldValues, busabaseCommits, busabaseRecords } = await import(
    "../../../../db/schema"
  );
  const { convertFieldValue } = await import("../../utils/field-conversion");
  const { normalizeFieldValue } = await import("../../../../logic/vo");

  // Resolve the field's slug — the authoritative record data is keyed by slug in
  // each record's head-commit `fields` JSON, and we rewrite that below.
  const [fieldRow] = await db
    .select({ slug: busabaseBaseFields.slug, baseId: busabaseBaseFields.baseId })
    .from(busabaseBaseFields)
    .where(eq(busabaseBaseFields.id, fieldData.fieldId))
    .limit(1);
  const fieldSlug = fieldRow?.slug ?? fieldData.slug ?? null;

  // Field-value scan is chunked (id keyset) so converting a field on a large base
  // never loads the whole column — nor holds every converted value — in memory.
  const CONVERT_SCAN_CHUNK = 500;
  const valueScopeFilter = and(
    eq(busabaseFieldValues.fieldId, fieldData.fieldId),
    isNull(busabaseFieldValues.changeRequestId),
  );
  const scanChunk = (cursor: string) =>
    db
      .select()
      .from(busabaseFieldValues)
      .where(and(valueScopeFilter, gt(busabaseFieldValues.id, cursor)))
      .orderBy(asc(busabaseFieldValues.id))
      .limit(CONVERT_SCAN_CHUNK);

  // Pass 1 (auto_create only): collect one choice per distinct value across the
  // WHOLE column, scanned in bounded chunks. Choice ids follow discovery order
  // (now deterministic by id); each value still resolves to its own choice by
  // name in the conversion below, so the mapping is unchanged.
  let newChoices = fieldData.choices ?? [];
  if (
    (fieldData.newType === "select" || fieldData.newType === "multiselect") &&
    fieldData.selectChoiceMode === "auto_create"
  ) {
    const existingNames = new Set(newChoices.map((c) => c.name));
    const extra: typeof newChoices = [];
    let cursor = "";
    for (;;) {
      const chunk = await scanChunk(cursor);
      if (chunk.length === 0) break;
      for (const row of chunk) {
        const raw = row.valueJson ?? row.valueText ?? row.valueNumber ?? row.valueBool ?? null;
        if (raw === null || raw === undefined) continue;
        const text = typeof raw === "string" ? raw : String(raw);
        if (text && !existingNames.has(text)) {
          existingNames.add(text);
          extra.push({ id: `auto_${extra.length + newChoices.length}`, name: text });
        }
      }
      const last = chunk[chunk.length - 1];
      if (!last || chunk.length < CONVERT_SCAN_CHUNK) break;
      cursor = last.id;
    }
    newChoices = [...newChoices, ...extra];
  }

  // Update the field type (and clear/set options)
  const newOptions: BaseFieldPO["options"] =
    fieldData.newType === "select" || fieldData.newType === "multiselect"
      ? { choices: newChoices }
      : {};
  await db
    .update(busabaseBaseFields)
    .set({ type: fieldData.newType, options: newOptions })
    .where(eq(busabaseBaseFields.id, fieldData.fieldId));

  // Rewrite the authoritative record data for one chunk. Records are hydrated from
  // their head commit's `fields` JSON (NOT from busabase_field_values), so without
  // this the displayed/edited value would keep the pre-conversion representation
  // while the index held the converted one — e.g. a select cell holding a raw label
  // instead of a choice id. Batched reads (was 2 SELECTs per record → 3N queries);
  // per-commit writes, since each record's head commit gets a distinct value.
  const rewriteCommitFields = async (convertedByRecord: Map<string, unknown>) => {
    if (!fieldSlug || convertedByRecord.size === 0) return;
    const recordIds = [...convertedByRecord.keys()];
    const recordRows = await db
      .select({ id: busabaseRecords.id, headCommitId: busabaseRecords.headCommitId })
      .from(busabaseRecords)
      .where(inArray(busabaseRecords.id, recordIds));
    const headCommitIdByRecord = new Map(recordRows.map((row) => [row.id, row.headCommitId]));
    const headCommitIds = [...new Set(recordRows.map((row) => row.headCommitId))];
    const commitRows =
      headCommitIds.length > 0
        ? await db
            .select({ id: busabaseCommits.id, fields: busabaseCommits.fields })
            .from(busabaseCommits)
            .where(inArray(busabaseCommits.id, headCommitIds))
        : [];
    const fieldsByCommit = new Map(commitRows.map((row) => [row.id, row.fields]));
    for (const [recordId, converted] of convertedByRecord) {
      const headCommitId = headCommitIdByRecord.get(recordId);
      if (!headCommitId) continue;
      const fields = fieldsByCommit.get(headCommitId);
      if (!fields) continue;
      await db
        .update(busabaseCommits)
        .set({ fields: { ...fields, [fieldSlug]: converted } })
        .where(eq(busabaseCommits.id, headCommitId));
    }
  };

  // Pass 2: convert each value → update its projected row → rewrite that record's
  // commit, all in bounded id-keyset chunks (updates don't touch id, so the keyset
  // stays stable). Peak memory is one chunk, not the whole column. Each record has
  // exactly one record-level value row for this field, so it lands in one chunk.
  let convertCursor = "";
  for (;;) {
    const chunk = await scanChunk(convertCursor);
    if (chunk.length === 0) break;
    const convertedByRecord = new Map<string, unknown>();
    for (const row of chunk) {
      const raw = row.valueJson ?? row.valueText ?? row.valueNumber ?? row.valueBool ?? null;
      let converted: unknown = null;
      if (raw !== null && raw !== undefined) {
        try {
          converted = convertFieldValue(raw, fieldData.fromType, fieldData.newType, {
            choices: newChoices,
          });
        } catch {
          converted = null;
        }
      }
      if (row.recordId) convertedByRecord.set(row.recordId, converted);
      const norm = normalizeFieldValue(converted);
      await db
        .update(busabaseFieldValues)
        .set({
          fieldType: fieldData.newType,
          valueText: norm.valueText ?? null,
          valueNumber: norm.valueNumber ?? null,
          valueBool: norm.valueBool ?? null,
          valueDate: norm.valueDate ? new Date(norm.valueDate) : null,
          valueJson: norm.valueJson !== undefined ? norm.valueJson : null,
          updatedAt: timestamp,
        })
        .where(eq(busabaseFieldValues.id, row.id));
    }
    await rewriteCommitFields(convertedByRecord);
    const last = chunk[chunk.length - 1];
    if (!last || chunk.length < CONVERT_SCAN_CHUNK) break;
    convertCursor = last.id;
  }

  await db
    .update(busabaseOperations)
    .set({ status: "merged", updatedAt: timestamp })
    .where(eq(busabaseOperations.id, item.id));
};

export const mergeBaseReorderFields = async (
  ctx: MergeCtx,
  item: OperationPO,
  headCommit: CommitPO,
) => {
  const { db, timestamp } = ctx;
  const baseId = requireBaseId(item.baseId, item.operation);
  const fieldData = headCommit.fields as { fieldIds?: string[] };
  if (!fieldData.fieldIds || fieldData.fieldIds.length === 0) {
    throw new Error(`base_reorder_fields commit missing fieldIds: ${item.id}`);
  }
  // Validate that all fieldIds belong to this base to prevent cross-base corruption.
  const { ORPCError } = await import("@orpc/server");
  const existingFields = await db
    .select({ id: busabaseBaseFields.id, baseId: busabaseBaseFields.baseId })
    .from(busabaseBaseFields)
    .where(and(eq(busabaseBaseFields.baseId, baseId), isNull(busabaseBaseFields.deletedAt)));
  const validFieldIds = new Set(existingFields.map((f) => f.id));
  const crossBaseIds = fieldData.fieldIds.filter((fid) => !validFieldIds.has(fid));
  if (crossBaseIds.length > 0) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Cannot reorder fields — ${crossBaseIds.length} fieldId(s) do not belong to base "${baseId}": ${crossBaseIds.join(", ")}`,
      data: { baseId, invalidFieldIds: crossBaseIds },
    });
  }
  for (let i = 0; i < fieldData.fieldIds.length; i++) {
    await db
      .update(busabaseBaseFields)
      .set({ position: i })
      .where(eq(busabaseBaseFields.id, fieldData.fieldIds[i]));
  }
  await db
    .update(busabaseOperations)
    .set({ status: "merged", updatedAt: timestamp })
    .where(eq(busabaseOperations.id, item.id));
};

export const mergeBaseRestoreField = async (
  ctx: MergeCtx,
  item: OperationPO,
  headCommit: CommitPO,
) => {
  const { db, timestamp } = ctx;
  const fieldData = headCommit.fields as { fieldId?: string };
  if (!fieldData.fieldId) {
    throw new Error(`base_restore_field commit missing fieldId: ${item.id}`);
  }

  // Guard slug reuse: a field's slug is freed once it is deleted, so a new active
  // field can take it. Restoring the old field would then leave two active fields
  // with the same slug — fail with a clear message instead (mirrors the base/node
  // restore slug-collision guards).
  const [restoring] = await db
    .select({ baseId: busabaseBaseFields.baseId, slug: busabaseBaseFields.slug })
    .from(busabaseBaseFields)
    .where(eq(busabaseBaseFields.id, fieldData.fieldId))
    .limit(1);
  if (restoring) {
    const [slugTaken] = await db
      .select({ id: busabaseBaseFields.id })
      .from(busabaseBaseFields)
      .where(
        and(
          eq(busabaseBaseFields.baseId, restoring.baseId),
          eq(busabaseBaseFields.slug, restoring.slug),
          isNull(busabaseBaseFields.deletedAt),
          ne(busabaseBaseFields.id, fieldData.fieldId),
        ),
      )
      .limit(1);
    if (slugTaken) {
      const { ORPCError } = await import("@orpc/server");
      throw new ORPCError("CONFLICT", {
        message: `Cannot restore: the field slug "${restoring.slug}" is now used by another field. Rename it first.`,
        data: { fieldId: fieldData.fieldId, slug: restoring.slug },
      });
    }
  }

  await db
    .update(busabaseBaseFields)
    .set({ deletedAt: null })
    .where(eq(busabaseBaseFields.id, fieldData.fieldId));
  const { busabaseFieldValues } = await import("../../../../db/schema");
  await db
    .update(busabaseFieldValues)
    .set({ deletedAt: null })
    .where(eq(busabaseFieldValues.fieldId, fieldData.fieldId));
  await db
    .update(busabaseOperations)
    .set({ status: "merged", updatedAt: timestamp })
    .where(eq(busabaseOperations.id, item.id));
};
