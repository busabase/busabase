import "server-only";

import { isDeepStrictEqual } from "node:util";
import { ORPCError } from "@orpc/server";
import {
  flattenViewFilters,
  getAutoShowNewFields,
  getVisibleViewFieldSlugs,
  mapViewFilters,
  type ViewConfigVO,
} from "busabase-contract/types";
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

type ViewFieldIdentity = { id: string; slug: string; position: number };

/** Read at most once, and only when policy inference or field-id stamping needs it. */
const lazyViewFields = (ctx: MergeCtx, baseId: string) => {
  let result: Promise<ViewFieldIdentity[]> | undefined;
  return () => {
    result ??= ctx.db
      .select({
        id: busabaseBaseFields.id,
        slug: busabaseBaseFields.slug,
        position: busabaseBaseFields.position,
      })
      .from(busabaseBaseFields)
      .where(and(eq(busabaseBaseFields.baseId, baseId), isNull(busabaseBaseFields.deletedAt)))
      .orderBy(busabaseBaseFields.position)
      .then((rows) => rows);
    return result;
  };
};

/**
 * Stamp the stable `fieldId` onto every filter/sort entry by resolving each
 * `fieldSlug` against the base's active (non-deleted) fields. This is what makes
 * filter cleanup on field-delete slug-reuse safe (Fix 6).
 */
const stampFieldIds = async (
  config: ViewConfigVO,
  getFields: () => Promise<ViewFieldIdentity[]>,
): Promise<ViewConfigVO> => {
  if (
    !flattenViewFilters(config.filters).some((filter) => !filter.fieldId) &&
    !config.sorts.some((sort) => !sort.fieldId)
  ) {
    return config;
  }
  const fieldRows = await getFields();
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
  const config = normalizeViewConfig(viewFields.config ?? {});
  const getFields = lazyViewFields(ctx, baseId);
  if (config.autoShowNewFields === undefined) {
    config.autoShowNewFields =
      viewFields.type !== "kanban" &&
      viewFields.type !== "gallery" &&
      !Array.isArray(config.visibleFieldSlugs);
  }
  if (!config.autoShowNewFields && !Array.isArray(config.visibleFieldSlugs)) {
    const fields = await getFields();
    config.visibleFieldSlugs = fields
      .map((field) => field.slug)
      .filter((slug) => !config.hiddenFieldSlugs?.includes(slug));
  }
  if (viewFields.type === "kanban") {
    config.showFieldLabels ??= true;
  }
  await db.insert(busabaseViews).values({
    id: viewId,
    spaceId: getContextSpaceId(),
    baseId,
    slug: viewFields.slug,
    name: viewFields.name,
    description: viewFields.description ?? "",
    type: viewFields.type ?? "table",
    config: await stampFieldIds(config, getFields),
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
  const [targetView] = item.targetViewId
    ? await db
        .select()
        .from(busabaseViews)
        .where(
          and(
            eq(busabaseViews.id, item.targetViewId),
            eq(busabaseViews.spaceId, getContextSpaceId()),
            eq(busabaseViews.status, "active"),
          ),
        )
        .for("update")
    : [];
  if (!targetView) {
    throw targetViewNotFound(item.targetViewId);
  }
  const viewFields = parseCommitPayload("view_update", headCommit.payload);
  const liveConfig = normalizeViewConfig(targetView.config);
  const getFields = lazyViewFields(ctx, targetView.baseId);
  let nextConfig = normalizeViewConfig(viewFields.config ?? targetView.config);
  if (viewFields.configPatch !== undefined) {
    const patch = viewFields.configPatch as Partial<ViewConfigVO>;
    const baseline = viewFields.configBase ?? {};
    for (const key of Object.keys(patch) as Array<keyof ViewConfigVO>) {
      if (
        !isDeepStrictEqual(liveConfig[key], baseline[key]) &&
        !isDeepStrictEqual(liveConfig[key], patch[key])
      ) {
        throw new ORPCError("CONFLICT", {
          message:
            "View settings changed while this request was pending. Refresh and retry the change.",
          data: { reason: "view_config_changed", viewId: targetView.id, configKey: key },
        });
      }
    }
    nextConfig = { ...liveConfig, ...patch };
    // Older API clients send only an allowlist to hide fields. Preserve that
    // intent even when the saved view now has an explicit automatic default.
    if (Array.isArray(patch.visibleFieldSlugs) && patch.autoShowNewFields === undefined) {
      nextConfig.autoShowNewFields = false;
    }
    if (patch.autoShowNewFields === false && patch.visibleFieldSlugs === undefined) {
      nextConfig.visibleFieldSlugs = getVisibleViewFieldSlugs(liveConfig, await getFields());
    }
    if (
      patch.autoShowNewFields === true &&
      patch.hiddenFieldSlugs === undefined &&
      !getAutoShowNewFields(liveConfig)
    ) {
      const fields = await getFields();
      const visible = new Set(getVisibleViewFieldSlugs(liveConfig, fields));
      nextConfig.hiddenFieldSlugs = [
        ...new Set([
          ...(liveConfig.hiddenFieldSlugs ?? []),
          ...fields.filter((field) => !visible.has(field.slug)).map((field) => field.slug),
        ]),
      ];
    }
  }
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
  const touchesFieldRules =
    viewFields.configPatch === undefined ||
    viewFields.configPatch.filters !== undefined ||
    viewFields.configPatch.sorts !== undefined;
  if (touchesContent) {
    await db
      .update(busabaseViews)
      .set({
        ...(viewFields.config !== undefined
          ? { config: touchesFieldRules ? await stampFieldIds(nextConfig, getFields) : nextConfig }
          : {}),
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
