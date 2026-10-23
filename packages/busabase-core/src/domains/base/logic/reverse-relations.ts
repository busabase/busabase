import "server-only";

import { ORPCError } from "@orpc/server";
import { and, asc, eq, inArray, isNull, ne } from "drizzle-orm";
import { iStringToText } from "openlib/i18n/i-string";
import { getContextSpaceId } from "../../../context";
import type { getDb } from "../../../db";
import {
  busabaseBaseFields,
  busabaseBases,
  busabaseFieldValues,
  busabaseRecordLinks,
  busabaseRecords,
} from "../../../db/schema";
import { buildBaseVisibilityExists } from "../../../logic/node-acl";

/**
 * Reverse relation columns.
 *
 * A `relation` field whose options carry `reverseOfFieldId` is the read-only
 * other side of a relation field on its target Base: "Company → Opportunities"
 * is the reverse of "Opportunity → Company". It stores nothing. Its value is
 * every live record on the target Base whose forward field links to this
 * record, read at query time from `busabase_record_links` (which has an index on
 * `targetRecordId`). Because the relationship is stored once, on the forward
 * side, the two columns can never disagree — the inconsistency a pair of
 * independently-edited `inverseFieldId` fields produces.
 *
 * Editing happens on the forward field. A write that echoes back a reverse
 * column's current value (clients often resubmit the whole record) is dropped;
 * a write that tries to change it is rejected with a pointer to the forward
 * field.
 */

type Db = Awaited<ReturnType<typeof getDb>>;
type FieldLike = {
  id?: string;
  slug: string;
  name?: unknown;
  type: string;
  options?: Record<string, unknown> | null;
};

export const reverseOfFieldIdOf = (field: FieldLike): string | null => {
  if (field.type !== "relation") return null;
  const value = field.options?.reverseOfFieldId;
  return typeof value === "string" && value.length > 0 ? value : null;
};

export const isReverseRelationField = (field: FieldLike): boolean =>
  reverseOfFieldIdOf(field) !== null;

export const reverseRelationFields = <T extends FieldLike>(fields: ReadonlyArray<T>): T[] =>
  fields.filter(isReverseRelationField);

/**
 * Current value of every reverse column on `records`, in one query for the
 * whole batch: `recordId → slug → source record ids`, oldest link first.
 * Sources that are archived, sit on a Base the viewer cannot see, or whose
 * forward field was deleted do not appear. Records with no reverse columns are
 * absent from the map.
 */
export const resolveReverseRelationValues = async (
  db: Db,
  records: ReadonlyArray<{ id: string; baseId: string }>,
  fieldsByBaseId: ReadonlyMap<string, ReadonlyArray<FieldLike>>,
): Promise<Map<string, Record<string, string[]>>> => {
  const out = new Map<string, Record<string, string[]>>();
  const relevant = records.filter((record) =>
    (fieldsByBaseId.get(record.baseId) ?? []).some(isReverseRelationField),
  );
  if (relevant.length === 0) return out;
  const forwardFieldIds = [
    ...new Set(
      relevant.flatMap((record) =>
        reverseRelationFields(fieldsByBaseId.get(record.baseId) ?? []).map(
          (field) => reverseOfFieldIdOf(field) as string,
        ),
      ),
    ),
  ];
  const links = await db
    .select({
      fieldId: busabaseRecordLinks.fieldId,
      sourceRecordId: busabaseRecordLinks.sourceRecordId,
      targetRecordId: busabaseRecordLinks.targetRecordId,
    })
    .from(busabaseRecordLinks)
    .innerJoin(busabaseRecords, eq(busabaseRecords.id, busabaseRecordLinks.sourceRecordId))
    .innerJoin(busabaseBaseFields, eq(busabaseBaseFields.id, busabaseRecordLinks.fieldId))
    .where(
      and(
        eq(busabaseRecordLinks.spaceId, getContextSpaceId()),
        inArray(busabaseRecordLinks.fieldId, forwardFieldIds),
        inArray(
          busabaseRecordLinks.targetRecordId,
          relevant.map((record) => record.id),
        ),
        isNull(busabaseRecordLinks.deletedAt),
        eq(busabaseRecords.status, "active"),
        isNull(busabaseBaseFields.deletedAt),
        buildBaseVisibilityExists(db, busabaseRecordLinks.baseId),
      ),
    )
    .orderBy(asc(busabaseRecordLinks.createdAt), asc(busabaseRecordLinks.sourceRecordId));
  const sourcesByKey = new Map<string, string[]>();
  for (const link of links) {
    const key = `${link.targetRecordId}|${link.fieldId}`;
    const list = sourcesByKey.get(key) ?? [];
    if (!list.includes(link.sourceRecordId)) list.push(link.sourceRecordId);
    sourcesByKey.set(key, list);
  }
  for (const record of relevant) {
    const values: Record<string, string[]> = {};
    for (const field of reverseRelationFields(fieldsByBaseId.get(record.baseId) ?? [])) {
      values[field.slug] = sourcesByKey.get(`${record.id}|${reverseOfFieldIdOf(field)}`) ?? [];
    }
    out.set(record.id, values);
  }
  return out;
};

const toIdList = (value: unknown): string[] | null => {
  if (value === null || value === undefined || value === "") return [];
  if (typeof value === "string") return [value];
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return [...new Set(value as string[])];
  }
  return null;
};

const sameIdSet = (left: string[], right: string[]) =>
  left.length === right.length && left.every((item) => right.includes(item));

const fieldLabel = (field: { slug: string; name?: unknown }) => {
  const text = typeof field.name === "string" ? field.name : iStringToText(field.name as never);
  return text || field.slug;
};

/** Error for a write that tries to change a reverse column. */
export const reverseRelationReadOnlyError = async (
  db: Db,
  field: FieldLike,
): Promise<ORPCError<"BAD_REQUEST", unknown>> => {
  const forwardFieldId = reverseOfFieldIdOf(field);
  const [forward] = forwardFieldId
    ? await db
        .select({
          slug: busabaseBaseFields.slug,
          name: busabaseBaseFields.name,
          baseSlug: busabaseBases.slug,
          baseName: busabaseBases.name,
        })
        .from(busabaseBaseFields)
        .innerJoin(busabaseBases, eq(busabaseBases.id, busabaseBaseFields.baseId))
        .where(eq(busabaseBaseFields.id, forwardFieldId))
        .limit(1)
    : [];
  const where = forward
    ? `${forward.baseName || forward.baseSlug} · ${fieldLabel(forward)}`
    : "the forward relation field";
  const whereSlug = forward ? `${forward.baseSlug}.${forward.slug}` : forwardFieldId;
  return new ORPCError("BAD_REQUEST", {
    message:
      `Field "${field.slug}" is a read-only reverse relation; its value comes from ${whereSlug}. ` +
      `Change the link on those records instead. / 「${fieldLabel(field)}」是只读的反向关联，` +
      `值来自「${where}」，请到那边修改关联。`,
    data: {
      slug: field.slug,
      reason: "reverse_relation_read_only",
      reverseOfFieldId: forwardFieldId,
      forwardBaseSlug: forward?.baseSlug ?? null,
      forwardFieldSlug: forward?.slug ?? null,
    },
  });
};

/**
 * Drop reverse columns from incoming record writes. An entry whose reverse
 * value equals the current computed value (or, on create, is empty) loses the
 * key silently; any other value throws `reverseRelationReadOnlyError`. Mutates
 * each entry's `fields` in place so every later step — validation, the stored
 * commit, projection — never sees a reverse column.
 */
export const stripReverseRelationInput = async (
  db: Db,
  baseId: string,
  baseFields: ReadonlyArray<FieldLike>,
  entries: ReadonlyArray<{ recordId: string | null; fields: Record<string, unknown> }>,
): Promise<void> => {
  const reverse = reverseRelationFields(baseFields);
  if (reverse.length === 0) return;
  const touched = entries.filter((entry) =>
    reverse.some((field) => Object.hasOwn(entry.fields, field.slug)),
  );
  if (touched.length === 0) return;
  const existingIds = touched.flatMap((entry) => (entry.recordId ? [entry.recordId] : []));
  const current = existingIds.length
    ? await resolveReverseRelationValues(
        db,
        existingIds.map((id) => ({ id, baseId })),
        new Map([[baseId, baseFields]]),
      )
    : new Map<string, Record<string, string[]>>();
  for (const entry of touched) {
    for (const field of reverse) {
      if (!Object.hasOwn(entry.fields, field.slug)) continue;
      const incoming = toIdList(entry.fields[field.slug]);
      const now = entry.recordId ? (current.get(entry.recordId)?.[field.slug] ?? []) : [];
      if (incoming === null || !sameIdSet(incoming, now)) {
        throw await reverseRelationReadOnlyError(db, field);
      }
      delete entry.fields[field.slug];
    }
  }
};

const badReverseOptions = (slug: string, reason: string, message: string) =>
  new ORPCError("BAD_REQUEST", {
    message: `Field "${slug}": ${message}`,
    data: { slug, reason },
  });

/**
 * Validate and normalise `options.reverseOfFieldId` on a field create. The
 * forward field must be a live, non-reverse `relation` field on this field's
 * target Base that points back at this Base, and may have only one reverse
 * column. `targetBaseId` defaults to the forward field's Base, and `multiple`
 * is forced on (one company has many opportunities). Returns the options
 * unchanged when there is no `reverseOfFieldId`.
 */
export const resolveReverseRelationOptions = async <T extends Record<string, unknown>>(
  db: Db,
  args: {
    baseId: string;
    slug: string;
    type: string;
    options: T;
    /** The field being updated, so it is not counted as a duplicate reverse. */
    selfFieldId?: string;
  },
): Promise<T> => {
  const reverseOfFieldId = args.options?.reverseOfFieldId;
  if (reverseOfFieldId === undefined || reverseOfFieldId === null) return args.options;
  if (typeof reverseOfFieldId !== "string" || reverseOfFieldId.length === 0) {
    throw badReverseOptions(args.slug, "invalid", "reverseOfFieldId must be a field id.");
  }
  if (args.type !== "relation") {
    throw badReverseOptions(
      args.slug,
      "not_relation",
      `reverseOfFieldId only applies to relation fields, not "${args.type}".`,
    );
  }
  const [forwardField] = await db
    .select({
      id: busabaseBaseFields.id,
      baseId: busabaseBaseFields.baseId,
      slug: busabaseBaseFields.slug,
      type: busabaseBaseFields.type,
      options: busabaseBaseFields.options,
    })
    .from(busabaseBaseFields)
    .innerJoin(busabaseBases, eq(busabaseBases.id, busabaseBaseFields.baseId))
    .where(
      and(
        eq(busabaseBaseFields.id, reverseOfFieldId),
        eq(busabaseBases.spaceId, getContextSpaceId()),
        isNull(busabaseBaseFields.deletedAt),
      ),
    )
    .limit(1);
  if (!forwardField) {
    throw badReverseOptions(
      args.slug,
      "forward_not_found",
      `reverseOfFieldId ${reverseOfFieldId} is not a live field in this space.`,
    );
  }
  if (forwardField.type !== "relation") {
    throw badReverseOptions(
      args.slug,
      "forward_not_relation",
      `reverseOfFieldId must name a relation field; "${forwardField.slug}" is a ${forwardField.type} field.`,
    );
  }
  if (typeof forwardField.options?.reverseOfFieldId === "string") {
    throw badReverseOptions(
      args.slug,
      "forward_is_reverse",
      `"${forwardField.slug}" is itself a reverse column; point at the field that stores the links.`,
    );
  }
  const explicitTarget = args.options.targetBaseId;
  if (
    typeof explicitTarget === "string" &&
    explicitTarget &&
    explicitTarget !== forwardField.baseId
  ) {
    throw badReverseOptions(
      args.slug,
      "target_mismatch",
      `targetBaseId must be the Base that holds "${forwardField.slug}" (${forwardField.baseId}).`,
    );
  }
  if (forwardField.options?.targetBaseId !== args.baseId) {
    throw badReverseOptions(
      args.slug,
      "forward_points_elsewhere",
      `"${forwardField.slug}" links to a different Base, so it has no reverse here.`,
    );
  }
  if (args.options.multiple === false) {
    throw badReverseOptions(
      args.slug,
      "single_value",
      "a reverse column always lists every linking record; drop multiple:false.",
    );
  }
  const duplicates = await db
    .select({
      id: busabaseBaseFields.id,
      slug: busabaseBaseFields.slug,
      options: busabaseBaseFields.options,
    })
    .from(busabaseBaseFields)
    .where(
      and(
        eq(busabaseBaseFields.baseId, args.baseId),
        eq(busabaseBaseFields.type, "relation"),
        isNull(busabaseBaseFields.deletedAt),
        ...(args.selfFieldId ? [ne(busabaseBaseFields.id, args.selfFieldId)] : []),
      ),
    );
  const duplicate = duplicates.find(
    (field) =>
      (field.options as { reverseOfFieldId?: string } | null)?.reverseOfFieldId ===
      reverseOfFieldId,
  );
  if (duplicate) {
    throw badReverseOptions(
      args.slug,
      "duplicate_reverse",
      `"${forwardField.slug}" already has a reverse column here ("${duplicate.slug}").`,
    );
  }
  return { ...args.options, targetBaseId: forwardField.baseId, multiple: true };
};

/** True when a relation field already holds stored links or values. */
const relationFieldHasData = async (db: Db, fieldId: string): Promise<boolean> => {
  const [link] = await db
    .select({ id: busabaseRecordLinks.id })
    .from(busabaseRecordLinks)
    .where(and(eq(busabaseRecordLinks.fieldId, fieldId), isNull(busabaseRecordLinks.deletedAt)))
    .limit(1);
  if (link) return true;
  const [value] = await db
    .select({ id: busabaseFieldValues.id })
    .from(busabaseFieldValues)
    .where(and(eq(busabaseFieldValues.fieldId, fieldId), isNull(busabaseFieldValues.deletedAt)))
    .limit(1);
  return Boolean(value);
};

/** Live reverse column of `forwardFieldId`, if any. */
export const findReverseColumnOf = async (db: Db, forwardFieldId: string) => {
  const rows = await db
    .select({
      id: busabaseBaseFields.id,
      slug: busabaseBaseFields.slug,
      baseId: busabaseBaseFields.baseId,
      options: busabaseBaseFields.options,
    })
    .from(busabaseBaseFields)
    .innerJoin(busabaseBases, eq(busabaseBases.id, busabaseBaseFields.baseId))
    .where(
      and(
        eq(busabaseBaseFields.type, "relation"),
        isNull(busabaseBaseFields.deletedAt),
        eq(busabaseBases.spaceId, getContextSpaceId()),
      ),
    );
  return (
    rows.find(
      (row) =>
        (row.options as { reverseOfFieldId?: string } | null)?.reverseOfFieldId === forwardFieldId,
    ) ?? null
  );
};

/**
 * Validate a field-options patch against the reverse-column rules:
 * - a reverse column keeps its `reverseOfFieldId` (carried over when the patch
 *   omits it) and its target; it cannot be repointed;
 * - an existing relation can become a reverse column only while it is empty
 *   (the package installer creates fields first and pairs them afterwards);
 * - a forward field with a reverse column cannot change its target Base.
 * Returns the options to persist.
 */
export const resolveReverseRelationPatch = async <T extends Record<string, unknown>>(
  db: Db,
  field: {
    id: string;
    baseId: string;
    slug: string;
    type: string;
    options: Record<string, unknown> | null;
  },
  patchOptions: T,
): Promise<T> => {
  if (field.type !== "relation") {
    return resolveReverseRelationOptions(db, {
      baseId: field.baseId,
      slug: field.slug,
      type: field.type,
      options: patchOptions,
      selfFieldId: field.id,
    });
  }
  const currentReverse = reverseOfFieldIdOf(field as FieldLike);
  const nextReverse = patchOptions.reverseOfFieldId;
  if (currentReverse) {
    if (nextReverse !== undefined && nextReverse !== currentReverse) {
      throw badReverseOptions(
        field.slug,
        "reverse_immutable",
        "a reverse column cannot be repointed or turned back into a stored relation; create a new field instead.",
      );
    }
    if (
      typeof patchOptions.targetBaseId === "string" &&
      patchOptions.targetBaseId !== field.options?.targetBaseId
    ) {
      throw badReverseOptions(
        field.slug,
        "reverse_immutable",
        "a reverse column cannot change its target Base.",
      );
    }
    if (patchOptions.multiple === false) {
      throw badReverseOptions(
        field.slug,
        "single_value",
        "a reverse column is always multi-value.",
      );
    }
    return {
      ...patchOptions,
      reverseOfFieldId: currentReverse,
      targetBaseId: field.options?.targetBaseId,
      multiple: true,
    };
  }
  if (typeof nextReverse === "string" && nextReverse.length > 0) {
    if (await relationFieldHasData(db, field.id)) {
      throw badReverseOptions(
        field.slug,
        "has_data",
        "only an empty relation field can become a reverse column; create a new field instead.",
      );
    }
    return resolveReverseRelationOptions(db, {
      baseId: field.baseId,
      slug: field.slug,
      type: field.type,
      options: patchOptions,
      selfFieldId: field.id,
    });
  }
  const reverseColumn = await findReverseColumnOf(db, field.id);
  if (
    reverseColumn &&
    typeof patchOptions.targetBaseId === "string" &&
    patchOptions.targetBaseId !== field.options?.targetBaseId
  ) {
    throw badReverseOptions(
      field.slug,
      "forward_has_reverse",
      `it has a reverse column ("${reverseColumn.slug}"); delete that column before changing the target Base.`,
    );
  }
  return patchOptions;
};

/** Refuse to delete a forward field while its reverse column is still live. */
export const assertForwardFieldDeletableOrThrow = async (
  db: Db,
  field: { id: string; slug: string },
) => {
  const reverseColumn = await findReverseColumnOf(db, field.id);
  if (reverseColumn) {
    throw badReverseOptions(
      field.slug,
      "forward_has_reverse",
      `it has a reverse column ("${reverseColumn.slug}") that reads its links. Delete the reverse column first.`,
    );
  }
};

/**
 * Point the pair's `inverseFieldId`s at each other once a reverse column
 * exists, so the existing field-dependency hints keep working. Safe to run
 * inside or outside a merge transaction (takes `db`).
 */
export const pairReverseRelationFields = async (
  db: Db,
  reverseFieldId: string,
  forwardFieldId: string,
) => {
  const rows = await db
    .select({ id: busabaseBaseFields.id, options: busabaseBaseFields.options })
    .from(busabaseBaseFields)
    .where(inArray(busabaseBaseFields.id, [reverseFieldId, forwardFieldId]));
  for (const row of rows) {
    const inverseFieldId = row.id === reverseFieldId ? forwardFieldId : reverseFieldId;
    if (row.options?.inverseFieldId === inverseFieldId) continue;
    await db
      .update(busabaseBaseFields)
      .set({ options: { ...(row.options ?? {}), inverseFieldId } })
      .where(eq(busabaseBaseFields.id, row.id));
  }
};

/**
 * A brand-new Base cannot carry a reverse column: its forward field would have
 * to live on another Base and already point at this one, which cannot exist
 * yet. Add the reverse column once both Bases exist.
 */
export const assertNoReverseOnNewBaseOrThrow = (
  slug: string,
  options: Record<string, unknown> | null | undefined,
) => {
  if (options?.reverseOfFieldId === undefined) return;
  throw badReverseOptions(
    slug,
    "reverse_on_new_base",
    "add a reverse column after the Base exists (its forward field must already point at this Base).",
  );
};

/** Collect every `fieldSlug` named anywhere in a filter/sort/view-config tree. */
export const collectFieldSlugs = (value: unknown, out = new Set<string>()): Set<string> => {
  if (Array.isArray(value)) {
    for (const item of value) collectFieldSlugs(item, out);
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (key === "fieldSlug" && typeof child === "string") out.add(child);
      else collectFieldSlugs(child, out);
    }
  }
  return out;
};

/**
 * Reverse columns have no stored projection, so filtering, sorting or grouping
 * by one would silently match nothing. Say so instead.
 */
export const assertNoReverseRelationQueryOrThrow = (
  fields: ReadonlyArray<FieldLike>,
  slugs: Iterable<string>,
  action: string,
) => {
  const reverseSlugs = new Set(reverseRelationFields(fields).map((field) => field.slug));
  if (reverseSlugs.size === 0) return;
  for (const slug of slugs) {
    if (!reverseSlugs.has(slug)) continue;
    throw new ORPCError("BAD_REQUEST", {
      message:
        `Cannot ${action} by "${slug}": it is a read-only reverse relation and is not indexed. ` +
        `Filter the linked Base by its forward relation field instead. / 反向关联列暂不支持筛选、排序和分组。`,
      data: { slug, reason: "reverse_relation_not_queryable" },
    });
  }
};
