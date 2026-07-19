CREATE TABLE "busabase_favorites" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"node_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "busabase_favorites" ADD CONSTRAINT "busabase_favorites_node_id_busabase_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."busabase_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "busabase_favorites_node_actor_uniq" ON "busabase_favorites" USING btree ("node_id","actor_id");--> statement-breakpoint
CREATE INDEX "busabase_favorites_actor_idx" ON "busabase_favorites" USING btree ("actor_id");