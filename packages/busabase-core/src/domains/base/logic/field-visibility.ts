import "server-only";

import { isDeepStrictEqual } from "node:util";
import { ORPCError } from "@orpc/server";
import { getAutoShowNewFields, type ViewConfigVO } from "busabase-contract/types";
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { getContextSpaceId } from "../../../context";
import type { DbInstance } from "../../../db";
import { busabaseViews } from "../../../db/schema";
import { normalizeViewConfig } from "../../../logic/vo";

const originViewUnavailable = () =>
  new ORPCError("CONFLICT", {
    message: "The originating view is no longer available on this Base. Choose a view and retry.",
    data: { reason: "field_origin_view_unavailable" },
  });

/** Reject a stale/cross-Base intent before recording a proposal; merge checks again. */
export const assertFieldOriginView = async (
  db: DbInstance,
  baseId: string,
  originViewId?: string,
) => {
  if (!originViewId) return;
  const [view] = await db
    .select({ id: busabaseViews.id })
    .from(busabaseViews)
    .where(
      and(
        eq(busabaseViews.id, originViewId),
        eq(busabaseViews.baseId, baseId),
        eq(busabaseViews.spaceId, getContextSpaceId()),
        eq(busabaseViews.status, "active"),
        isNull(busabaseViews.archivedAt),
      ),
    )
    .limit(1);
  if (!view) throw originViewUnavailable();
};

/**
 * Called inside the field merge transaction, after its Base row has been locked.
 * Read live configs under row locks: simultaneous field additions must append to
 * the latest manual list instead of replacing each other's newly visible fields.
 */
export const applyCreatedFieldVisibility = async (
  db: DbInstance,
  input: {
    baseId: string;
    fieldSlug: string;
    originViewId?: string;
    fieldsBefore: ReadonlyArray<{ slug: string; position: number }>;
    timestamp: Date;
  },
) => {
  const views = await db
    .select()
    .from(busabaseViews)
    .where(
      and(
        eq(busabaseViews.baseId, input.baseId),
        eq(busabaseViews.spaceId, getContextSpaceId()),
        eq(busabaseViews.status, "active"),
        isNull(busabaseViews.archivedAt),
        or(
          input.originViewId ? eq(busabaseViews.id, input.originViewId) : undefined,
          and(
            inArray(busabaseViews.type, ["kanban", "gallery"]),
            sql`${busabaseViews.config}->'autoShowNewFields' IS NULL`,
            sql`jsonb_typeof(${busabaseViews.config}->'visibleFieldSlugs') IS DISTINCT FROM 'array'`,
          ),
        ),
      ),
    )
    .orderBy(asc(busabaseViews.id))
    .for("update");
  if (input.originViewId && !views.some((view) => view.id === input.originViewId)) {
    throw originViewUnavailable();
  }
  let schemaSlugs: string[] | undefined;
  const getSchemaSlugs = () => {
    schemaSlugs ??= [...input.fieldsBefore]
      .sort((a, b) => a.position - b.position)
      .map((field) => field.slug);
    return schemaSlugs;
  };
  const updatedViewIds: string[] = [];
  for (const view of views) {
    const config = normalizeViewConfig(view.config);
    const isOrigin = view.id === input.originViewId;
    // Older unconfigured card views followed the whole schema. Freeze their
    // current layout before the first addition rather than expanding every card.
    const freezeLegacyCard =
      (view.type === "kanban" || view.type === "gallery") &&
      config.autoShowNewFields === undefined &&
      !Array.isArray(config.visibleFieldSlugs);
    if (!isOrigin && !freezeLegacyCard) continue;
    const next: ViewConfigVO = { ...config };
    if (freezeLegacyCard) {
      next.autoShowNewFields = false;
      next.visibleFieldSlugs = getSchemaSlugs().filter(
        (slug) => !config.hiddenFieldSlugs?.includes(slug),
      );
    }
    if (isOrigin) {
      if (!getAutoShowNewFields(next)) {
        next.visibleFieldSlugs = [
          ...new Set([...(next.visibleFieldSlugs ?? getSchemaSlugs()), input.fieldSlug]),
        ];
      }
      if (next.hiddenFieldSlugs) {
        next.hiddenFieldSlugs = next.hiddenFieldSlugs.filter((slug) => slug !== input.fieldSlug);
      }
      if (next.fieldOrderSlugs) {
        next.fieldOrderSlugs = [...new Set([...next.fieldOrderSlugs, input.fieldSlug])];
      }
    }
    if (!isDeepStrictEqual(config, next)) {
      await db
        .update(busabaseViews)
        .set({ config: next, updatedAt: input.timestamp })
        .where(eq(busabaseViews.id, view.id));
    }
    // The source's derived columns changed even when its saved automatic
    // configuration did not. Keep its existing live invalidation contract.
    updatedViewIds.push(view.id);
  }
  return updatedViewIds;
};
