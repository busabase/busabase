CREATE TABLE "busabase_embed_links" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"type" text NOT NULL,
	"type_id" text NOT NULL,
	"secret_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"created_by_api_key_id" text NOT NULL,
	"frame_mode" text DEFAULT 'top-level-only' NOT NULL,
	"allowed_origins" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp NOT NULL,
	"revoked_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "busabase_embed_links_secret_hash_uniq" ON "busabase_embed_links" USING btree ("secret_hash");--> statement-breakpoint
CREATE INDEX "busabase_embed_links_space_target_idx" ON "busabase_embed_links" USING btree ("space_id","type","type_id");--> statement-breakpoint
CREATE INDEX "busabase_embed_links_expires_at_idx" ON "busabase_embed_links" USING btree ("expires_at");