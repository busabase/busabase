ALTER TYPE "public"."busabase_operation_kind" ADD VALUE 'node_create';--> statement-breakpoint
ALTER TYPE "public"."busabase_operation_kind" ADD VALUE 'node_rename';--> statement-breakpoint
ALTER TYPE "public"."busabase_operation_kind" ADD VALUE 'node_delete';--> statement-breakpoint
ALTER TYPE "public"."busabase_operation_kind" ADD VALUE 'node_move';--> statement-breakpoint
ALTER TYPE "public"."busabase_operation_kind" ADD VALUE 'skill_file_create';--> statement-breakpoint
ALTER TYPE "public"."busabase_operation_kind" ADD VALUE 'skill_file_update';--> statement-breakpoint
ALTER TYPE "public"."busabase_operation_kind" ADD VALUE 'skill_file_delete';--> statement-breakpoint
ALTER TYPE "public"."busabase_operation_kind" ADD VALUE 'skill_metadata_update';--> statement-breakpoint
ALTER TABLE "busabase_change_requests" ALTER COLUMN "base_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "busabase_commits" ALTER COLUMN "base_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "busabase_operations" ALTER COLUMN "base_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "busabase_change_requests" ADD COLUMN "target_type" text DEFAULT 'base' NOT NULL;--> statement-breakpoint
ALTER TABLE "busabase_change_requests" ADD COLUMN "node_id" text;--> statement-breakpoint
ALTER TABLE "busabase_commits" ADD COLUMN "target_type" text DEFAULT 'base' NOT NULL;--> statement-breakpoint
ALTER TABLE "busabase_commits" ADD COLUMN "node_id" text;--> statement-breakpoint
ALTER TABLE "busabase_nodes" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "busabase_operations" ADD COLUMN "target_type" text DEFAULT 'base' NOT NULL;--> statement-breakpoint
ALTER TABLE "busabase_operations" ADD COLUMN "node_id" text;--> statement-breakpoint
ALTER TABLE "busabase_operations" ADD COLUMN "file_path" text;--> statement-breakpoint
ALTER TABLE "busabase_change_requests" ADD CONSTRAINT "busabase_change_requests_node_id_busabase_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."busabase_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_commits" ADD CONSTRAINT "busabase_commits_node_id_busabase_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."busabase_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_operations" ADD CONSTRAINT "busabase_operations_node_id_busabase_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."busabase_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "busabase_change_requests_node_created_idx" ON "busabase_change_requests" USING btree ("node_id","created_at");--> statement-breakpoint
CREATE INDEX "busabase_commits_node_created_idx" ON "busabase_commits" USING btree ("node_id","created_at");--> statement-breakpoint
CREATE INDEX "busabase_operations_node_file_idx" ON "busabase_operations" USING btree ("node_id","file_path");