ALTER TABLE "busabase_nodes" ADD COLUMN "explicit_visibility" text;--> statement-breakpoint
-- Backfill, hand-added below the generated DDL.
--
-- `drizzle-kit generate` emits schema changes only; it has no notion of moving
-- DATA from one place to another, and this column replaces `metadata.visibility`
-- (the node ACL's only explicit input — see logic/node-acl.ts).
--
-- Without this statement the column ships empty, `explicitVisibilityOf` reads
-- NULL for every existing node, and the next space-wide `recomputeSpaceNodeAcl`
-- — triggered by any unrelated visibility change anywhere in the space — would
-- recompute every previously-private node as inheriting-and-visible. That is a
-- delayed, silent permission flip in the WORST direction: private content
-- becoming readable. (PR #5976 fixed the same shape pointing the other way.)
--
-- Idempotent and narrow on purpose: only rows that declared one of the three
-- known values, and only where the column has not already been set, so a re-run
-- or a partially-migrated database converges rather than clobbering.
UPDATE "busabase_nodes"
SET "explicit_visibility" = "metadata"->>'visibility'
WHERE "metadata"->>'visibility' IN ('private', 'workspace', 'public')
  AND "explicit_visibility" IS NULL;--> statement-breakpoint
-- Drop the now-migrated key so the free-form bag stops carrying a stale second
-- copy of an access-control value nothing reads (spec node-content-storage.md,
-- D1). Scoped to rows whose value actually landed in the column above, so a
-- value this migration could not interpret is left untouched rather than lost.
UPDATE "busabase_nodes"
SET "metadata" = "metadata" - 'visibility'
WHERE "explicit_visibility" IS NOT NULL
  AND "metadata" ? 'visibility';
