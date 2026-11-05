import "server-only";

import { ORPCError } from "@orpc/server";
import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { getContextSpaceId } from "../../../context";
import type { getDb } from "../../../db";
import {
  busabaseBaseFields,
  busabaseBases,
  type CommitPO,
  type OperationPO,
} from "../../../db/schema";
import { buildNodeVisibilityExists } from "../../../logic/node-acl";

type Db = Awaited<ReturnType<typeof getDb>>;
type Definition = {
  id?: string;
  slug: string;
  type?: string;
  options?: Record<string, unknown> | null;
  deletedAt?: Date | null;
};
export type LookupReference = {
  fieldSlug: string;
  targetBaseId?: string;
  targetBaseSlug?: string;
  targetFieldSlug: string;
  consumerBaseId?: string;
  plannedSource?: boolean;
  plannedTarget?: boolean;
};
const changed = () =>
  new ORPCError("CONFLICT", {
    message: "A lookup source changed before merge. Check its configuration and retry.",
    data: { reason: "lookup_dependency_changed" },
  });

export function lookupReferences(
  fields: ReadonlyArray<Definition>,
  selected?: ReadonlySet<string>,
): LookupReference[] {
  const relations = new Map(
    fields
      .filter((field) => field.type === "relation" && !field.deletedAt)
      .map((field) => [field.slug, field]),
  );
  return fields.flatMap((field) => {
    if (field.type !== "lookup" || field.deletedAt || (selected && !selected.has(field.slug)))
      return [];
    const config = field.options?.lookup as
      | { relationFieldSlug?: string; targetFieldSlug?: string }
      | undefined;
    const relation = config?.relationFieldSlug
      ? relations.get(config.relationFieldSlug)
      : undefined;
    if (!relation || !config?.targetFieldSlug) throw changed();
    const targetBaseId = relation.options?.targetBaseId;
    const targetBaseSlug = relation.options?.targetBaseSlug;
    if (typeof targetBaseId !== "string" && typeof targetBaseSlug !== "string") throw changed();
    return [
      {
        fieldSlug: field.slug,
        targetFieldSlug: config.targetFieldSlug,
        ...(typeof targetBaseId === "string"
          ? { targetBaseId }
          : { targetBaseSlug: targetBaseSlug as string }),
      },
    ];
  });
}

/** Only operations introducing/repointing references participate; record writes incur no reads. */
async function mergeReferences(
  db: Db,
  operations: ReadonlyArray<OperationPO>,
  commits: ReadonlyMap<string, CommitPO>,
): Promise<LookupReference[]> {
  const fieldOps = operations.filter((operation) => {
    const payload = commits.get(operation.headCommitId)?.payload;
    if (!payload) return false;
    if (operation.operation === "base_restore_field") return true;
    if (operation.operation === "base_add_field")
      return payload.type === "lookup" || payload.type === "relation";
    if (
      operation.operation !== "base_update_field" ||
      !payload.options ||
      typeof payload.options !== "object"
    )
      return false;
    return ["lookup", "targetBaseId", "targetBaseSlug"].some(
      (key) => key in (payload.options as Record<string, unknown>),
    );
  });
  const fieldOpSet = new Set(fieldOps);
  const baseIds = [
    ...new Set(fieldOps.flatMap((operation) => (operation.baseId ? [operation.baseId] : []))),
  ];
  const definitions = baseIds.length
    ? await db
        .select({
          id: busabaseBaseFields.id,
          baseId: busabaseBaseFields.baseId,
          slug: busabaseBaseFields.slug,
          type: busabaseBaseFields.type,
          options: busabaseBaseFields.options,
          deletedAt: busabaseBaseFields.deletedAt,
        })
        .from(busabaseBaseFields)
        .where(
          and(
            inArray(busabaseBaseFields.baseId, baseIds),
            eq(busabaseBaseFields.spaceId, getContextSpaceId()),
          ),
        )
    : [];
  const byBase = new Map<string, Definition[]>();
  for (const field of definitions) {
    const fields = byBase.get(field.baseId) ?? [];
    fields.push(field);
    byBase.set(field.baseId, fields);
  }
  const references: LookupReference[] = [];
  const hasInlineLookups = operations.some((operation) => {
    const payload = commits.get(operation.headCommitId)?.payload;
    return (
      operation.operation === "node_create" &&
      Array.isArray(payload?.fields) &&
      (payload.fields as Definition[]).some((field) => field.type === "lookup")
    );
  });
  const renamedNodeIds = hasInlineLookups
    ? operations.flatMap((operation) =>
        operation.operation === "node_rename" && operation.nodeId ? [operation.nodeId] : [],
      )
    : [];
  const renamedBases = renamedNodeIds.length
    ? await db
        .select({ id: busabaseBases.id, nodeId: busabaseBases.nodeId })
        .from(busabaseBases)
        .where(
          and(
            inArray(busabaseBases.nodeId, renamedNodeIds),
            eq(busabaseBases.spaceId, getContextSpaceId()),
          ),
        )
    : [];
  const renamedByNode = new Map(renamedBases.map((base) => [base.nodeId, base.id]));
  const renamedBySlug = new Map<string, string>();
  const plannedBaseSlugs = new Set<string>();
  const plannedFields = new Set<string>();
  for (const operation of operations) {
    const payload = commits.get(operation.headCommitId)?.payload;
    if (!payload) continue;
    if (operation.operation === "node_rename" && typeof payload.slug === "string") {
      const baseId = renamedByNode.get(operation.nodeId ?? "");
      if (baseId) renamedBySlug.set(payload.slug, baseId);
    }
    if (operation.operation === "node_create" && payload.nodeType === "base") {
      references.push(
        ...lookupReferences(
          Array.isArray(payload.fields) ? (payload.fields as Definition[]) : [],
        ).map((reference) => ({
          ...reference,
          ...(reference.targetBaseSlug && renamedBySlug.has(reference.targetBaseSlug)
            ? { targetBaseId: renamedBySlug.get(reference.targetBaseSlug) }
            : {}),
          ...(reference.targetBaseSlug && plannedBaseSlugs.has(reference.targetBaseSlug)
            ? { plannedSource: true }
            : {}),
        })),
      );
      if (typeof payload.slug === "string") plannedBaseSlugs.add(payload.slug);
      continue;
    }
    if (
      operation.operation === "base_add_field" &&
      operation.baseId &&
      typeof payload.slug === "string"
    )
      plannedFields.add(JSON.stringify([operation.baseId, payload.slug]));
    if (!fieldOpSet.has(operation) || !operation.baseId) continue;
    const fields = byBase.get(operation.baseId) ?? [];
    const previous = fields.find((field) => field.id === payload.fieldId);
    const next: Definition =
      operation.operation === "base_add_field"
        ? {
            id: typeof payload.fieldId === "string" ? payload.fieldId : undefined,
            slug: String(payload.slug),
            type: String(payload.type ?? "text"),
            options: (payload.options ?? {}) as Record<string, unknown>,
            deletedAt: null,
          }
        : previous
          ? {
              ...previous,
              options:
                payload.options === undefined
                  ? previous.options
                  : (payload.options as Record<string, unknown>),
              deletedAt: operation.operation === "base_restore_field" ? null : previous.deletedAt,
            }
          : { slug: "" };
    if (!next.slug) continue;
    const updated = previous
      ? fields.map((field) => (field === previous ? next : field))
      : [...fields, next];
    byBase.set(operation.baseId, updated);
    const selected = new Set<string>();
    if (
      next.type === "lookup" &&
      (operation.operation !== "base_update_field" || payload.options !== undefined)
    )
      selected.add(next.slug);
    if (
      next.type === "relation" &&
      (operation.operation === "base_restore_field" ||
        previous?.options?.targetBaseId !== next.options?.targetBaseId ||
        previous?.options?.targetBaseSlug !== next.options?.targetBaseSlug)
    ) {
      for (const field of updated) {
        if (
          (field.options?.lookup as { relationFieldSlug?: string } | undefined)
            ?.relationFieldSlug === next.slug
        )
          selected.add(field.slug);
      }
    }
    references.push(
      ...lookupReferences(updated, selected).map((reference) => ({
        ...reference,
        ...(reference.targetBaseId &&
        plannedFields.has(JSON.stringify([reference.targetBaseId, reference.targetFieldSlug]))
          ? { plannedTarget: true }
          : {}),
      })),
    );
  }
  return canonicalReferences(references);
}

const canonicalReferences = (references: LookupReference[]) =>
  references.sort((left, right) =>
    JSON.stringify([
      left.fieldSlug,
      left.targetBaseId,
      left.targetBaseSlug,
      left.targetFieldSlug,
      left.consumerBaseId,
      left.plannedSource,
      left.plannedTarget,
    ]).localeCompare(
      JSON.stringify([
        right.fieldSlug,
        right.targetBaseId,
        right.targetBaseSlug,
        right.targetFieldSlug,
        right.consumerBaseId,
        right.plannedSource,
        right.plannedTarget,
      ]),
    ),
  );

async function resolveReferences(
  db: Db,
  references: LookupReference[],
): Promise<LookupReference[]> {
  const slugs = references.flatMap((reference) =>
    reference.targetBaseId ? [] : reference.targetBaseSlug ? [reference.targetBaseSlug] : [],
  );
  if (slugs.length === 0) return references;
  const rows = await db
    .select({ id: busabaseBases.id, slug: busabaseBases.slug })
    .from(busabaseBases)
    .where(
      and(
        eq(busabaseBases.spaceId, getContextSpaceId()),
        inArray(busabaseBases.slug, slugs),
        isNull(busabaseBases.archivedAt),
        isNull(busabaseBases.deletedAt),
      ),
    );
  const bySlug = new Map(rows.map((row) => [row.slug, row.id]));
  return canonicalReferences(
    references.map((reference) => {
      if (reference.targetBaseId) return reference;
      const baseId = bySlug.get(reference.targetBaseSlug ?? "");
      if (!baseId) {
        if (reference.plannedSource) return reference;
        throw changed();
      }
      return { ...reference, targetBaseId: baseId };
    }),
  );
}

/** Caller holds every referenced source Base lock before invoking this metadata-only check. */
export async function assertLookupTargetsExist(
  db: Db,
  references: ReadonlyArray<LookupReference>,
): Promise<void> {
  if (references.length === 0) return;
  const pairs = references.map((reference) => {
    if (!reference.targetBaseId) throw changed();
    return and(
      eq(busabaseBaseFields.baseId, reference.targetBaseId),
      eq(busabaseBaseFields.slug, reference.targetFieldSlug),
    );
  });
  const rows = await db
    .select({
      baseId: busabaseBaseFields.baseId,
      slug: busabaseBaseFields.slug,
      type: busabaseBaseFields.type,
    })
    .from(busabaseBaseFields)
    .innerJoin(busabaseBases, eq(busabaseBases.id, busabaseBaseFields.baseId))
    .where(
      and(
        or(...pairs),
        eq(busabaseBaseFields.spaceId, getContextSpaceId()),
        eq(busabaseBases.spaceId, getContextSpaceId()),
        isNull(busabaseBaseFields.deletedAt),
        isNull(busabaseBases.archivedAt),
        isNull(busabaseBases.deletedAt),
        buildNodeVisibilityExists(db, busabaseBases.nodeId),
      ),
    );
  const available = new Set(
    rows
      .filter((row) => row.type !== "lookup")
      .map((row) => JSON.stringify([row.baseId, row.slug])),
  );
  for (const reference of references)
    if (!available.has(JSON.stringify([reference.targetBaseId, reference.targetFieldSlug])))
      throw changed();
}

/** Same sorted lock order as schema merges, with a post-wait relation re-read. */
export async function lockLookupMergeTargets(
  db: Db,
  operations: ReadonlyArray<OperationPO>,
  commits: ReadonlyMap<string, CommitPO>,
  ownBaseIds: string[],
): Promise<Set<string>> {
  const before = await resolveReferences(db, await mergeReferences(db, operations, commits));
  const baseIds = [
    ...new Set([
      ...ownBaseIds,
      ...before.flatMap((reference) =>
        reference.consumerBaseId ? [reference.consumerBaseId] : [],
      ),
      ...before.flatMap((reference) => (reference.targetBaseId ? [reference.targetBaseId] : [])),
    ]),
  ].sort();
  if (baseIds.length)
    await db
      .select({ id: busabaseBases.id })
      .from(busabaseBases)
      .where(
        and(inArray(busabaseBases.id, baseIds), eq(busabaseBases.spaceId, getContextSpaceId())),
      )
      .orderBy(asc(busabaseBases.id))
      // Serialize schema changes without blocking unrelated relation-link FK KEY SHAREs.
      .for("no key update");
  const after = await resolveReferences(db, await mergeReferences(db, operations, commits));
  if (JSON.stringify(before) !== JSON.stringify(after)) throw changed();
  await assertLookupTargetsExist(
    db,
    after.filter((reference) => !reference.plannedSource && !reference.plannedTarget),
  );
  return new Set(baseIds);
}

/** Recheck after sequential operations, including sources/fields created earlier in this batch. */
export async function assertMergedLookupTargets(
  db: Db,
  operations: ReadonlyArray<OperationPO>,
  commits: ReadonlyMap<string, CommitPO>,
  lockedOrCreatedBaseIds: ReadonlySet<string>,
  createdReferences: ReadonlyArray<LookupReference> = [],
): Promise<void> {
  // Materialized options contain stable IDs; a later same-batch source rename must not
  // make the original targetBaseSlug appear to refer to a different Base.
  const references = await resolveReferences(db, [
    ...(await mergeReferences(
      db,
      operations.filter((operation) => operation.operation !== "node_create"),
      commits,
    )),
    ...createdReferences,
  ]);
  if (
    references.some(
      (reference) => !reference.targetBaseId || !lockedOrCreatedBaseIds.has(reference.targetBaseId),
    )
  )
    throw changed();
  await assertLookupTargetsExist(db, references);
}

/** New-Base fast path has immutable input definitions and no existing consumer row to lock. */
export async function lockNewBaseLookupTargets(
  db: Db,
  fields: ReadonlyArray<Definition>,
): Promise<void> {
  const references = await resolveReferences(db, canonicalReferences(lookupReferences(fields)));
  const baseIds = [
    ...new Set(
      references.flatMap((reference) => (reference.targetBaseId ? [reference.targetBaseId] : [])),
    ),
  ].sort();
  if (baseIds.length)
    await db
      .select({ id: busabaseBases.id })
      .from(busabaseBases)
      .where(
        and(inArray(busabaseBases.id, baseIds), eq(busabaseBases.spaceId, getContextSpaceId())),
      )
      .orderBy(asc(busabaseBases.id))
      .for("no key update");
  const after = await resolveReferences(db, canonicalReferences(lookupReferences(fields)));
  if (JSON.stringify(references) !== JSON.stringify(after)) throw changed();
  await assertLookupTargetsExist(db, after);
}
