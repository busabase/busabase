import "server-only";

import { ORPCError } from "@orpc/server";
import { and, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { getContextSpaceId } from "../../../context";
import type { getDb } from "../../../db";
import { type BaseFieldPO, busabaseBaseFields, busabaseBases } from "../../../db/schema";
import { buildNodeVisibilityExists } from "../../../logic/node-acl";
import { buildFieldGraph } from "../formula/dependency";
import { isDeletableFieldType } from "../utils/field-capabilities";

/** Rechecked inside the Base-locked merge transaction, against current definitions. */
export async function assertFieldDeletable(
  db: Awaited<ReturnType<typeof getDb>>,
  field: Pick<BaseFieldPO, "id" | "baseId" | "slug" | "type">,
): Promise<void> {
  if (!isDeletableFieldType(field.type)) {
    throw new ORPCError("BAD_REQUEST", { message: `Cannot delete system field: ${field.slug}` });
  }
  if (field.type !== "lookup" && field.type !== "formula") return;

  const fields = await db
    .select({
      slug: busabaseBaseFields.slug,
      type: busabaseBaseFields.type,
      options: busabaseBaseFields.options,
    })
    .from(busabaseBaseFields)
    .where(
      and(
        eq(busabaseBaseFields.baseId, field.baseId),
        eq(busabaseBaseFields.spaceId, getContextSpaceId()),
        eq(busabaseBaseFields.type, "formula"),
        isNull(busabaseBaseFields.deletedAt),
      ),
    );
  const dependents = buildFieldGraph(fields)
    .neighbors(field.slug)
    .filter((slug) => slug !== field.slug);
  if (dependents.length > 0) {
    throw new ORPCError("BAD_REQUEST", {
      message: `Cannot delete ${field.type} field "${field.slug}" while formula fields reference it: ${dependents.join(", ")}. Update those formulas first.`,
      data: {
        reason:
          field.type === "lookup" ? "lookup_has_formula_dependents" : "formula_has_dependents",
        fieldSlug: field.slug,
        dependentFieldSlugs: dependents,
      },
    });
  }
  if (field.type !== "formula") return;

  // Follow only structural metadata, never records or their hydrated values.
  // Each candidate Base is space-scoped before the indexed (base_id, slug) hop.
  const relation = alias(busabaseBaseFields, "deletion_relation");
  const lookup = alias(busabaseBaseFields, "deletion_lookup");
  const visibility = buildNodeVisibilityExists(db, busabaseBases.nodeId) ?? sql`true`;
  const lookupDependents = await db
    .select({
      baseId: busabaseBases.id,
      baseSlug: busabaseBases.slug,
      fieldId: lookup.id,
      fieldSlug: lookup.slug,
      visible: sql<boolean>`${visibility}`,
    })
    .from(busabaseBases)
    .innerJoin(
      relation,
      and(
        eq(relation.baseId, busabaseBases.id),
        eq(relation.spaceId, busabaseBases.spaceId),
        eq(relation.type, "relation"),
        isNull(relation.deletedAt),
        sql`${relation.options}->>'targetBaseId' = ${field.baseId}`,
      ),
    )
    .innerJoin(
      lookup,
      and(
        eq(lookup.baseId, busabaseBases.id),
        eq(lookup.spaceId, busabaseBases.spaceId),
        eq(lookup.type, "lookup"),
        isNull(lookup.deletedAt),
        sql`${lookup.options}->'lookup'->>'relationFieldSlug' = ${relation.slug}`,
        sql`${lookup.options}->'lookup'->>'targetFieldSlug' = ${field.slug}`,
      ),
    )
    .where(
      and(
        eq(busabaseBases.spaceId, getContextSpaceId()),
        isNull(busabaseBases.archivedAt),
        isNull(busabaseBases.deletedAt),
      ),
    );
  if (lookupDependents.length === 0) return;
  const visible = lookupDependents
    .filter((dependent) => dependent.visible)
    .map(({ visible: _visible, ...dependent }) => dependent);
  throw new ORPCError("BAD_REQUEST", {
    message: `Cannot delete formula field "${field.slug}" while lookup fields reference it. Update those lookup fields first.`,
    data: {
      reason: "formula_has_lookup_dependents",
      fieldSlug: field.slug,
      dependents: visible,
      hasRestrictedDependents: visible.length < lookupDependents.length,
    },
  });
}
