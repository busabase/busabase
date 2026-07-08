CREATE TYPE "public"."busabase_change_request_status" AS ENUM('in_review', 'changes_requested', 'approved', 'rejected', 'merged', 'abandoned', 'conflict');--> statement-breakpoint
CREATE TYPE "public"."busabase_comment_subject" AS ENUM('record', 'change_request', 'operation', 'commit');--> statement-breakpoint
CREATE TYPE "public"."busabase_operation_kind" AS ENUM('record_create', 'record_update', 'record_delete', 'record_variant', 'view_create', 'view_update', 'view_delete', 'view_restore', 'node_create', 'node_rename', 'node_delete', 'node_restore', 'node_move', 'skill_file_create', 'skill_file_update', 'skill_file_delete', 'skill_metadata_update', 'drive_file_create', 'drive_file_update', 'drive_file_delete', 'drive_metadata_update', 'doc_update', 'base_add_field', 'base_delete_field', 'base_update_field', 'base_convert_field', 'base_reorder_fields', 'base_restore_field', 'base_archive', 'base_restore', 'record_restore');--> statement-breakpoint
CREATE TYPE "public"."busabase_review_verdict" AS ENUM('approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."busabase_field_type" AS ENUM('text', 'longtext', 'markdown', 'html', 'attachment', 'relation', 'number', 'date', 'checkbox', 'select', 'multiselect', 'url', 'email', 'phone', 'created_time', 'updated_time', 'created_by', 'updated_by', 'auto_number', 'ai_summary', 'ai_tags', 'code', 'json', 'yaml');--> statement-breakpoint
CREATE TABLE "busabase_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"action" text NOT NULL,
	"actor_id" text NOT NULL,
	"base_id" text,
	"record_id" text,
	"change_request_id" text,
	"operation_id" text,
	"commit_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "busabase_change_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"base_id" text,
	"target_type" text DEFAULT 'base' NOT NULL,
	"node_id" text,
	"status" "busabase_change_request_status" DEFAULT 'in_review' NOT NULL,
	"submitted_by" text NOT NULL,
	"source_meta" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"review_policy_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"merge_summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rejected_reason" text,
	"reviewed_at" timestamp,
	"merged_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "busabase_comments" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"subject_type" "busabase_comment_subject" NOT NULL,
	"subject_id" text NOT NULL,
	"record_id" text,
	"change_request_id" text,
	"operation_id" text,
	"commit_id" text,
	"author_id" text NOT NULL,
	"body" text NOT NULL,
	"mentions_ai" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "busabase_commits" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"base_id" text,
	"target_type" text DEFAULT 'base' NOT NULL,
	"node_id" text,
	"operation_id" text,
	"parent_commit_id" text,
	"fields" jsonb NOT NULL,
	"operation" "busabase_operation_kind" DEFAULT 'record_create' NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"author" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "busabase_nodes" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"parent_id" text,
	"type" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "busabase_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"change_request_id" text NOT NULL,
	"base_id" text,
	"target_type" text DEFAULT 'base' NOT NULL,
	"node_id" text,
	"operation" "busabase_operation_kind" NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"target_record_id" text,
	"target_view_id" text,
	"file_path" text,
	"source_record_id" text,
	"source_commit_id" text,
	"base_commit_id" text,
	"head_commit_id" text NOT NULL,
	"delete_mode" text DEFAULT 'archive' NOT NULL,
	"merged_record_id" text,
	"merged_view_id" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "busabase_reviews" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"change_request_id" text NOT NULL,
	"reviewer_id" text NOT NULL,
	"verdict" "busabase_review_verdict" NOT NULL,
	"reason" text,
	"visible_operation_heads" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"storage_key" varchar(512) NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"size_bytes" integer NOT NULL,
	"content_hash" varchar(80),
	"context" varchar(50) DEFAULT 'general' NOT NULL,
	"user_id" text NOT NULL,
	"space_id" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "busabase_asset_usages" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"owner_type" text DEFAULT 'base' NOT NULL,
	"node_id" text NOT NULL,
	"path" text DEFAULT '' NOT NULL,
	"record_id" text DEFAULT '' NOT NULL,
	"field_slug" text DEFAULT '' NOT NULL,
	"block_id" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "busabase_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"attachment_id" text NOT NULL,
	"name" text NOT NULL,
	"content_kind" text DEFAULT 'binary' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" text DEFAULT 'local-producer' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "busabase_base_fields" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"base_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"type" "busabase_field_type" NOT NULL,
	"required" boolean DEFAULT false NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"options" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"deleted_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "busabase_bases" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"node_id" text NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"review_policy" jsonb DEFAULT '{"kind":"single","requiredApprovals":1}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"archived_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "busabase_field_values" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"base_id" text NOT NULL,
	"record_id" text,
	"change_request_id" text,
	"operation_id" text,
	"commit_id" text NOT NULL,
	"field_id" text,
	"field_slug" text NOT NULL,
	"field_type" "busabase_field_type" NOT NULL,
	"value_text" text,
	"value_number" double precision,
	"value_bool" boolean,
	"value_date" timestamp,
	"value_json" jsonb,
	"value_hash" text,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "busabase_record_links" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"base_id" text NOT NULL,
	"field_id" text NOT NULL,
	"field_slug" text NOT NULL,
	"source_record_id" text NOT NULL,
	"target_base_id" text NOT NULL,
	"target_record_id" text NOT NULL,
	"commit_id" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "busabase_records" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"base_id" text NOT NULL,
	"head_commit_id" text NOT NULL,
	"parent_record_id" text,
	"parent_commit_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "busabase_views" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
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
CREATE TABLE "busabase_user_env_vars" (
	"user_id" text PRIMARY KEY NOT NULL,
	"env_payload" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "busabase_audit_events" ADD CONSTRAINT "busabase_audit_events_base_id_busabase_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."busabase_bases"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_audit_events" ADD CONSTRAINT "busabase_audit_events_record_id_busabase_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."busabase_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_audit_events" ADD CONSTRAINT "busabase_audit_events_change_request_id_busabase_change_requests_id_fk" FOREIGN KEY ("change_request_id") REFERENCES "public"."busabase_change_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_audit_events" ADD CONSTRAINT "busabase_audit_events_operation_id_busabase_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."busabase_operations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_audit_events" ADD CONSTRAINT "busabase_audit_events_commit_id_busabase_commits_id_fk" FOREIGN KEY ("commit_id") REFERENCES "public"."busabase_commits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_change_requests" ADD CONSTRAINT "busabase_change_requests_base_id_busabase_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."busabase_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_change_requests" ADD CONSTRAINT "busabase_change_requests_node_id_busabase_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."busabase_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_comments" ADD CONSTRAINT "busabase_comments_record_id_busabase_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."busabase_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_comments" ADD CONSTRAINT "busabase_comments_change_request_id_busabase_change_requests_id_fk" FOREIGN KEY ("change_request_id") REFERENCES "public"."busabase_change_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_comments" ADD CONSTRAINT "busabase_comments_operation_id_busabase_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."busabase_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_comments" ADD CONSTRAINT "busabase_comments_commit_id_busabase_commits_id_fk" FOREIGN KEY ("commit_id") REFERENCES "public"."busabase_commits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_commits" ADD CONSTRAINT "busabase_commits_base_id_busabase_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."busabase_bases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_commits" ADD CONSTRAINT "busabase_commits_node_id_busabase_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."busabase_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_nodes" ADD CONSTRAINT "busabase_nodes_parent_id_busabase_nodes_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."busabase_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_operations" ADD CONSTRAINT "busabase_operations_change_request_id_busabase_change_requests_id_fk" FOREIGN KEY ("change_request_id") REFERENCES "public"."busabase_change_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_operations" ADD CONSTRAINT "busabase_operations_base_id_busabase_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."busabase_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_operations" ADD CONSTRAINT "busabase_operations_node_id_busabase_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."busabase_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_operations" ADD CONSTRAINT "busabase_operations_target_view_id_busabase_views_id_fk" FOREIGN KEY ("target_view_id") REFERENCES "public"."busabase_views"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_operations" ADD CONSTRAINT "busabase_operations_head_commit_id_busabase_commits_id_fk" FOREIGN KEY ("head_commit_id") REFERENCES "public"."busabase_commits"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_operations" ADD CONSTRAINT "busabase_operations_merged_view_id_busabase_views_id_fk" FOREIGN KEY ("merged_view_id") REFERENCES "public"."busabase_views"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_reviews" ADD CONSTRAINT "busabase_reviews_change_request_id_busabase_change_requests_id_fk" FOREIGN KEY ("change_request_id") REFERENCES "public"."busabase_change_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_asset_usages" ADD CONSTRAINT "busabase_asset_usages_asset_id_busabase_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."busabase_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_asset_usages" ADD CONSTRAINT "busabase_asset_usages_node_id_busabase_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."busabase_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_base_fields" ADD CONSTRAINT "busabase_base_fields_base_id_busabase_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."busabase_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_bases" ADD CONSTRAINT "busabase_bases_node_id_busabase_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."busabase_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_field_values" ADD CONSTRAINT "busabase_field_values_base_id_busabase_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."busabase_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_field_values" ADD CONSTRAINT "busabase_field_values_record_id_busabase_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."busabase_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_field_values" ADD CONSTRAINT "busabase_field_values_change_request_id_busabase_change_requests_id_fk" FOREIGN KEY ("change_request_id") REFERENCES "public"."busabase_change_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_field_values" ADD CONSTRAINT "busabase_field_values_operation_id_busabase_operations_id_fk" FOREIGN KEY ("operation_id") REFERENCES "public"."busabase_operations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_field_values" ADD CONSTRAINT "busabase_field_values_commit_id_busabase_commits_id_fk" FOREIGN KEY ("commit_id") REFERENCES "public"."busabase_commits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_record_links" ADD CONSTRAINT "busabase_record_links_base_id_busabase_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."busabase_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_record_links" ADD CONSTRAINT "busabase_record_links_field_id_busabase_base_fields_id_fk" FOREIGN KEY ("field_id") REFERENCES "public"."busabase_base_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_record_links" ADD CONSTRAINT "busabase_record_links_source_record_id_busabase_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."busabase_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_record_links" ADD CONSTRAINT "busabase_record_links_target_base_id_busabase_bases_id_fk" FOREIGN KEY ("target_base_id") REFERENCES "public"."busabase_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_record_links" ADD CONSTRAINT "busabase_record_links_target_record_id_busabase_records_id_fk" FOREIGN KEY ("target_record_id") REFERENCES "public"."busabase_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_record_links" ADD CONSTRAINT "busabase_record_links_commit_id_busabase_commits_id_fk" FOREIGN KEY ("commit_id") REFERENCES "public"."busabase_commits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_records" ADD CONSTRAINT "busabase_records_base_id_busabase_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."busabase_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_records" ADD CONSTRAINT "busabase_records_head_commit_id_busabase_commits_id_fk" FOREIGN KEY ("head_commit_id") REFERENCES "public"."busabase_commits"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_views" ADD CONSTRAINT "busabase_views_base_id_busabase_bases_id_fk" FOREIGN KEY ("base_id") REFERENCES "public"."busabase_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "busabase_audit_events_action_created_idx" ON "busabase_audit_events" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "busabase_audit_events_record_created_idx" ON "busabase_audit_events" USING btree ("record_id","created_at");--> statement-breakpoint
CREATE INDEX "busabase_audit_events_base_created_idx" ON "busabase_audit_events" USING btree ("base_id","created_at");--> statement-breakpoint
CREATE INDEX "busabase_change_requests_base_created_idx" ON "busabase_change_requests" USING btree ("base_id","created_at");--> statement-breakpoint
CREATE INDEX "busabase_change_requests_node_created_idx" ON "busabase_change_requests" USING btree ("node_id","created_at");--> statement-breakpoint
CREATE INDEX "busabase_change_requests_status_created_idx" ON "busabase_change_requests" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "busabase_comments_subject_created_idx" ON "busabase_comments" USING btree ("subject_type","subject_id","created_at");--> statement-breakpoint
CREATE INDEX "busabase_comments_record_created_idx" ON "busabase_comments" USING btree ("record_id","created_at");--> statement-breakpoint
CREATE INDEX "busabase_comments_change_request_created_idx" ON "busabase_comments" USING btree ("change_request_id","created_at");--> statement-breakpoint
CREATE INDEX "busabase_comments_operation_created_idx" ON "busabase_comments" USING btree ("operation_id","created_at");--> statement-breakpoint
CREATE INDEX "busabase_comments_commit_created_idx" ON "busabase_comments" USING btree ("commit_id","created_at");--> statement-breakpoint
CREATE INDEX "busabase_commits_base_created_idx" ON "busabase_commits" USING btree ("base_id","created_at");--> statement-breakpoint
CREATE INDEX "busabase_commits_node_created_idx" ON "busabase_commits" USING btree ("node_id","created_at");--> statement-breakpoint
CREATE INDEX "busabase_commits_operation_idx" ON "busabase_commits" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "busabase_commits_created_idx" ON "busabase_commits" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "busabase_nodes_parent_slug_uniq" ON "busabase_nodes" USING btree ("parent_id","slug") WHERE "busabase_nodes"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "busabase_nodes_parent_position_idx" ON "busabase_nodes" USING btree ("parent_id","position");--> statement-breakpoint
CREATE INDEX "busabase_operations_change_request_position_idx" ON "busabase_operations" USING btree ("change_request_id","position");--> statement-breakpoint
CREATE INDEX "busabase_operations_node_file_idx" ON "busabase_operations" USING btree ("node_id","file_path");--> statement-breakpoint
CREATE INDEX "busabase_operations_target_record_idx" ON "busabase_operations" USING btree ("target_record_id");--> statement-breakpoint
CREATE INDEX "busabase_operations_target_view_idx" ON "busabase_operations" USING btree ("target_view_id");--> statement-breakpoint
CREATE INDEX "busabase_operations_head_commit_idx" ON "busabase_operations" USING btree ("head_commit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "busabase_reviews_one_vote_per_change_request" ON "busabase_reviews" USING btree ("change_request_id","reviewer_id");--> statement-breakpoint
CREATE INDEX "busabase_reviews_change_request_created_idx" ON "busabase_reviews" USING btree ("change_request_id","created_at");--> statement-breakpoint
CREATE INDEX "attachments_user_id_idx" ON "attachments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "attachments_space_id_idx" ON "attachments" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "attachments_context_idx" ON "attachments" USING btree ("context");--> statement-breakpoint
CREATE INDEX "attachments_created_at_idx" ON "attachments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "attachments_storage_key_idx" ON "attachments" USING btree ("storage_key");--> statement-breakpoint
CREATE INDEX "attachments_content_hash_idx" ON "attachments" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "busabase_asset_usages_asset_idx" ON "busabase_asset_usages" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "busabase_asset_usages_node_idx" ON "busabase_asset_usages" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "busabase_asset_usages_node_path_idx" ON "busabase_asset_usages" USING btree ("node_id","path");--> statement-breakpoint
CREATE UNIQUE INDEX "busabase_asset_usages_uniq" ON "busabase_asset_usages" USING btree ("owner_type","asset_id","node_id","path","record_id","field_slug","block_id");--> statement-breakpoint
CREATE INDEX "busabase_assets_space_idx" ON "busabase_assets" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "busabase_assets_space_attachment_idx" ON "busabase_assets" USING btree ("space_id","attachment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "busabase_fields_base_slug_uniq" ON "busabase_base_fields" USING btree ("base_id","slug") WHERE "busabase_base_fields"."deleted_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "busabase_bases_node_uniq" ON "busabase_bases" USING btree ("node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "busabase_bases_space_slug_uniq" ON "busabase_bases" USING btree ("space_id","slug") WHERE "busabase_bases"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "busabase_field_values_base_field_text_idx" ON "busabase_field_values" USING btree ("base_id","field_slug","value_text");--> statement-breakpoint
CREATE INDEX "busabase_field_values_text_fts_idx" ON "busabase_field_values" USING gin (to_tsvector('simple', coalesce("value_text", '')));--> statement-breakpoint
CREATE INDEX "busabase_field_values_base_field_number_idx" ON "busabase_field_values" USING btree ("base_id","field_slug","value_number");--> statement-breakpoint
CREATE INDEX "busabase_field_values_base_field_date_idx" ON "busabase_field_values" USING btree ("base_id","field_slug","value_date");--> statement-breakpoint
CREATE INDEX "busabase_field_values_record_idx" ON "busabase_field_values" USING btree ("record_id");--> statement-breakpoint
CREATE INDEX "busabase_field_values_change_request_idx" ON "busabase_field_values" USING btree ("change_request_id");--> statement-breakpoint
CREATE INDEX "busabase_field_values_operation_idx" ON "busabase_field_values" USING btree ("operation_id");--> statement-breakpoint
CREATE INDEX "busabase_field_values_commit_idx" ON "busabase_field_values" USING btree ("commit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "busabase_record_links_source_field_target_uniq" ON "busabase_record_links" USING btree ("source_record_id","field_id","target_record_id");--> statement-breakpoint
CREATE INDEX "busabase_record_links_source_field_idx" ON "busabase_record_links" USING btree ("source_record_id","field_id");--> statement-breakpoint
CREATE INDEX "busabase_record_links_target_idx" ON "busabase_record_links" USING btree ("target_record_id");--> statement-breakpoint
CREATE INDEX "busabase_record_links_base_field_idx" ON "busabase_record_links" USING btree ("base_id","field_slug");--> statement-breakpoint
CREATE INDEX "busabase_records_base_created_idx" ON "busabase_records" USING btree ("base_id","created_at");--> statement-breakpoint
CREATE INDEX "busabase_records_status_created_idx" ON "busabase_records" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "busabase_records_head_commit_idx" ON "busabase_records" USING btree ("head_commit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "busabase_views_base_slug_uniq" ON "busabase_views" USING btree ("base_id","slug") WHERE "busabase_views"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "busabase_views_base_status_position_idx" ON "busabase_views" USING btree ("base_id","status","created_at");