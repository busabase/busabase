CREATE TABLE "busabase_node_shares" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"node_id" text NOT NULL,
	"scope" text DEFAULT 'none' NOT NULL,
	"capability" text DEFAULT 'read' NOT NULL,
	"password_hash" text,
	"expires_at" timestamp,
	"created_by" text NOT NULL,
	"updated_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "busabase_node_shares_node_id_unique" UNIQUE("node_id")
);
--> statement-breakpoint
ALTER TABLE "busabase_nodes" ADD COLUMN "effective_public_scope" text;--> statement-breakpoint
ALTER TABLE "busabase_node_shares" ADD CONSTRAINT "busabase_node_shares_node_id_busabase_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."busabase_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "busabase_node_shares_space_scope_idx" ON "busabase_node_shares" USING btree ("space_id","scope");--> statement-breakpoint
CREATE INDEX "busabase_nodes_effective_public_scope_idx" ON "busabase_nodes" USING btree ("space_id","effective_public_scope");