CREATE TABLE "busabase_node_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"node_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"source" text NOT NULL,
	"muted_at" timestamp,
	"last_interacted_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "busabase_node_subscriptions" ADD CONSTRAINT "busabase_node_subscriptions_node_id_busabase_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."busabase_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "busabase_node_subscriptions_node_actor_uniq" ON "busabase_node_subscriptions" USING btree ("node_id","actor_id");--> statement-breakpoint
CREATE INDEX "busabase_node_subscriptions_actor_idx" ON "busabase_node_subscriptions" USING btree ("actor_id");