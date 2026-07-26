import "server-only";

// Read-time resolution of `lookup` field values.
//
// Why read time and not write time (unlike `formula`, which is baked into the
// commit at merge): a lookup's value is derived from OTHER records. Editing the
// linked record changes what this record's lookup should show, without this
// record ever being written — so a stored value would go stale silently and
// there is no commit to attach the refresh to. Storing it would also mean
// fabricating commits for records nobody edited, which is exactly the thing
// Busabase's approval-first history is not supposed to contain.
//
// Vika/APITable made the same call (lazy `getCellValue`, never materialized);
// bika materializes via a full-column `reloadCells()` sweep, which only works
// because it has no commit chain to respect.
//
// Everything here is BATCHED: one links query, one records query, one commits
// query for the whole page of records, no matter how many lookup fields or
// linked records are involved.
import type { FieldType } from "busabase-contract/types";
import { and, asc, inArray, isNull } from "drizzle-orm";
import type { getDb } from "../../../db";
import { busabaseCommits, busabaseRecordLinks, busabaseRecords } from "../../../db/schema";
import { applyRollup } from "../lookup/rollup";

type Db = Awaited<ReturnType<typeof getDb>>;

/** Minimal shape of a field definition this module needs (VO or PO both satisfy it). */
interface FieldLike {
  slug: string;
  type: FieldType;
  options?: {
    lookup?: {
      relationFieldSlug: string;
      targetFieldSlug: string;
      rollup?: string;
      limit?: "all" | "first";
    } | null;
  } | null;
}

interface BaseLike {
  id: string;
  fields: ReadonlyArray<FieldLike>;
}

interface RecordLike {
  id: string;
  baseId: string;
}

/** A lookup field paired with the relation field it hops through. */
interface ResolvedPlan {
  slug: string;
  relationFieldSlug: string;
  targetFieldSlug: string;
  rollup: string;
  limit: "all" | "first";
}

/**
 * Lookup fields on `base` that are fully configured AND whose relation field
 * actually exists and is a `relation`. A half-configured lookup (relation field
 * since deleted or retyped) resolves to null rather than throwing — same
 * fail-soft posture as `computeFormula` on a stale expression.
 */
const planLookupFields = (base: BaseLike): ResolvedPlan[] => {
  const plans: ResolvedPlan[] = [];
  for (const field of base.fields) {
    if (field.type !== "lookup") continue;
    const config = field.options?.lookup;
    if (!config?.relationFieldSlug || !config.targetFieldSlug) continue;
    const relationField = base.fields.find((f) => f.slug === config.relationFieldSlug);
    if (!relationField || relationField.type !== "relation") continue;
    plans.push({
      slug: field.slug,
      relationFieldSlug: config.relationFieldSlug,
      targetFieldSlug: config.targetFieldSlug,
      rollup: config.rollup ?? "values",
      limit: config.limit ?? "all",
    });
  }
  return plans;
};

/**
 * Resolve every `lookup` field for `records`, returning
 * `recordId → { lookupSlug: value }`. Records whose base has no configured
 * lookup field are absent from the map (callers leave their fields untouched).
 *
 * Returns an empty map — with ZERO queries — when no base in the set has a
 * lookup field, so adding this to the record read path costs nothing for the
 * overwhelming majority of bases that don't use one.
 */
export const resolveLookupValues = async (
  db: Db,
  records: ReadonlyArray<RecordLike>,
  basesById: ReadonlyMap<string, BaseLike>,
): Promise<Map<string, Record<string, unknown>>> => {
  const out = new Map<string, Record<string, unknown>>();
  if (records.length === 0) return out;

  const plansByBaseId = new Map<string, ResolvedPlan[]>();
  for (const [baseId, base] of basesById) {
    const plans = planLookupFields(base);
    if (plans.length > 0) plansByBaseId.set(baseId, plans);
  }
  // Fast path: nothing to do, and crucially no queries issued.
  if (plansByBaseId.size === 0) return out;

  const lookupRecords = records.filter((record) => plansByBaseId.has(record.baseId));
  if (lookupRecords.length === 0) return out;

  // 1. One query: every outbound link from every record in the page.
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
        // Links into archived records are tombstoned at merge time, so this also
        // excludes archived targets from every rollup.
        isNull(busabaseRecordLinks.deletedAt),
      ),
    )
    .orderBy(asc(busabaseRecordLinks.position), asc(busabaseRecordLinks.createdAt));

  if (links.length === 0) {
    // Still emit per-record entries so an unlinked record shows an empty rollup
    // (COUNT → 0) rather than a stale/absent cell.
    for (const record of lookupRecords) {
      out.set(record.id, emptyLookupValues(plansByBaseId.get(record.baseId) ?? []));
    }
    return out;
  }

  // `sourceRecordId|fieldSlug` → ordered target record ids.
  const targetsByLink = new Map<string, string[]>();
  for (const link of links) {
    const key = `${link.sourceRecordId}|${link.fieldSlug}`;
    const list = targetsByLink.get(key);
    if (list) list.push(link.targetRecordId);
    else targetsByLink.set(key, [link.targetRecordId]);
  }

  // 2 + 3. Two queries: the linked records, then their head commits (which hold
  // the field values). Deduped across every source record and lookup field.
  const targetRecordIds = [...new Set(links.map((link) => link.targetRecordId))];
  const targetRecords = await db
    .select({ id: busabaseRecords.id, headCommitId: busabaseRecords.headCommitId })
    .from(busabaseRecords)
    .where(inArray(busabaseRecords.id, targetRecordIds));
  const headCommitIds = [...new Set(targetRecords.map((record) => record.headCommitId))];
  const commits =
    headCommitIds.length === 0
      ? []
      : await db
          .select({ id: busabaseCommits.id, fields: busabaseCommits.fields })
          .from(busabaseCommits)
          .where(inArray(busabaseCommits.id, headCommitIds));
  const fieldsByCommitId = new Map(commits.map((commit) => [commit.id, commit.fields]));
  const fieldsByRecordId = new Map(
    targetRecords.map((record) => [record.id, fieldsByCommitId.get(record.headCommitId) ?? {}]),
  );

  for (const record of lookupRecords) {
    const plans = plansByBaseId.get(record.baseId) ?? [];
    const values: Record<string, unknown> = {};
    for (const plan of plans) {
      const targets = targetsByLink.get(`${record.id}|${plan.relationFieldSlug}`) ?? [];
      const limited = plan.limit === "first" ? targets.slice(0, 1) : targets;
      const raw = limited.map((targetId) => {
        const fields = fieldsByRecordId.get(targetId);
        return fields ? (fields as Record<string, unknown>)[plan.targetFieldSlug] : undefined;
      });
      values[plan.slug] = applyRollup(raw, plan.rollup as Parameters<typeof applyRollup>[1]);
    }
    out.set(record.id, values);
  }
  return out;
};

/** Rollup result for a record with no links at all (COUNT → 0, SUM → null, …). */
const emptyLookupValues = (plans: ResolvedPlan[]): Record<string, unknown> =>
  Object.fromEntries(
    plans.map((plan) => [
      plan.slug,
      applyRollup([], plan.rollup as Parameters<typeof applyRollup>[1]),
    ]),
  );
