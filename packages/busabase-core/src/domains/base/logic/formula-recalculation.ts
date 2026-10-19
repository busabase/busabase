import "server-only";

import { ORPCError } from "@orpc/server";
import { and, asc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { BaseFieldPO, OperationPO } from "../../../db/schema";
import {
  busabaseBaseFields,
  busabaseCommits,
  busabaseFieldValues,
  busabaseRecords,
} from "../../../db/schema";
import { parseCommitPayload } from "../../../logic/commit-payload-schemas";
import { type InsertCommitValues, insertCommits } from "../../../logic/commits";
import type { MergeCtx } from "../../../logic/cr-lifecycle";
import { formulaStaleConflict } from "../../../logic/formula-merge-conflict";
import { id } from "../../../logic/kernel";
import { normalizeFieldValue } from "../../../logic/vo";
import { assertValidFormulaField } from "../field-rules";
import { FIELD_TYPES } from "../field-types";
import { FormulaError } from "../formula";
import { collectFieldRefs } from "../formula/ast";
import { buildFieldGraph } from "../formula/dependency";
import { parseFormula } from "../formula/parser";

/** Pin references in a proposal to their field identities, not a reusable slug. */
export const formulaDependencySnapshot = (
  type: string,
  options: { formula?: { expression?: string } } | null | undefined,
  fields: ReadonlyArray<{ id: string; slug: string }>,
): Record<string, string> | undefined => {
  if (type !== "formula" || !options?.formula?.expression) return undefined;
  const bySlug = new Map(fields.map((field) => [field.slug, field.id]));
  return Object.fromEntries(
    collectFieldRefs(parseFormula(options.formula.expression)).flatMap((slug) => {
      const fieldId = bySlug.get(slug);
      return fieldId ? [[slug, fieldId]] : [];
    }),
  );
};

export const assertFormulaMergeValid = (
  field: Pick<BaseFieldPO, "type" | "slug" | "options"> & { id?: string },
  fields: ReadonlyArray<Pick<BaseFieldPO, "type" | "slug" | "options"> & { id?: string }>,
  dependencySnapshot?: unknown,
): void => {
  // A deleted/replaced pinned dependency is a revisable merge conflict, even
  // when ordinary formula validation would first report an unknown reference.
  if (field.type === "formula" && dependencySnapshot && typeof dependencySnapshot === "object") {
    const bySlug = new Map(fields.map((def) => [def.slug, def.id]));
    for (const [slug, fieldId] of Object.entries(dependencySnapshot)) {
      if (typeof fieldId !== "string" || bySlug.get(slug) !== fieldId) {
        throw formulaStaleConflict(
          `Formula dependency changed since this request was created: ${slug}. Revise the formula before merging, or close it and submit a new request.`,
          {
            reason: "formula_dependency_changed",
            fieldId: field.id,
            fieldSlug: field.slug,
            dependencySlug: slug,
          },
        );
      }
    }
  }
  try {
    assertValidFormulaField(field.type, field.slug, field.options, fields);
  } catch (error) {
    if (error instanceof FormulaError) {
      throw new ORPCError("BAD_REQUEST", { message: error.message });
    }
    throw error;
  }
};

/** Revisions accept the UI's whole payload, including its hidden stale metadata. */
export const rebaselineFormulaOperation = async (
  db: MergeCtx["db"],
  operation: OperationPO,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> => {
  if (
    !operation.baseId ||
    (operation.operation !== "base_add_field" && operation.operation !== "base_update_field")
  ) {
    return payload;
  }
  if (
    typeof payload.type === "string" &&
    payload.type !== "formula" &&
    payload.formulaDependencies === undefined &&
    payload.formulaBaseExpression === undefined
  ) {
    return payload;
  }
  const fields = await db
    .select()
    .from(busabaseBaseFields)
    .where(
      and(eq(busabaseBaseFields.baseId, operation.baseId), isNull(busabaseBaseFields.deletedAt)),
    );
  const proposal = parseCommitPayload(operation.operation, payload);
  const current =
    "fieldId" in proposal ? fields.find((def) => def.id === proposal.fieldId) : undefined;
  if (operation.operation === "base_update_field" && !current) {
    throw new ORPCError("NOT_FOUND", { message: `Field not found: ${proposal.fieldId}` });
  }
  const type = current?.type ?? proposal.type;
  if (type !== "formula") return payload;
  const slug = current?.slug ?? proposal.slug;
  if (!slug) throw new ORPCError("BAD_REQUEST", { message: "Formula field slug is required" });
  const options = (proposal.options ?? current?.options ?? {}) as BaseFieldPO["options"];
  assertFormulaMergeValid({ type, slug, options }, fields);
  return {
    ...payload,
    formulaDependencies: formulaDependencySnapshot(type, options, fields),
    ...(operation.operation === "base_update_field"
      ? { formulaBaseExpression: current?.options.formula?.expression }
      : {}),
  };
};

/**
 * Called inside the schema merge's transaction while its Base row is locked.
 * Derived snapshots preserve the immutable prior commits and record audit data;
 * only affected formulas are projected, without record-edit hooks or automation.
 */
export const recalculateFormulaRecords = async (
  ctx: MergeCtx,
  baseId: string,
  changedSlug: string | null,
  operationId: string,
  recordIds?: ReadonlyArray<string>,
): Promise<number> => {
  const db = ctx.db;
  const defs = await db
    .select()
    .from(busabaseBaseFields)
    .where(and(eq(busabaseBaseFields.baseId, baseId), isNull(busabaseBaseFields.deletedAt)));
  const graph = buildFieldGraph(defs);
  const affected = new Set(changedSlug ? [changedSlug] : defs.map((def) => def.slug));
  const pending = changedSlug ? [changedSlug] : [];
  for (let index = 0; index < pending.length; index++) {
    const source = pending[index];
    if (!source) continue;
    for (const dependent of graph.neighbors(source)) {
      if (affected.has(dependent)) continue;
      affected.add(dependent);
      pending.push(dependent);
    }
  }
  const defsBySlug = new Map(defs.map((def) => [def.slug, def]));
  const order = graph.topologicalSort();
  if (!order) throw new ORPCError("BAD_REQUEST", { message: "Formula dependency cycle" });
  const formulaDefs = order.flatMap((slug) => {
    const def = defsBySlug.get(slug);
    return def?.type === "formula" && affected.has(slug) ? [def] : [];
  });
  if (formulaDefs.length === 0) return 0;

  const CHUNK_SIZE = 200;
  let cursor = "";
  let total = 0;
  for (;;) {
    const records = await db
      .select({ record: busabaseRecords, commit: busabaseCommits })
      .from(busabaseRecords)
      .innerJoin(busabaseCommits, eq(busabaseRecords.headCommitId, busabaseCommits.id))
      .where(
        and(
          eq(busabaseRecords.baseId, baseId),
          eq(busabaseRecords.status, "active"),
          gt(busabaseRecords.id, cursor),
          recordIds ? inArray(busabaseRecords.id, [...recordIds]) : undefined,
        ),
      )
      .orderBy(asc(busabaseRecords.id))
      .limit(CHUNK_SIZE);
    if (records.length === 0) break;
    const commits: InsertCommitValues[] = [];
    const heads: Array<{ recordId: string; commitId: string }> = [];
    const projected: Array<typeof busabaseFieldValues.$inferInsert> = [];
    for (const { record, commit } of records) {
      const fields = { ...commit.payload };
      for (const def of formulaDefs) {
        fields[def.slug] =
          FIELD_TYPES.formula.compute?.({
            mode: "update",
            actorId: ctx.actorId,
            def,
            defs,
            values: fields,
            existing: commit.payload,
            slug: def.slug,
            timestampIso: record.updatedAt.toISOString(),
            nextAutoNumber: () => null,
            recordId: record.id,
            recordCreatedAtIso: record.createdAt.toISOString(),
          }) ?? null;
      }
      const commitId = id("cmt");
      commits.push({
        id: commitId,
        spaceId: record.spaceId,
        baseId,
        operationId,
        parentCommitId: commit.id,
        payload: fields,
        operation: "record_update",
        message: `Recalculate formula ${changedSlug ?? "fields"}`,
        // This snapshot is a derived projection of the same user edit. Its
        // originating schema operation already identifies who changed the rule.
        author: commit.author,
        createdAt: ctx.timestamp,
      });
      heads.push({ recordId: record.id, commitId });
      if (ctx.targetRecordsById.has(record.id)) {
        ctx.targetRecordsById.set(record.id, { ...record, headCommitId: commitId });
      }
      for (const def of formulaDefs) {
        projected.push({
          id: id("fvl"),
          spaceId: record.spaceId,
          baseId,
          recordId: record.id,
          commitId,
          fieldId: def.id,
          fieldSlug: def.slug,
          fieldType: "formula",
          ...normalizeFieldValue(fields[def.slug], "formula"),
          createdAt: ctx.timestamp,
          updatedAt: ctx.timestamp,
        });
      }
    }
    await insertCommits(db, commits);
    // The Base lock serializes source writes; update only the derived head pointer.
    // Bind every ID, including the VALUES relation, rather than interpolating SQL.
    await db.execute(sql`
      update ${busabaseRecords}
      set head_commit_id = derived.commit_id
      from (values ${sql.join(
        heads.map(({ recordId, commitId }) => sql`(${recordId}::text, ${commitId}::text)`),
        sql`, `,
      )}) as derived(record_id, commit_id)
      where ${busabaseRecords.id} = derived.record_id
    `);
    await db.delete(busabaseFieldValues).where(
      and(
        inArray(
          busabaseFieldValues.recordId,
          records.map(({ record }) => record.id),
        ),
        inArray(
          busabaseFieldValues.fieldId,
          formulaDefs.map((def) => def.id),
        ),
        isNull(busabaseFieldValues.changeRequestId),
        isNull(busabaseFieldValues.deletedAt),
      ),
    );
    // A wide Base can have many dependent formulas: also bound INSERT parameters.
    for (let offset = 0; offset < projected.length; offset += 500) {
      await db.insert(busabaseFieldValues).values(projected.slice(offset, offset + 500));
    }
    total += records.length;
    const last = records[records.length - 1];
    if (!last || records.length < CHUNK_SIZE) break;
    cursor = last.record.id;
  }
  return total;
};
