import "server-only";

import { createHash } from "node:crypto";
import type { BaseVO, LookupComputedVO } from "busabase-contract/types";
import { LOOKUP_SOURCE_LIMIT } from "busabase-contract/types";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { getContextSpaceId } from "../../../context";
import type { getDb } from "../../../db";
import {
  busabaseBaseFields,
  busabaseBases,
  busabaseCommits,
  busabaseRecordLinks,
  busabaseRecords,
} from "../../../db/schema";
import { buildBaseVisibilityExists, buildNodeVisibilityExists } from "../../../logic/node-acl";
import { toBaseVO } from "../../../logic/vo";
import { applyRollup, isRollupCompatible, LOOKUP_ROLLUPS } from "../lookup/rollup";

import { lookupDependentFieldSlugs } from "./lookup-formulas";
import { resolveReverseRelationValues } from "./reverse-relations";

type Db = Awaited<ReturnType<typeof getDb>>;
type RecordLike = { id: string; baseId: string };
const versionOf = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const hasValue = (value: unknown): boolean =>
  Array.isArray(value)
    ? value.some((item) => hasValue(item))
    : value !== null && value !== undefined && (typeof value !== "string" || value.trim() !== "");
export interface LookupResolution {
  values: Record<string, unknown>;
  computedFields: Record<string, LookupComputedVO>;
}

/** Resolve latest merged dependencies in batches, without manufacturing source commits. */
export const resolveLookupValues = async (
  db: Db,
  records: ReadonlyArray<RecordLike>,
  basesById: ReadonlyMap<string, BaseVO>,
  dependencyReadAt = performance.timeOrigin + performance.now(),
): Promise<Map<string, LookupResolution>> => {
  const out = new Map<string, LookupResolution>();
  const lookupRecords = records.filter((record) =>
    basesById.get(record.baseId)?.fields.some((field) => field.type === "lookup"),
  );
  if (!lookupRecords.length) return out;
  const spaceId = getContextSpaceId();
  const targetBaseIds = [
    ...new Set(
      lookupRecords.flatMap((record) =>
        (basesById.get(record.baseId)?.fields ?? []).flatMap((field) =>
          field.type === "relation" && field.options.targetBaseId
            ? [field.options.targetBaseId]
            : [],
        ),
      ),
    ),
  ];
  // Apply ACL before loading any target schema, payload, or identity.
  const targetBases = targetBaseIds.length
    ? await db
        .select()
        .from(busabaseBases)
        .where(
          and(
            inArray(busabaseBases.id, targetBaseIds),
            eq(busabaseBases.spaceId, spaceId),
            isNull(busabaseBases.deletedAt),
            isNull(busabaseBases.archivedAt),
            buildNodeVisibilityExists(db, busabaseBases.nodeId),
          ),
        )
    : [];
  const visibleBaseIds = targetBases.map((base) => base.id);
  const targetFields = visibleBaseIds.length
    ? await db
        .select()
        .from(busabaseBaseFields)
        .where(
          and(
            inArray(busabaseBaseFields.baseId, visibleBaseIds),
            isNull(busabaseBaseFields.deletedAt),
          ),
        )
    : [];
  const targetBaseMap = new Map(
    targetBases.map((base) => [
      base.id,
      toBaseVO(
        base,
        targetFields.filter((field) => field.baseId === base.id),
      ),
    ]),
  );
  const dynamicTargetFields = new Map(
    [...targetBaseMap].map(([id, base]) => [id, lookupDependentFieldSlugs(base.fields)]),
  );
  const links = await db
    .select({
      sourceRecordId: busabaseRecordLinks.sourceRecordId,
      fieldSlug: busabaseRecordLinks.fieldSlug,
      targetRecordId: busabaseRecordLinks.targetRecordId,
    })
    .from(busabaseRecordLinks)
    .where(
      and(
        inArray(
          busabaseRecordLinks.sourceRecordId,
          lookupRecords.map((record) => record.id),
        ),
        eq(busabaseRecordLinks.spaceId, spaceId),
        isNull(busabaseRecordLinks.deletedAt),
      ),
    )
    .orderBy(asc(busabaseRecordLinks.position), asc(busabaseRecordLinks.createdAt));
  const targetsByLink = new Map<string, string[]>();
  for (const link of links) {
    const key = `${link.sourceRecordId}|${link.fieldSlug}`;
    targetsByLink.set(key, [...(targetsByLink.get(key) ?? []), link.targetRecordId]);
  }
  // A lookup over a reverse relation column walks the link table backwards:
  // its "targets" are the records whose forward field links to this one.
  const reverseValues = await resolveReverseRelationValues(
    db,
    lookupRecords,
    new Map(
      lookupRecords.flatMap((record) => {
        const fields = basesById.get(record.baseId)?.fields;
        return fields ? [[record.baseId, fields] as const] : [];
      }),
    ),
  );
  for (const [recordId, values] of reverseValues) {
    for (const [slug, ids] of Object.entries(values)) {
      targetsByLink.set(`${recordId}|${slug}`, ids);
    }
  }
  const targetRecordIds = [...new Set([...targetsByLink.values()].flat())];
  const targetRecords =
    targetRecordIds.length && visibleBaseIds.length
      ? await db
          .select({
            id: busabaseRecords.id,
            baseId: busabaseRecords.baseId,
            headCommitId: busabaseRecords.headCommitId,
          })
          .from(busabaseRecords)
          .where(
            and(
              inArray(busabaseRecords.id, targetRecordIds),
              inArray(busabaseRecords.baseId, visibleBaseIds),
              eq(busabaseRecords.spaceId, spaceId),
              isNull(busabaseRecords.archivedAt),
              buildBaseVisibilityExists(db, busabaseRecords.baseId),
            ),
          )
      : [];
  // Diagnose missing active rows only after the expected source schema passed ACL
  // and configuration checks. Archived listing already permits these identities,
  // but unavailable or unauthorized identities must remain indistinguishable.
  const activeRecordIds = new Set(targetRecords.map((record) => record.id));
  const diagnosticIds = new Set<string>();
  for (const record of lookupRecords) {
    const base = basesById.get(record.baseId);
    for (const field of base?.fields ?? []) {
      if (field.type !== "lookup" || !field.options.lookup) continue;
      const config = field.options.lookup;
      const relation = base?.fields.find(
        (candidate) => candidate.type === "relation" && candidate.slug === config.relationFieldSlug,
      );
      const source = targetBaseMap.get(relation?.options.targetBaseId ?? "");
      const target = source?.fields.find((candidate) => candidate.slug === config.targetFieldSlug);
      const rollup = config.rollup ?? "values";
      if (
        !source ||
        !target ||
        dynamicTargetFields.get(source.id)?.has(target.slug) ||
        !LOOKUP_ROLLUPS.includes(rollup) ||
        !isRollupCompatible(rollup, target.type)
      )
        continue;
      const ids = targetsByLink.get(`${record.id}|${relation?.slug}`) ?? [];
      for (const id of config.limit === "first" ? ids.slice(0, 1) : ids)
        if (!activeRecordIds.has(id)) diagnosticIds.add(id);
    }
  }
  const visibleDiagnostics = diagnosticIds.size
    ? await db
        .select({
          id: busabaseRecords.id,
          baseId: busabaseRecords.baseId,
          archivedAt: busabaseRecords.archivedAt,
        })
        .from(busabaseRecords)
        .innerJoin(busabaseBases, eq(busabaseBases.id, busabaseRecords.baseId))
        .where(
          and(
            inArray(busabaseRecords.id, [...diagnosticIds]),
            eq(busabaseRecords.spaceId, spaceId),
            eq(busabaseBases.spaceId, spaceId),
            isNull(busabaseBases.deletedAt),
            isNull(busabaseBases.archivedAt),
            buildNodeVisibilityExists(db, busabaseBases.nodeId),
          ),
        )
    : [];
  const diagnosticById = new Map(visibleDiagnostics.map((record) => [record.id, record]));
  const headIds = [...new Set(targetRecords.map((record) => record.headCommitId))];
  const commits = headIds.length
    ? await db
        .select({ id: busabaseCommits.id, payload: busabaseCommits.payload })
        .from(busabaseCommits)
        .where(inArray(busabaseCommits.id, headIds))
    : [];
  const payloadByHead = new Map(commits.map((commit) => [commit.id, commit.payload]));
  const recordById = new Map(targetRecords.map((record) => [record.id, record]));

  for (const record of lookupRecords) {
    const base = basesById.get(record.baseId);
    if (!base) continue;
    const result: LookupResolution = { values: {}, computedFields: {} };
    for (const field of base.fields.filter((candidate) => candidate.type === "lookup")) {
      const config = field.options.lookup;
      const relation = base.fields.find(
        (candidate) =>
          candidate.slug === config?.relationFieldSlug && candidate.type === "relation",
      );
      const targetBaseId = relation?.options.targetBaseId;
      const targetBase = targetBaseId ? targetBaseMap.get(targetBaseId) : undefined;
      const targetField = targetBase?.fields.find(
        (candidate) => candidate.slug === config?.targetFieldSlug,
      );
      const rollup = config?.rollup ?? "values";
      let computed: LookupComputedVO = {
        status: "invalid",
        value: null,
        sources: [],
        sourcesTruncated: false,
        dependencyVersion: versionOf(field.options),
        dependencyReadAt,
      };
      if (!config) {
        computed.reason = "missing_configuration";
      } else if (!relation) {
        computed.reason = "missing_relation";
      } else if (!targetBaseId) {
        computed.reason = "missing_source_configuration";
      } else {
        if (!targetBase) {
          // Missing and inaccessible origins deliberately have the same public response.
          computed.status = "inaccessible";
        } else if (!targetField) {
          computed.reason = "missing_target_field";
        } else if (dynamicTargetFields.get(targetBase.id)?.has(targetField.slug)) {
          computed.reason = "unsupported_source";
        } else if (
          !LOOKUP_ROLLUPS.includes(rollup) ||
          !isRollupCompatible(rollup, targetField.type)
        ) {
          computed.reason = "unsupported_rollup";
        } else {
          const ids = targetsByLink.get(`${record.id}|${relation.slug}`) ?? [];
          const limited = config.limit === "first" ? ids.slice(0, 1) : ids;
          const complete = limited.every(
            (id) =>
              recordById.get(id)?.baseId === targetBaseId &&
              payloadByHead.has(recordById.get(id)?.headCommitId ?? ""),
          );
          if (!complete) {
            const identities = limited.map((id) => recordById.get(id) ?? diagnosticById.get(id));
            const allVisible = identities.every((identity) => identity !== undefined);
            const missingPayload = limited.some((id) => {
              const active = recordById.get(id);
              return active && !payloadByHead.has(active.headCommitId);
            });
            if (
              allVisible &&
              !missingPayload &&
              identities.some((identity) => identity?.baseId !== targetBaseId)
            ) {
              computed.reason = "source_base_mismatch";
            } else if (
              allVisible &&
              !missingPayload &&
              identities.some(
                (identity) => identity && "archivedAt" in identity && identity.archivedAt !== null,
              )
            ) {
              computed.reason = "source_record_archived";
            } else {
              computed.status = "inaccessible";
            }
          } else {
            const sources = limited.flatMap((id) => {
              const target = recordById.get(id);
              if (!target) return [];
              const payload = payloadByHead.get(target.headCommitId) as Record<string, unknown>;
              const primary = targetBase.fields[0];
              const titleValue = primary ? payload[primary.slug] : undefined;
              return [
                {
                  recordId: id,
                  title:
                    typeof titleValue === "string" || typeof titleValue === "number"
                      ? String(titleValue)
                      : id,
                  value: payload[targetField.slug] ?? null,
                  headCommitId: target.headCommitId,
                },
              ];
            });
            const raw = sources.map((source) => source.value);
            computed = {
              status: !ids.length ? "unlinked" : raw.some(hasValue) ? "ready" : "empty",
              value: applyRollup(raw, rollup),
              targetField,
              sourceBaseId: targetBaseId,
              sourceBaseSlug: targetBase.slug,
              sources: sources.slice(0, LOOKUP_SOURCE_LIMIT),
              sourcesTruncated: sources.length > LOOKUP_SOURCE_LIMIT,
              dependencyReadAt,
              dependencyVersion: versionOf([
                field.options,
                targetField,
                sources.map((source) => [source.recordId, source.headCommitId, source.title]),
              ]),
            };
          }
        }
      }
      computed.dependencyVersion = versionOf([
        computed.dependencyVersion,
        computed.status,
        computed.reason,
        relation?.options,
      ]);
      result.values[field.slug] = computed.value;
      result.computedFields[field.slug] = computed;
    }
    out.set(record.id, result);
  }
  return out;
};
