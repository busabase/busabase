import "server-only";

import type { ViewConfigVO } from "busabase-contract/types";
import { eq } from "drizzle-orm";
import type { getDb } from "../../../db";
import { busabaseViews } from "../../../db/schema";
import { id } from "../../../logic/kernel";
import { normalizeViewConfig } from "../../../logic/vo";

/**
 * Every Base keeps at least one real, saved view — the
 * dashboard no longer renders an unsaved "All" tab, and a Base opens on its
 * leftmost view. A Base born without views of its own gets this one: a plain
 * table showing every record and every field in Base field order.
 *
 * The name is not localized here: busabase-core has no server-side notion of
 * the reader's language for authenticated requests, so callers that DO know
 * their locale (the zh-CN seed / demo datasets) pass `name` themselves. The
 * migration that backfilled pre-existing Bases uses the same name, slug and
 * config.
 */
export const DEFAULT_GRID_VIEW_NAME = "Grid view";
export const DEFAULT_GRID_VIEW_SLUG = "grid-view";

type Db = Awaited<ReturnType<typeof getDb>>;

/** First of `grid-view`, `grid-view-2`, … not used by any view of the Base. */
const pickFreeSlug = (taken: ReadonlySet<string>) => {
  if (!taken.has(DEFAULT_GRID_VIEW_SLUG)) return DEFAULT_GRID_VIEW_SLUG;
  for (let suffix = 2; ; suffix++) {
    const slug = `${DEFAULT_GRID_VIEW_SLUG}-${suffix}`;
    if (!taken.has(slug)) return slug;
  }
};

/**
 * Insert the default Grid view for `baseId` at position 0 and return its id.
 *
 * Runs on whatever handle it is given, so the merge path passes its
 * transaction and the view is created atomically with the Base. The slug check
 * covers archived views too: restoring an archived view never re-checks its
 * slug, so the Grid view must not take one an archived sibling could come back
 * with.
 */
export const insertDefaultGridView = async (
  db: Db,
  args: {
    spaceId: string;
    baseId: string;
    createdBy: string;
    timestamp: Date;
    name?: string;
    position?: number;
  },
): Promise<string> => {
  const existing = await db
    .select({ slug: busabaseViews.slug })
    .from(busabaseViews)
    .where(eq(busabaseViews.baseId, args.baseId));
  const viewId = id("viw");
  await db.insert(busabaseViews).values({
    id: viewId,
    spaceId: args.spaceId,
    baseId: args.baseId,
    slug: pickFreeSlug(new Set(existing.map((view) => view.slug))),
    name: args.name ?? DEFAULT_GRID_VIEW_NAME,
    description: "",
    type: "table",
    // Exactly what a brand-new unfiltered table view stores (see mergeViewCreate):
    // no filters/sorts and no visibleFieldSlugs, so every field shows in Base order.
    config: normalizeViewConfig({
      filters: [],
      sorts: [],
      autoShowNewFields: true,
    } satisfies ViewConfigVO),
    status: "active",
    position: args.position ?? 0,
    createdBy: args.createdBy,
    archivedAt: null,
    createdAt: args.timestamp,
    updatedAt: args.timestamp,
  });
  return viewId;
};
