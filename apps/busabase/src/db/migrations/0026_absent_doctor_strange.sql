ALTER TABLE "busabase_nodes" ADD COLUMN "created_by" text;--> statement-breakpoint
-- Backfill the creator of every node that already exists.
--
-- `busabase_commits.author` is NOT NULL and `node_create` is the single entry
-- point for creating a node, so the creating commit is the authoritative record
-- of who made it. DISTINCT ON takes the earliest such commit per node; a node
-- that was created, deleted and recreated under the same id would otherwise
-- match more than one row.
--
-- Nodes whose creating commit is no longer present keep a NULL `created_by`.
-- That is the honest answer — "this row cannot tell" — and the author filter
-- treats it as unmatchable rather than attributing the node to anyone.
UPDATE "busabase_nodes" AS n
SET "created_by" = src."author"
FROM (
  -- The link runs through OPERATIONS, not through the commit's own `node_id`.
  -- A `node_create` commit is written before the node exists, so
  -- `busabase_commits.node_id` is NULL on exactly the rows this backfill needs;
  -- the id is stamped onto `busabase_operations.node_id` at merge time, and the
  -- author lives on the commit that operation points at.
  SELECT DISTINCT ON (o."node_id") o."node_id" AS node_id, c."author" AS author
  FROM "busabase_operations" AS o
  JOIN "busabase_commits" AS c ON c."id" = o."head_commit_id"
  WHERE o."node_id" IS NOT NULL AND c."operation" = 'node_create'
  ORDER BY o."node_id", c."created_at" ASC
) AS src
WHERE n."id" = src.node_id AND n."created_by" IS NULL;
