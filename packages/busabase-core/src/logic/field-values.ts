import "server-only";

import { and, eq, inArray } from "drizzle-orm";
import { getContextSpaceId } from "../context";
import { getDb } from "../db";
import {
  busabaseBaseFields,
  busabaseCommits,
  busabaseFieldValues,
  busabaseOperations,
  busabaseRecordLinks,
  busabaseRecords,
} from "../db/schema";
import { id, now } from "./kernel";
import { normalizeFieldValue } from "./vo";

export { normalizeFieldValue } from "./vo";

export const getRelationRecordIds = (value: unknown) => {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.length > 0);
  }
  if (typeof value === "string" && value.length > 0) {
    return [value];
  }
  return [];
};

export const projectCommitFields = async (input: {
  baseId: string;
  commitId: string;
  changeRequestId?: string | null;
  operationId?: string | null;
  recordId?: string | null;
  fields: Record<string, unknown>;
}) => {
  const db = await getDb();
  const timestamp = now();
  const fieldRows = await db
    .select()
    .from(busabaseBaseFields)
    .where(eq(busabaseBaseFields.baseId, input.baseId));
  const fieldsBySlug = new Map(fieldRows.map((field) => [field.slug, field]));
  const sourceRecordId = input.recordId ?? null;
  const relationEntries = sourceRecordId
    ? Object.entries(input.fields).flatMap(([fieldSlug, value]) => {
        const field = fieldsBySlug.get(fieldSlug);
        if (!field || field.type !== "relation") {
          return [];
        }
        const targetBaseId =
          typeof field.options.targetBaseId === "string"
            ? field.options.targetBaseId
            : input.baseId;
        return getRelationRecordIds(value).map((targetRecordId, position) => ({
          id: id("rlk"),
          spaceId: getContextSpaceId(),
          baseId: input.baseId,
          fieldId: field.id,
          fieldSlug,
          sourceRecordId,
          targetBaseId,
          targetRecordId,
          commitId: input.commitId,
          position,
          createdAt: timestamp,
          updatedAt: timestamp,
        }));
      })
    : [];
  const relationTargetIds = [...new Set(relationEntries.map((link) => link.targetRecordId))];
  const existingRelationTargetIds =
    relationTargetIds.length > 0
      ? new Set(
          (
            await db
              .select({ id: busabaseRecords.id })
              .from(busabaseRecords)
              .where(inArray(busabaseRecords.id, relationTargetIds))
          ).map((record) => record.id),
        )
      : new Set<string>();
  const relationLinks = relationEntries.filter((link) =>
    existingRelationTargetIds.has(link.targetRecordId),
  );
  const projectedValues = Object.entries(input.fields).flatMap(([fieldSlug, value]) => {
    const field = fieldsBySlug.get(fieldSlug);
    if (!field) {
      return [];
    }
    return [
      {
        id: id("fvl"),
        baseId: input.baseId,
        spaceId: getContextSpaceId(),
        recordId: input.recordId ?? null,
        changeRequestId: input.changeRequestId ?? null,
        operationId: input.operationId ?? null,
        commitId: input.commitId,
        fieldId: field.id,
        fieldSlug,
        fieldType: field.type,
        ...normalizeFieldValue(value),
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ];
  });

  if (projectedValues.length === 0) {
    if (relationLinks.length === 0) {
      return;
    }
  } else {
    await db.insert(busabaseFieldValues).values(projectedValues);
  }

  if (input.recordId) {
    const relationFieldSlugs = Object.entries(input.fields)
      .filter(([fieldSlug]) => fieldsBySlug.get(fieldSlug)?.type === "relation")
      .map(([fieldSlug]) => fieldSlug);
    if (relationFieldSlugs.length > 0) {
      await db
        .delete(busabaseRecordLinks)
        .where(
          and(
            eq(busabaseRecordLinks.sourceRecordId, input.recordId),
            inArray(busabaseRecordLinks.fieldSlug, relationFieldSlugs),
          ),
        );
    }
  }

  if (relationLinks.length > 0) {
    await db.insert(busabaseRecordLinks).values(relationLinks);
  }
};

export const projectCommitFieldsIfMissing = async (input: {
  baseId: string;
  commitId: string;
  changeRequestId?: string | null;
  operationId?: string | null;
  recordId?: string | null;
}) => {
  const db = await getDb();
  const projectionFilter = input.recordId
    ? eq(busabaseFieldValues.recordId, input.recordId)
    : input.operationId
      ? eq(busabaseFieldValues.operationId, input.operationId)
      : input.changeRequestId
        ? eq(busabaseFieldValues.changeRequestId, input.changeRequestId)
        : null;
  if (!projectionFilter) {
    return;
  }

  const existingProjection = await db
    .select()
    .from(busabaseFieldValues)
    .where(projectionFilter)
    .limit(1);
  if (existingProjection.length > 0 && !input.recordId) {
    return;
  }

  const [commit] = await db
    .select()
    .from(busabaseCommits)
    .where(eq(busabaseCommits.id, input.commitId))
    .limit(1);
  if (!commit) {
    return;
  }

  if (existingProjection.length > 0 && input.recordId) {
    const relationFieldRows = await db
      .select()
      .from(busabaseBaseFields)
      .where(
        and(eq(busabaseBaseFields.baseId, input.baseId), eq(busabaseBaseFields.type, "relation")),
      );
    const hasRelationValue = relationFieldRows.some((field) => Boolean(commit.fields[field.slug]));
    if (!hasRelationValue) {
      return;
    }
  }

  await projectCommitFields({ ...input, fields: commit.fields });
};

export const ensureProjectionBackfill = async () => {
  const db = await getDb();
  const operationKindRows = await db.select().from(busabaseOperations);
  for (const item of operationKindRows) {
    if (!item.baseId) {
      continue;
    }
    await projectCommitFieldsIfMissing({
      baseId: item.baseId,
      commitId: item.headCommitId,
      changeRequestId: item.changeRequestId,
      operationId: item.id,
    });
  }

  const recordRows = await db.select().from(busabaseRecords);
  for (const record of recordRows) {
    await projectCommitFieldsIfMissing({
      baseId: record.baseId,
      commitId: record.headCommitId,
      recordId: record.id,
    });
  }
};
