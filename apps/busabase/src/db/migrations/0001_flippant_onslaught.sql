ALTER TYPE "public"."busabase_operation_kind" ADD VALUE 'view_create';--> statement-breakpoint
ALTER TYPE "public"."busabase_operation_kind" ADD VALUE 'view_update';--> statement-breakpoint
ALTER TYPE "public"."busabase_operation_kind" ADD VALUE 'view_delete';--> statement-breakpoint
CREATE TABLE "busabase_views" (
	"id" text PRIMARY KEY NOT NULL,
	"base_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"type" text DEFAULT 'table' NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "busabase_operations" ADD COLUMN "target_view_id" text;--> statement-breakpoint
ALTER TABLE "busabase_operations" ADD COLUMN "merged_view_id" text;--> statement-breakpoint
ALTER TABLE "busabase_views" ADD CONSTRAINT "busabase_views_base_id_busabase_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."busabase_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "busabase_views_base_slug_uniq" ON "busabase_views" USING btree ("base_id","slug");--> statement-breakpoint
CREATE INDEX "busabase_views_base_status_position_idx" ON "busabase_views" USING btree ("base_id","status","created_at");--> statement-breakpoint
ALTER TABLE "busabase_operations" ADD CONSTRAINT "busabase_operations_target_view_id_busabase_views_id_fk" FOREIGN KEY ("target_view_id") REFERENCES "public"."busabase_views"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_operations" ADD CONSTRAINT "busabase_operations_merged_view_id_busabase_views_id_fk" FOREIGN KEY ("merged_view_id") REFERENCES "public"."busabase_views"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "busabase_operations_target_view_idx" ON "busabase_operations" USING btree ("target_view_id");