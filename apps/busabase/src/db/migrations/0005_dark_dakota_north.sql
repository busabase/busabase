DROP INDEX "busabase_bases_slug_uniq";--> statement-breakpoint
ALTER TABLE "busabase_change_requests" ADD COLUMN "space_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "busabase_audit_events" ADD COLUMN "space_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "busabase_comments" ADD COLUMN "space_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "busabase_commits" ADD COLUMN "space_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "busabase_nodes" ADD COLUMN "space_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "busabase_operations" ADD COLUMN "space_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "busabase_reviews" ADD COLUMN "space_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "busabase_views" ADD COLUMN "space_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "busabase_base_fields" ADD COLUMN "space_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "busabase_bases" ADD COLUMN "space_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "busabase_field_values" ADD COLUMN "space_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "busabase_record_links" ADD COLUMN "space_id" text NOT NULL;--> statement-breakpoint
ALTER TABLE "busabase_records" ADD COLUMN "space_id" text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "busabase_bases_space_slug_uniq" ON "busabase_bases" USING btree ("space_id","slug");