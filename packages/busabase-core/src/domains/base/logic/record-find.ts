import "server-only";

import { ORPCError } from "@orpc/server";
import {
  COMMON_RECORD_FIND_FIELD_TYPES,
  getRecordFindFieldSupport,
} from "busabase-contract/domains/base/contract/record-find";
import type { BaseFieldVO } from "busabase-contract/types";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { getContextSpaceId } from "../../../context";
import type { getDb } from "../../../db";
import {
  busabaseBaseFields,
  busabaseBases,
  busabaseCommits,
  busabaseRecords,
} from "../../../db/schema";
import { buildBaseVisibilityExists, buildNodeVisibilityExists } from "../../../logic/node-acl";
import { toFieldVO } from "../../../logic/vo";
import { recordFindTextMatches } from "../utils/record-find-text";
import type { ViewEvaluableRecord } from "../utils/view-records";
import { commitPayloadWithFields } from "./commit-payload-projection";
import { getCachedRecordFindTexts } from "./record-find-text-cache";

type Db = Awaited<ReturnType<typeof getDb>>;
export interface RecordFindInput {
  query: string;
  fieldId?: string;
}

export const resolveRecordFindFields = (
  fields: ReadonlyArray<BaseFieldVO>,
  find: RecordFindInput,
): BaseFieldVO[] => {
  if (!find.fieldId)
    return fields.filter((field) => COMMON_RECORD_FIND_FIELD_TYPES.has(field.type));
  const field = fields.find((candidate) => candidate.id === find.fieldId);
  if (!field) {
    throw new ORPCError("BAD_REQUEST", {
      message: "The selected find field is no longer available. Choose another field.",
      data: { reason: "unknown_find_field", fieldId: find.fieldId },
    });
  }
  const capability = getRecordFindFieldSupport(field);
  if (!capability.supported) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Find is not supported for this field. Choose another field or use a view filter.",
      data: { reason: "unsupported_find_field", fieldId: field.id },
    });
  }
  return [field];
};

const relationIds = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );

/**
 * Resolve a selected forward relation's titles in one batch. Targets are scoped
 * before reading their schema/payload, so inaccessible names never affect counts.
 */
const matchingRelationTargetIds = async (
  db: Db,
  records: ReadonlyArray<ViewEvaluableRecord>,
  field: BaseFieldVO,
  query: string,
): Promise<Set<string>> => {
  const targetBaseId = field.options.targetBaseId;
  if (!targetBaseId) return new Set();
  const spaceId = getContextSpaceId();
  const [targetBase] = await db
    .select({ id: busabaseBases.id })
    .from(busabaseBases)
    .where(
      and(
        eq(busabaseBases.id, targetBaseId),
        eq(busabaseBases.spaceId, spaceId),
        isNull(busabaseBases.deletedAt),
        isNull(busabaseBases.archivedAt),
        buildNodeVisibilityExists(db, busabaseBases.nodeId),
      ),
    )
    .limit(1);
  if (!targetBase) return new Set();
  const [primaryRow] = await db
    .select()
    .from(busabaseBaseFields)
    .where(and(eq(busabaseBaseFields.baseId, targetBase.id), isNull(busabaseBaseFields.deletedAt)))
    .orderBy(asc(busabaseBaseFields.position))
    .limit(1);
  if (!primaryRow) return new Set();
  const primary = toFieldVO(primaryRow);
  if (!COMMON_RECORD_FIND_FIELD_TYPES.has(primary.type)) {
    throw new ORPCError("BAD_REQUEST", {
      message:
        "Find by this relation is unavailable because its record title is not a supported stored field. Choose another field.",
      data: { reason: "unsupported_find_relation_title", fieldId: field.id },
    });
  }
  const targetIds = [
    ...new Set(records.flatMap((record) => relationIds(record.fields[field.slug]))),
  ];
  if (!targetIds.length) return new Set();
  const targets = await db
    .select({
      id: busabaseRecords.id,
      fields: commitPayloadWithFields([primary.slug]).as("fields"),
    })
    .from(busabaseRecords)
    .innerJoin(busabaseCommits, eq(busabaseCommits.id, busabaseRecords.headCommitId))
    .where(
      and(
        eq(busabaseRecords.spaceId, spaceId),
        eq(busabaseRecords.baseId, targetBase.id),
        eq(busabaseRecords.status, "active"),
        sql`${busabaseRecords.id} in (
          select jsonb_array_elements_text(${JSON.stringify(targetIds)}::jsonb)
        )`,
        buildBaseVisibilityExists(db, busabaseRecords.baseId),
      ),
    );
  return new Set(
    targets
      .filter((target) =>
        recordFindTextMatches(
          getCachedRecordFindTexts(primary, target.fields?.[primary.slug]),
          query,
        ),
      )
      .map((target) => target.id),
  );
};

/** Evaluate complete current values after the saved-view membership is known. */
export const filterRecordsForFind = async <Record extends ViewEvaluableRecord>(
  db: Db,
  records: ReadonlyArray<Record>,
  fields: ReadonlyArray<BaseFieldVO>,
  find: RecordFindInput | undefined,
): Promise<Record[]> => {
  if (!find) return [...records];
  const query = find.query.toLowerCase();
  const relation = fields.find((field) => field.type === "relation");
  const matchingTargets = relation
    ? await matchingRelationTargetIds(db, records, relation, query)
    : new Set<string>();
  return records.filter((record) =>
    fields.some((field) =>
      field.type === "relation"
        ? relationIds(record.fields[field.slug]).some((id) => matchingTargets.has(id))
        : recordFindTextMatches(getCachedRecordFindTexts(field, record.fields[field.slug]), query),
    ),
  );
};
