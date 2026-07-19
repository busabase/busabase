CREATE TABLE "busabase_node_principals" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"node_id" text NOT NULL,
	"source_node_id" text NOT NULL,
	"principal_type" text NOT NULL,
	"principal_id" text NOT NULL,
	"role" text NOT NULL,
	"granted_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "busabase_nodes" ADD COLUMN "effective_visibility" text;--> statement-breakpoint
ALTER TABLE "busabase_node_principals" ADD CONSTRAINT "busabase_node_principals_node_id_busabase_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."busabase_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_node_principals" ADD CONSTRAINT "busabase_node_principals_source_node_id_busabase_nodes_id_fk" FOREIGN KEY ("source_node_id") REFERENCES "public"."busabase_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "busabase_node_principals_node_principal_source_uniq" ON "busabase_node_principals" USING btree ("node_id","principal_type","principal_id","source_node_id");--> statement-breakpoint
CREATE INDEX "busabase_node_principals_node_idx" ON "busabase_node_principals" USING btree ("node_id");--> statement-breakpoint
CREATE INDEX "busabase_node_principals_principal_idx" ON "busabase_node_principals" USING btree ("principal_type","principal_id");--> statement-breakpoint
CREATE INDEX "busabase_nodes_effective_visibility_idx" ON "busabase_nodes" USING btree ("space_id","effective_visibility");