import "server-only";

import { ORPCError } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { iStringToText } from "openlib/i18n/i-string";
import { getContextSpaceId } from "../../../../context";
import type { BaseFieldPO, CommitPO, OperationPO } from "../../../../db/schema";
import {
  busabaseBaseFields,
  busabaseBases,
  busabaseNodes,
  busabaseOperations,
  busabaseRecords,
  busabaseViews,
} from "../../../../db/schema";
import type { MergeCtx } from "../../../../logic/cr-lifecycle";
import { id } from "../../../../logic/kernel";
import { type MaterializeArgs, registerMaterializer } from "../../../../logic/materialize";
import { registerNodeRuntime } from "../../../../logic/node-runtime";
import { findAvailableNodeSlug } from "../../../../logic/node-slug";
import { assertValidDateFieldOptionsOrThrow } from "../date-options";
import { insertDefaultGridView } from "../default-view";
import { assertFormulaMergeValid } from "../formula-recalculation";
import { assertRelationOnlyOptionsOrThrow, resolveRelationFieldOptions } from "../relation-options";

export const materializeBaseNode = async (
  ctx: MergeCtx,
  args: MaterializeArgs,
): Promise<string> => {
  const { db, timestamp } = ctx;
  const { parentNode, fields } = args;
  const baseNodeId = id("nod");
  const baseId = id("bse");
  await db.insert(busabaseNodes).values({
    id: baseNodeId,
    parentId: parentNode.id,
    type: "base",
    slug: fields.slug as string,
    name: fields.name as string,
    description: fields.description ?? "",
    // See materializeDocNode: without this, `metadata.visibility` supplied on
    // create was silently dropped and a Base requested as "private" came out
    // workspace-visible.
    metadata: fields.metadata ?? {},
    position: 0,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db.insert(busabaseBases).values({
    id: baseId,
    spaceId: getContextSpaceId(),
    nodeId: baseNodeId,
    slug: fields.slug as string,
    name: fields.name as string,
    description: fields.description ?? "",
    reviewPolicy: { kind: "single", requiredApprovals: 1 },
    createdAt: timestamp,
  });
  const baseFields =
    fields.fields && fields.fields.length > 0
      ? fields.fields
      : [{ slug: "title", name: "Title", type: "text" as const, required: true, options: {} }];
  const formulaDefs = baseFields.map((field) => ({
    slug: field.slug,
    type: field.type ?? "text",
    options: (field.options ?? {}) as BaseFieldPO["options"],
  }));
  for (const def of formulaDefs) assertFormulaMergeValid(def, formulaDefs);
  await db.insert(busabaseBaseFields).values(
    await Promise.all(
      (
        baseFields as Array<{
          slug: string;
          name: import("openlib/i18n/i-string").iString;
          type?: import("busabase-contract/types").FieldType;
          required?: boolean;
          options?: Record<string, unknown>;
        }>
      ).map(async (field, index) => {
        const type = field.type ?? "text";
        // A node-CR base-create commit stores field options verbatim, so this is the
        // only place the `bases.create --fields-json` path validates them.
        assertRelationOnlyOptionsOrThrow(type, field.slug, field.options);
        assertValidDateFieldOptionsOrThrow(type, field.slug, field.options);
        return {
          id: id("bsf"),
          spaceId: getContextSpaceId(),
          baseId,
          slug: field.slug,
          name: iStringToText(field.name),
          type,
          required: type === "formula" ? false : (field.required ?? false),
          position: index,
          // Resolve targetBaseSlug → id on the SAME merge transaction (ctx.db), which
          // is where the node path's relation slug is resolved.
          options: await resolveRelationFieldOptions(db, field.options ?? {}),
        };
      }),
    ),
  );
  // Same rule as createBase's direct path: the Base opens on a real saved view
  // unless the creator opted out because it adds its own views right away.
  if (fields.defaultView !== false) {
    await insertDefaultGridView(db, {
      spaceId: getContextSpaceId(),
      baseId,
      createdBy: ctx.actorId,
      timestamp,
    });
  }
  return baseNodeId;
};

registerMaterializer("base", materializeBaseNode);
// A Base's typed detail is just the node row (its tables/fields/records are
// their own endpoints), so it opts into the generic shape explicitly — see
// `NodeRuntime.genericDetail` for why this is not the silent default.
registerNodeRuntime("base", { genericDetail: true });

export const mergeBaseArchive = async (ctx: MergeCtx, item: OperationPO, _headCommit: CommitPO) => {
  const { db, timestamp } = ctx;
  const baseId = item.baseId;
  if (!baseId) {
    throw new Error(`base_archive operation missing baseId: ${item.id}`);
  }
  await db.update(busabaseBases).set({ archivedAt: timestamp }).where(eq(busabaseBases.id, baseId));
  // Archive the base node in tandem so its slug is released for reuse (the
  // node's partial unique index excludes archived rows).
  const [archivedBase] = await db
    .select({ nodeId: busabaseBases.nodeId })
    .from(busabaseBases)
    .where(eq(busabaseBases.id, baseId))
    .limit(1);
  if (archivedBase) {
    await db
      .update(busabaseNodes)
      .set({ archivedAt: timestamp, updatedAt: timestamp })
      .where(eq(busabaseNodes.id, archivedBase.nodeId));
  }
  // Archive the base's records + views in lockstep — otherwise they stay
  // status="active" and leak into the global records.list / listViews while the
  // base itself is hidden (the node-delete path already does this for records).
  await db
    .update(busabaseRecords)
    .set({ status: "archived", archivedAt: timestamp, updatedAt: timestamp })
    .where(and(eq(busabaseRecords.baseId, baseId), eq(busabaseRecords.status, "active")));
  await db
    .update(busabaseViews)
    .set({ status: "archived", archivedAt: timestamp, updatedAt: timestamp })
    .where(and(eq(busabaseViews.baseId, baseId), eq(busabaseViews.status, "active")));
  await db
    .update(busabaseOperations)
    .set({ status: "merged", updatedAt: timestamp })
    .where(eq(busabaseOperations.id, item.id));
};

export const mergeBaseRestore = async (ctx: MergeCtx, item: OperationPO, _headCommit: CommitPO) => {
  const { db, timestamp } = ctx;
  const baseId = item.baseId;
  if (!baseId) {
    throw new Error(`base_restore operation missing baseId: ${item.id}`);
  }
  const [target] = await db
    .select({
      slug: busabaseBases.slug,
      name: busabaseBases.name,
      nodeId: busabaseBases.nodeId,
      archivedAt: busabaseBases.archivedAt,
      deletedAt: busabaseBases.deletedAt,
    })
    .from(busabaseBases)
    .where(eq(busabaseBases.id, baseId))
    .limit(1);
  if (!target) {
    // Same reachable-race reasoning as merge/record.ts's targetRecordNotFound —
    // the base could have been purged after the restore CR was created but
    // before it was merged. Defensive re-check; the primary gate is in cr-lifecycle.
    throw new ORPCError("NOT_FOUND", { message: `base_restore target not found: ${baseId}` });
  }
  // Defense in depth (the merge-time gate in cr-lifecycle already blocks this):
  // a permanently deleted base can never come back.
  if (target.deletedAt) {
    throw new ORPCError("CONFLICT", {
      message: "Cannot restore: this base was permanently deleted.",
    });
  }
  // Restore-after-reuse: a new base may have taken this slug while it was
  // archived. The restored base moves to the next free slug (see
  // findAvailableNodeSlug); the base that holds the slug keeps it.
  const slug = await findAvailableNodeSlug(db, {
    nodeType: "base",
    slug: target.slug,
    excludeNodeId: target.nodeId,
  });
  if (slug !== target.slug) {
    ctx.slugChanges.push({
      nodeId: target.nodeId,
      nodeType: "base",
      name: target.name,
      fromSlug: target.slug,
      toSlug: slug,
    });
  }
  await db
    .update(busabaseBases)
    .set({ slug, archivedAt: null })
    .where(eq(busabaseBases.id, baseId));
  await db
    .update(busabaseNodes)
    .set({ slug, archivedAt: null, updatedAt: timestamp })
    .where(eq(busabaseNodes.id, target.nodeId));
  // Un-archive only the records/views that were archived BY this base archive
  // (same archivedAt timestamp) — records/views deleted individually beforehand
  // keep their own archived state.
  if (target.archivedAt) {
    await db
      .update(busabaseRecords)
      .set({ status: "active", archivedAt: null, updatedAt: timestamp })
      .where(
        and(eq(busabaseRecords.baseId, baseId), eq(busabaseRecords.archivedAt, target.archivedAt)),
      );
    await db
      .update(busabaseViews)
      .set({ status: "active", archivedAt: null, updatedAt: timestamp })
      .where(
        and(eq(busabaseViews.baseId, baseId), eq(busabaseViews.archivedAt, target.archivedAt)),
      );
  }
  await db
    .update(busabaseOperations)
    .set({ status: "merged", updatedAt: timestamp })
    .where(eq(busabaseOperations.id, item.id));
};
