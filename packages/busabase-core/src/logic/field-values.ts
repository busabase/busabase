import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { getContextSpaceId } from "../context";
import { getDb } from "../db";
import {
  busabaseBaseFields,
  busabaseFieldValues,
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
  /** When merging inside a transaction, the tx executor — avoids deadlocking the
   *  single pglite connection by NOT re-acquiring the getDb() singleton. */
  tx?: Awaited<ReturnType<typeof getDb>>;
}) => {
  const db = input.tx ?? (await getDb());
  const timestamp = now();
  const fieldRows = await db
    .select()
    .from(busabaseBaseFields)
    .where(and(eq(busabaseBaseFields.baseId, input.baseId), isNull(busabaseBaseFields.deletedAt)));
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
        ...normalizeFieldValue(value, field.type),
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ];
  });

  // A record-level projection is a full REPLACE of the record's current values.
  // Without this, every update appends a new row-set and leaves the previous
  // version's values behind (no unique index dedups them), corrupting record
  // search (listRecordsByFieldText) and the "make field required" / "remove
  // choice" schema-change guards — all of which read recordId rows expecting the
  // single CURRENT value. Tombstoned rows (deletedAt set by a field delete) are
  // preserved so a later field restore can bring those values back.
  if (input.recordId) {
    await db
      .delete(busabaseFieldValues)
      .where(
        and(
          eq(busabaseFieldValues.recordId, input.recordId),
          isNull(busabaseFieldValues.deletedAt),
        ),
      );
  }

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

// NOTE: The projection backfill (ensureProjectionBackfill /
// projectCommitFieldsIfMissing) was removed. Every write projects at write time
// via projectCommitFields, and the seed (applySeedScenario) resolves its own
// forward-reference relation links with a targeted re-projection of the records
// it just wrote — so there is no need for a whole-space repair sweep, on the
// request path or anywhere else.
