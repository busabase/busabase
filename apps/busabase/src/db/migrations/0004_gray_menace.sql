CREATE TABLE "busabase_asset_texts" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"status" text DEFAULT 'present' NOT NULL,
	"text_storage_key" text NOT NULL,
	"text_content_hash" text,
	"source_content_hash" text,
	"written_by" text DEFAULT 'auto' NOT NULL,
	"line_count" bigint DEFAULT 0 NOT NULL,
	"char_count" bigint DEFAULT 0 NOT NULL,
	"byte_count" bigint DEFAULT 0 NOT NULL,
	"line_checkpoints" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"stats_computed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "busabase_asset_texts" ADD CONSTRAINT "busabase_asset_texts_asset_id_busabase_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."busabase_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "busabase_asset_texts_asset_uniq" ON "busabase_asset_texts" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "busabase_asset_texts_space_status_idx" ON "busabase_asset_texts" USING btree ("space_id","status");--> statement-breakpoint
CREATE INDEX "busabase_asset_texts_content_hash_idx" ON "busabase_asset_texts" USING btree ("text_content_hash");