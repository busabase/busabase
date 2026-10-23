import "server-only";

import { ORPCError } from "@orpc/server";
import { mapViewFilters, type ViewConfigVO } from "busabase-contract/types";
import { and, count, eq, isNull, max, ne } from "drizzle-orm";
import { getContextSpaceId, resolveActorId } from "../../../../context";
import type { CommitPO, OperationPO, ViewPO } from "../../../../db/schema";
import {
  busabaseBaseFields,
  busabaseBases,
  busabaseOperations,
  busabaseViews,
} from "../../../../db/schema";
import { parseCommitPayload } from "../../../../logic/commit-payload-schemas";
import type { MergeCtx } from "../../../../logic/cr-lifecycle";
import { CURRENT_USER_ID, id, requireBaseId } from "../../../../logic/kernel";
import { normalizeViewConfig } from "../../../../logic/vo";
import { compareViewOrder } from "../../utils/view-order";
import { lastViewDeleteRejected } from "../errors";

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
    return entry.fieldId ? entry : fieldId ? { ...entry, fieldId } : entry;
  };
  return {
    ...config,
    filters: mapViewFilters(config.filters, stamp),
    sorts: config.sorts.map(stamp),
  };
};

/** Same reachable-race reasoning as record.ts's targetRecordNotFound, for a
 *  view target that's gone by merge time. */
const targetViewNotFound = (viewId: string | null) =>
  new ORPCError("NOT_FOUND", { message: `Target view not found: ${viewId}` });

const countOtherActiveViews = async (ctx: MergeCtx, baseId: string, viewId: string) => {
  const [row] = await ctx.db
    .select({ total: count() })
    .from(busabaseViews)
    .where(
      and(
        eq(busabaseViews.baseId, baseId),
        eq(busabaseViews.status, "active"),
        ne(busabaseViews.id, viewId),
      ),
    );
  return Number(row?.total ?? 0);
};

/**
 * Move `view` to `requestedPosition` (0-based) among its Base's active views.
 *
 * Same approach as mergeNodeMove: renumber EVERY active sibling to 0..n-1 with
 * the moved view spliced in at the clamped index. Writing the requested value
 * onto the moved view alone would tie with whichever sibling already holds it,
 * and the (position, createdAt) tie-break would then silently undo the move.
 */
const moveViewToPosition = async (ctx: MergeCtx, view: ViewPO, requestedPosition: number) => {
  const siblings = await ctx.db
    .select({
      id: busabaseViews.id,
      position: busabaseViews.position,
      createdAt: busabaseViews.createdAt,
    })
    .from(busabaseViews)
    .where(
      and(
        eq(busabaseViews.baseId, view.baseId),
        eq(busabaseViews.status, "active"),
        ne(busabaseViews.id, view.id),
      ),
    );
  siblings.sort(compareViewOrder);
  const insertIndex = Math.max(0, Math.min(requestedPosition, siblings.length));
  const orderedIds = siblings.map((sibling) => sibling.id);
  orderedIds.splice(insertIndex, 0, view.id);
  await Promise.all(
    orderedIds.map((viewId, position) =>
      ctx.db
        .update(busabaseViews)
        .set({ position, ...(viewId === view.id ? { updatedAt: ctx.timestamp } : {}) })
        .where(eq(busabaseViews.id, viewId)),
    ),
  );
};

export const mergeViewCreate = async (ctx: MergeCtx, item: OperationPO, headCommit: CommitPO) => {
  const { db, timestamp } = ctx;
  const baseId = requireBaseId(item.baseId, item.operation);
  const viewId = id("viw");
  const viewFields = parseCommitPayload("view_create", headCommit.payload);
  // TOCTOU guard: createViewChangeRequest's propose-time slug check only sees
  // views that existed at proposal time. Two CRs proposed before either merges
  // can both pass, then race to merge — without this check the second hits the
  // DB's unique(baseId, slug) index and 500s instead of returning a clean conflict.
  const [existingSibling] = await db
    .select({ id: busabaseViews.id, name: busabaseViews.name })
    .from(busabaseViews)
    .where(
      and(
        eq(busabaseViews.baseId, baseId),
        eq(busabaseViews.slug, viewFields.slug),
        isNull(busabaseViews.archivedAt),
      ),
    )
    .limit(1);
  if (existingSibling) {
    throw new ORPCError("CONFLICT", {
      message: `A view with slug "${viewFields.slug}" already exists in this Base ("${existingSibling.name}"). Choose a different slug.`,
    });
  }
  // A new view joins the end of the Base's shared tab order.
  const [{ maxPosition } = { maxPosition: null }] = await db
    .select({ maxPosition: max(busabaseViews.position) })
    .from(busabaseViews)
    .where(and(eq(busabaseViews.baseId, baseId), eq(busabaseViews.status, "active")));
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
    position: maxPosition === null ? 0 : maxPosition + 1,
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
  const viewFields = parseCommitPayload("view_update", headCommit.payload);
  if (viewFields.position !== undefined) {
    await moveViewToPosition(ctx, targetView, viewFields.position);
  }
  // A pure reorder (`{ position }` only — see createUpdateViewChangeRequest)
  // leaves the view's content alone rather than rewriting it from the snapshot
  // loaded before this transaction.
  const touchesContent =
    viewFields.config !== undefined ||
    viewFields.description !== undefined ||
    viewFields.name !== undefined ||
    viewFields.type !== undefined;
  if (touchesContent) {
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
  }
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
  // Re-checked HERE, inside the merge transaction, not just at proposal time:
  // two delete CRs proposed against a two-view Base each pass the propose-time
  // check, and merging both would leave the Base with no view at all. Locking
  // the Base row serializes concurrent view deletes on it, so the count below
  // sees whatever the other merge committed.
  await db
    .select({ id: busabaseBases.id })
    .from(busabaseBases)
    .where(eq(busabaseBases.id, targetView.baseId))
    .for("update");
  if ((await countOtherActiveViews(ctx, targetView.baseId, targetView.id)) === 0) {
    throw lastViewDeleteRejected();
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
