CREATE TABLE "busabase_forms" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"node_id" text NOT NULL,
	"target_base_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"bindings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"page" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"share" jsonb DEFAULT '{"isPublic":false,"anonymousSubmit":false}'::jsonb NOT NULL,
	"submission_count" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text NOT NULL,
	"archived_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "busabase_forms" ADD CONSTRAINT "busabase_forms_node_id_busabase_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."busabase_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_forms" ADD CONSTRAINT "busabase_forms_target_base_id_busabase_bases_id_fk" FOREIGN KEY ("target_base_id") REFERENCES "public"."busabase_bases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "busabase_forms_node_idx" ON "busabase_forms" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "busabase_forms_target_base_idx" ON "busabase_forms" USING btree ("target_base_id");--> statement-breakpoint
CREATE INDEX "busabase_forms_space_status_idx" ON "busabase_forms" USING btree ("space_id","status");