CREATE TABLE "busabase_node_content_search" (
	"node_id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"node_type" text NOT NULL,
	"content_text" text,
	"content_hash" text,
	"truncated" boolean DEFAULT false NOT NULL,
	"indexed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "busabase_node_content_search" ADD CONSTRAINT "busabase_node_content_search_node_id_busabase_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."busabase_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "busabase_node_content_search_fts_idx" ON "busabase_node_content_search" USING gin (to_tsvector('simple', coalesce("content_text", '')));--> statement-breakpoint
CREATE INDEX "busabase_node_content_search_trgm_idx" ON "busabase_node_content_search" USING gin ("content_text" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "busabase_node_content_search_space_idx" ON "busabase_node_content_search" USING btree ("space_id");