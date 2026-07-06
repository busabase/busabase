import "server-only";

import { ORPCError } from "@orpc/server";
import { and, eq, isNull, ne } from "drizzle-orm";
import { iStringToText } from "openlib/i18n/i-string";
import { getContextSpaceId } from "../../../../context";
import type { CommitPO, OperationPO } from "../../../../db/schema";
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
import { resolveRelationFieldOptions } from "../relation-options";

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
      ).map(async (field, index) => ({
        id: id("bsf"),
        spaceId: getContextSpaceId(),
        baseId,
        slug: field.slug,
        name: iStringToText(field.name),
        type: field.type ?? "text",
        required: field.required ?? false,
        position: index,
        // Resolve targetBaseSlug → id on the SAME merge transaction (ctx.db) — a
        // node-CR base-create commit stores field options verbatim, so this is
        // where the node path's relation slug is resolved.
        options: await resolveRelationFieldOptions(db, field.options ?? {}),
      })),
    ),
  );
  return baseNodeId;
};

registerMaterializer("base", materializeBaseNode);

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
      spaceId: busabaseBases.spaceId,
      nodeId: busabaseBases.nodeId,
      archivedAt: busabaseBases.archivedAt,
    })
    .from(busabaseBases)
    .where(eq(busabaseBases.id, baseId))
    .limit(1);
  if (!target) {
    throw new Error(`base_restore target not found: ${baseId}`);
  }
  // Restore-after-reuse: if a new active base grabbed this slug while it was
  // archived, restoring would collide on the (now partial) unique index. Fail
  // with a clear message instead of a raw constraint violation.
  const [slugTaken] = await db
    .select({ id: busabaseBases.id })
    .from(busabaseBases)
    .where(
      and(
        eq(busabaseBases.spaceId, target.spaceId),
        eq(busabaseBases.slug, target.slug),
        isNull(busabaseBases.archivedAt),
        ne(busabaseBases.id, baseId),
      ),
    )
    .limit(1);
  if (slugTaken) {
    throw new ORPCError("CONFLICT", {
      message: `Cannot restore: the slug "${target.slug}" is now used by another base. Rename it first.`,
    });
  }
  await db.update(busabaseBases).set({ archivedAt: null }).where(eq(busabaseBases.id, baseId));
  await db
    .update(busabaseNodes)
    .set({ archivedAt: null, updatedAt: timestamp })
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
