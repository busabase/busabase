import "server-only";

import { ORPCError } from "@orpc/server";
import type { ViewConfigVO, ViewType } from "busabase-contract/types";
import { and, eq, isNull } from "drizzle-orm";
import { getContextSpaceId, resolveActorId } from "../../../../context";
import type { CommitPO, OperationPO } from "../../../../db/schema";
import { busabaseBaseFields, busabaseOperations, busabaseViews } from "../../../../db/schema";
import type { MergeCtx } from "../../../../logic/cr-lifecycle";
import { CURRENT_USER_ID, id, requireBaseId } from "../../../../logic/kernel";
import { normalizeViewConfig } from "../../../../logic/vo";

/**
 * Stamp the stable `fieldId` onto every filter/sort entry by resolving each
 * `fieldSlug` against the base's active (non-deleted) fields. This is what makes
 * filter cleanup on field-delete slug-reuse safe (Fix 6).
 */
const stampFieldIds = async (
  ctx: MergeCtx,
  baseId: string,
  config: ViewConfigVO,
): Promise<ViewConfigVO> => {
  const fieldRows = await ctx.db
    .select({ id: busabaseBaseFields.id, slug: busabaseBaseFields.slug })
    .from(busabaseBaseFields)
    .where(and(eq(busabaseBaseFields.baseId, baseId), isNull(busabaseBaseFields.deletedAt)));
  const idBySlug = new Map(fieldRows.map((f) => [f.slug, f.id]));
  const stamp = <T extends { fieldSlug: string; fieldId?: string }>(entry: T): T => {
    const fieldId = idBySlug.get(entry.fieldSlug);
    return fieldId ? { ...entry, fieldId } : entry;
  };
  return {
    ...config,
    filters: config.filters.map(stamp),
    sorts: config.sorts.map(stamp),
  };
};

/** Same reachable-race reasoning as record.ts's targetRecordNotFound, for a
 *  view target that's gone by merge time. */
const targetViewNotFound = (viewId: string | null) =>
  new ORPCError("NOT_FOUND", { message: `Target view not found: ${viewId}` });

export const mergeViewCreate = async (ctx: MergeCtx, item: OperationPO, headCommit: CommitPO) => {
  const { db, timestamp } = ctx;
  const baseId = requireBaseId(item.baseId, item.operation);
  const viewId = id("viw");
  const viewFields = headCommit.fields as {
    config?: ViewConfigVO;
    description?: string;
    name?: string;
    slug?: string;
    type?: ViewType;
  };
  if (!viewFields.name || !viewFields.slug) {
    throw new Error(`View create commit missing name or slug: ${item.id}`);
  }
  await db.insert(busabaseViews).values({
    id: viewId,
    spaceId: getContextSpaceId(),
    baseId,
    slug: viewFields.slug,
    name: viewFields.name,
    description: viewFields.description ?? "",
    type: viewFields.type ?? "table",
    config: await stampFieldIds(ctx, baseId, normalizeViewConfig(viewFields.config ?? {})),
    status: "active",
    createdBy: resolveActorId(CURRENT_USER_ID),
    archivedAt: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
  await db
    .update(busabaseOperations)
    .set({ status: "merged", mergedViewId: viewId, updatedAt: timestamp })
    .where(eq(busabaseOperations.id, item.id));
  ctx.mergedViewIds.push(viewId);
};

export const mergeViewUpdate = async (ctx: MergeCtx, item: OperationPO, headCommit: CommitPO) => {
  const { db, timestamp } = ctx;
  const targetView = item.targetViewId ? ctx.targetViewsById.get(item.targetViewId) : undefined;
  if (!targetView) {
    throw targetViewNotFound(item.targetViewId);
  }
  const viewFields = headCommit.fields as {
    config?: ViewConfigVO;
    description?: string;
    name?: string;
    type?: ViewType;
  };
  await db
    .update(busabaseViews)
    .set({
      config: await stampFieldIds(
        ctx,
        targetView.baseId,
        normalizeViewConfig(viewFields.config ?? targetView.config),
      ),
      description: viewFields.description ?? targetView.description,
      name: viewFields.name ?? targetView.name,
      type: viewFields.type ?? targetView.type,
      updatedAt: timestamp,
    })
    .where(eq(busabaseViews.id, targetView.id));
  await db
    .update(busabaseOperations)
    .set({ status: "merged", mergedViewId: targetView.id, updatedAt: timestamp })
    .where(eq(busabaseOperations.id, item.id));
  ctx.mergedViewIds.push(targetView.id);
};

export const mergeViewDelete = async (ctx: MergeCtx, item: OperationPO, _headCommit: CommitPO) => {
  const { db, timestamp } = ctx;
  const targetView = item.targetViewId ? ctx.targetViewsById.get(item.targetViewId) : undefined;
  if (!targetView) {
    throw targetViewNotFound(item.targetViewId);
  }
  await db
    .update(busabaseViews)
    .set({ archivedAt: timestamp, status: "archived", updatedAt: timestamp })
    .where(eq(busabaseViews.id, targetView.id));
  await db
    .update(busabaseOperations)
    .set({ status: "archived", mergedViewId: targetView.id, updatedAt: timestamp })
    .where(eq(busabaseOperations.id, item.id));
  ctx.mergedViewIds.push(targetView.id);
};

export const mergeViewRestore = async (ctx: MergeCtx, item: OperationPO, _headCommit: CommitPO) => {
  const { db, timestamp } = ctx;
  const targetView = item.targetViewId ? ctx.targetViewsById.get(item.targetViewId) : undefined;
  if (!targetView) {
    throw targetViewNotFound(item.targetViewId);
  }
  if (targetView.status !== "archived") {
    throw new ORPCError("CONFLICT", { message: "Cannot restore a view that is not archived" });
  }
  await db
    .update(busabaseViews)
    .set({ archivedAt: null, status: "active", updatedAt: timestamp })
    .where(eq(busabaseViews.id, targetView.id));
  await db
    .update(busabaseOperations)
    .set({ status: "merged", mergedViewId: targetView.id, updatedAt: timestamp })
    .where(eq(busabaseOperations.id, item.id));
  ctx.mergedViewIds.push(targetView.id);
};
