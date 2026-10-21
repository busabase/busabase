DROP INDEX "busabase_views_base_status_position_idx";--> statement-breakpoint
ALTER TABLE "busabase_views" ADD COLUMN "position" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "busabase_views_base_status_position_idx" ON "busabase_views" USING btree ("base_id","status","position");--> statement-breakpoint
-- Views gain a shared order and every Base gets at least one real view.
-- The dashboard used to render a hard-coded, unsaved
-- "All" tab for each Base; that tab is gone, so every Base that already exists
-- gets a real "Grid view" at position 0 here. Opening a Base after the upgrade
-- therefore still lands on an all-records grid, exactly as before.
-- Same statements in busabase-cloud's migration 0056 (it keeps its own directory).
--
-- 1) Existing views keep their creation order, as positions 1..n (0 is left
--    for the Grid view below). Archived views are numbered too, so restoring
--    one puts it back where it was relative to the others.
UPDATE "busabase_views" AS v
SET "position" = ranked.rn
FROM (
  SELECT "id", row_number() OVER (PARTITION BY "base_id" ORDER BY "created_at", "id") AS rn
  FROM "busabase_views"
) AS ranked
WHERE v."id" = ranked."id";--> statement-breakpoint
-- 2) One Grid view per Base: a plain table view (no filters or sorts, every
--    field visible in Base field order) with the same config a brand-new
--    unfiltered table view stores. Deterministic id + NOT EXISTS keeps this
--    re-runnable. The slug falls back to a per-Base suffix when the Base already
--    has a view (active or archived) called `grid-view`, so neither the partial
--    unique index nor a later view/Base restore can collide with it.
--    Archive state mirrors what the Base's archive did to its views: archiving a
--    Base through `bases` archives its active views with the Base's timestamp
--    (and restore re-activates exactly those), while deleting the Base node
--    leaves its views active. So the Grid view is archived with the Base's
--    timestamp only when a sibling view carries that same batch timestamp, and
--    is active otherwise — every restore path then brings the Base back with an
--    active view. Attributed to whoever created the Base (falling back to the
--    local default actor, as seeded views are).
INSERT INTO "busabase_views" (
  "id", "space_id", "base_id", "slug", "name", "description", "type", "config",
  "status", "position", "created_by", "archived_at", "created_at", "updated_at"
)
SELECT
  'viw_grid_' || b."id",
  b."space_id",
  b."id",
  CASE
    WHEN EXISTS (
      SELECT 1 FROM "busabase_views" AS taken
      WHERE taken."base_id" = b."id" AND taken."slug" = 'grid-view'
    )
    THEN 'grid-view-' || substr(md5(b."id"), 1, 6)
    ELSE 'grid-view'
  END,
  'Grid view',
  '',
  'table',
  '{"filters":[],"sorts":[],"stackByFieldSlug":null,"dateFieldSlug":null,"startFieldSlug":null,"endFieldSlug":null}'::jsonb,
  CASE WHEN b.archived_with_views THEN 'archived' ELSE 'active' END,
  0,
  COALESCE(n."created_by", 'local-admin'),
  CASE WHEN b.archived_with_views THEN b."archived_at" ELSE NULL END,
  now(),
  now()
FROM (
  SELECT
    base.*,
    (
      base."archived_at" IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM "busabase_views" AS batch
        WHERE batch."base_id" = base."id" AND batch."archived_at" = base."archived_at"
      )
    ) AS archived_with_views
  FROM "busabase_bases" AS base
) AS b
LEFT JOIN "busabase_nodes" AS n ON n."id" = b."node_id"
WHERE NOT EXISTS (
  SELECT 1 FROM "busabase_views" AS existing WHERE existing."id" = 'viw_grid_' || b."id"
);
