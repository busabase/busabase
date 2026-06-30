import "server-only";

import { and, eq, isNull, ne } from "drizzle-orm";
import { getContextSpaceId } from "../../../../context";
import type { BaseFieldPO, CommitPO, OperationPO } from "../../../../db/schema";
import { busabaseBaseFields, busabaseBases, busabaseOperations } from "../../../../db/schema";
import type { MergeCtx } from "../../../../logic/cr-lifecycle";
import { id, requireBaseId } from "../../../../logic/kernel";

export const mergeBaseAddField = async (ctx: MergeCtx, item: OperationPO, headCommit: CommitPO) => {
  const { db, timestamp } = ctx;
  const baseId = requireBaseId(item.baseId, item.operation);
  const fieldData = headCommit.fields as {
    name?: string;
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
    name: fieldData.name,
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
    name?: string;
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
      // Active records in this base.
      const activeRecords = await db
        .select({ id: busabaseRecords.id })
        .from(busabaseRecords)
        .where(
          and(
            eq(busabaseRecords.baseId, currentField.baseId),
            eq(busabaseRecords.status, "active"),
          ),
        );
      const valueRows = await db
        .select()
        .from(busabaseFieldValues)
        .where(
          and(
            eq(busabaseFieldValues.fieldId, fieldData.fieldId),
            isNull(busabaseFieldValues.deletedAt),
            isNull(busabaseFieldValues.changeRequestId),
          ),
        );
      const valueByRecord = new Map(valueRows.map((row) => [row.recordId, row]));
      const offending: string[] = [];
      for (const record of activeRecords) {
        const row = valueByRecord.get(record.id);
        const raw = row
          ? (row.valueJson ?? row.valueText ?? row.valueNumber ?? row.valueBool ?? null)
          : null;
        if (isEmptyFieldValue(raw)) {
          offending.push(record.id);
        }
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
        const valueRows = await db
          .select({
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
            ),
          );
        const removedSet = new Set(removed);
        const affected = new Set<string>();
        for (const row of valueRows) {
          if (row.status !== "active" || !row.recordId) continue;
          const raw = row.valueJson ?? row.valueText ?? null;
          const ids = Array.isArray(raw) ? raw : raw == null ? [] : [raw];
          if (ids.some((cid) => typeof cid === "string" && removedSet.has(cid))) {
            affected.add(row.recordId);
          }
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
  if (fieldData.name !== undefined) updateSet.name = fieldData.name;
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

  // Load record-level values for this field
  const valueRows = await db
    .select()
    .from(busabaseFieldValues)
    .where(
      and(
        eq(busabaseFieldValues.fieldId, fieldData.fieldId),
        isNull(busabaseFieldValues.changeRequestId),
      ),
    );

  // Compute new choices for auto_create mode
  let newChoices = fieldData.choices ?? [];
  if (
    (fieldData.newType === "select" || fieldData.newType === "multiselect") &&
    fieldData.selectChoiceMode === "auto_create"
  ) {
    const existingNames = new Set(newChoices.map((c) => c.name));
    const extra: typeof newChoices = [];
    for (const row of valueRows) {
      const raw = row.valueJson ?? row.valueText ?? row.valueNumber ?? row.valueBool ?? null;
      if (raw === null || raw === undefined) continue;
      const text = typeof raw === "string" ? raw : String(raw);
      if (text && !existingNames.has(text)) {
        existingNames.add(text);
        extra.push({ id: `auto_${extra.length + newChoices.length}`, name: text });
      }
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

  // Migrate field values: convert each row's stored value to the new type, and
  // remember the converted value per record so we can rewrite the authoritative
  // record data (commit.fields) below.
  const convertedByRecord = new Map<string, unknown>();
  for (const row of valueRows) {
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

  // Rewrite the authoritative record data. Records are hydrated from their head
  // commit's `fields` JSON (NOT from busabase_field_values), so without this the
  // displayed/edited value would keep the pre-conversion representation while the
  // index held the converted one — e.g. a select cell holding a raw label instead
  // of a choice id. Update each affected record's head commit in lockstep.
  if (fieldSlug && convertedByRecord.size > 0) {
    for (const [recordId, converted] of convertedByRecord) {
      const [record] = await db
        .select({ headCommitId: busabaseRecords.headCommitId })
        .from(busabaseRecords)
        .where(eq(busabaseRecords.id, recordId))
        .limit(1);
      if (!record) continue;
      const [commit] = await db
        .select({ fields: busabaseCommits.fields })
        .from(busabaseCommits)
        .where(eq(busabaseCommits.id, record.headCommitId))
        .limit(1);
      if (!commit) continue;
      await db
        .update(busabaseCommits)
        .set({ fields: { ...commit.fields, [fieldSlug]: converted } })
        .where(eq(busabaseCommits.id, record.headCommitId));
    }
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
