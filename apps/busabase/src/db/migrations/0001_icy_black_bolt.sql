DROP INDEX "busabase_nodes_parent_slug_uniq";--> statement-breakpoint
DROP INDEX "busabase_bases_space_slug_uniq";--> statement-breakpoint
ALTER TABLE "busabase_nodes" ADD COLUMN "archived_at" timestamp;--> statement-breakpoint
CREATE UNIQUE INDEX "busabase_nodes_parent_slug_uniq" ON "busabase_nodes" USING btree ("parent_id","slug") WHERE "busabase_nodes"."archived_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "busabase_bases_space_slug_uniq" ON "busabase_bases" USING btree ("space_id","slug") WHERE "busabase_bases"."archived_at" IS NULL;