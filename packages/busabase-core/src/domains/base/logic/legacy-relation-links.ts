import "server-only";

import { and, eq, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { getContextSpaceId } from "../../../context";
import type { getDb } from "../../../db";
import {
  busabaseBaseFields,
  busabaseFieldValues,
  busabaseRecordLinks,
  busabaseRecords,
} from "../../../db/schema";
import { buildBaseVisibilityExists } from "../../../logic/node-acl";
import { getRelationRecordIds } from "../utils/relation-record-ids";

/**
 * Old encoded arrays could not pass the record-link FK; interrupted writes
 * can also leave only some targets indexed. Recover these from CURRENT head
 * field projections, never from CRs or obsolete commits. Base/slug predicates
 * use field_values_base_field_idx; forward reads additionally use record_idx.
 * Source and target scopes are a union, allowing Lookup to recover both
 * directions once. Reverse callers must supply target IDs: SQL then discards
 * unrelated projections before decoding and probing per-source link indexes.
 * Substring matches may be false positives; callers still match decoded IDs.
 * This is read compatibility, with no writes and no whole-space repair sweep.
 */
export const legacyRelationLinks = async (
  db: Awaited<ReturnType<typeof getDb>>,
  fields: ReadonlyArray<{ id: string; baseId: string; slug: string }>,
  sourceRecordIds?: string[],
  targetRecordIds?: string[],
) => {
  if (
    !fields.length ||
    ((sourceRecordIds !== undefined || targetRecordIds !== undefined) &&
      !sourceRecordIds?.length &&
      !targetRecordIds?.length)
  )
    return [];
  const rows = await db
    .select({
      sourceRecordId: busabaseRecords.id,
      fieldId: busabaseBaseFields.id,
      fieldSlug: busabaseBaseFields.slug,
      value: busabaseFieldValues.valueJson,
      createdAt: busabaseFieldValues.createdAt,
      sourceActive: sql<boolean>`${busabaseRecords.status} = 'active' and ${busabaseRecords.archivedAt} is null`,
    })
    .from(busabaseFieldValues)
    .innerJoin(
      busabaseRecords,
      and(
        eq(busabaseRecords.id, busabaseFieldValues.recordId),
        eq(busabaseRecords.headCommitId, busabaseFieldValues.commitId),
      ),
    )
    .innerJoin(
      busabaseBaseFields,
      and(
        eq(busabaseBaseFields.id, busabaseFieldValues.fieldId),
        eq(busabaseBaseFields.baseId, busabaseFieldValues.baseId),
        eq(busabaseBaseFields.slug, busabaseFieldValues.fieldSlug),
      ),
    )
    .where(
      and(
        eq(busabaseFieldValues.spaceId, getContextSpaceId()),
        eq(busabaseRecords.spaceId, getContextSpaceId()),
        sourceRecordIds ? undefined : eq(busabaseRecords.status, "active"),
        sourceRecordIds ? undefined : isNull(busabaseRecords.archivedAt),
        isNull(busabaseFieldValues.deletedAt),
        isNull(busabaseBaseFields.deletedAt),
        eq(busabaseBaseFields.type, "relation"),
        or(
          ...fields.map((field) =>
            and(
              eq(busabaseFieldValues.baseId, field.baseId),
              eq(busabaseFieldValues.fieldSlug, field.slug),
              eq(busabaseFieldValues.fieldId, field.id),
            ),
          ),
        ),
        sourceRecordIds || targetRecordIds
          ? or(
              sourceRecordIds?.length
                ? inArray(busabaseFieldValues.recordId, sourceRecordIds)
                : undefined,
              targetRecordIds?.length
                ? and(
                    eq(busabaseRecords.status, "active"),
                    isNull(busabaseRecords.archivedAt),
                    or(
                      ...targetRecordIds.map(
                        (id) => sql`strpos(${busabaseFieldValues.valueJson}::text, ${id}) > 0`,
                      ),
                    ),
                  )
                : undefined,
            )
          : undefined,
        // Compare each projected target with all indexed targets (including
        // tombstones). A sibling index must not hide a partially missing index.
        // JSON containment also skips healthy plain-ID projections in SQL.
        sql`case jsonb_typeof(${busabaseFieldValues.valueJson})
          when 'array' then jsonb_array_length(${busabaseFieldValues.valueJson}) > 0
          when 'string' then ${busabaseFieldValues.valueJson} <> '""'::jsonb
          else false end`,
        sql`not (${busabaseFieldValues.valueJson} <@ coalesce((
          select jsonb_agg(indexed.target_record_id)
          from ${busabaseRecordLinks} indexed
          where indexed.source_record_id = ${busabaseFieldValues.recordId}
            and indexed.field_id = ${busabaseFieldValues.fieldId}
            and indexed.space_id = ${busabaseFieldValues.spaceId}
        ), '[]'::jsonb))`,
        buildBaseVisibilityExists(db, busabaseFieldValues.baseId),
      ),
    );
  const links = rows.flatMap(({ value, ...row }) =>
    getRelationRecordIds(value).map((targetRecordId, position) => ({
      ...row,
      targetRecordId,
      position,
    })),
  );
  if (!links.length) return [];
  // A retained field projection is not proof of a live link: archiving a
  // target tombstones its inbound links without rewriting source values.
  // Recover missing indexes only, never deliberately removed relationships.
  const targets = await db
    .select({ id: busabaseRecords.id })
    .from(busabaseRecords)
    .where(
      and(
        inArray(busabaseRecords.id, [...new Set(links.map((link) => link.targetRecordId))]),
        eq(busabaseRecords.spaceId, getContextSpaceId()),
        eq(busabaseRecords.status, "active"),
        isNull(busabaseRecords.archivedAt),
      ),
    );
  const removed = await db
    .select({
      sourceRecordId: busabaseRecordLinks.sourceRecordId,
      fieldId: busabaseRecordLinks.fieldId,
      targetRecordId: busabaseRecordLinks.targetRecordId,
    })
    .from(busabaseRecordLinks)
    .where(
      and(
        eq(busabaseRecordLinks.spaceId, getContextSpaceId()),
        inArray(busabaseRecordLinks.sourceRecordId, [
          ...new Set(links.map((link) => link.sourceRecordId)),
        ]),
        inArray(busabaseRecordLinks.fieldId, [...new Set(links.map((link) => link.fieldId))]),
        isNotNull(busabaseRecordLinks.deletedAt),
      ),
    );
  const linkKey = (link: { sourceRecordId: string; fieldId: string; targetRecordId: string }) =>
    JSON.stringify([link.sourceRecordId, link.fieldId, link.targetRecordId]);
  const removedKeys = new Set(removed.map(linkKey));
  const existingIds = new Set(targets.map((target) => target.id));
  return links.filter(
    (link) => existingIds.has(link.targetRecordId) && !removedKeys.has(linkKey(link)),
  );
};

export type LegacyRelationLink = Awaited<ReturnType<typeof legacyRelationLinks>>[number];
