CREATE TABLE "busabase_asset_text_search" (
	"asset_id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"text_storage_key" text NOT NULL,
	"complete" boolean NOT NULL,
	"indexed_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "busabase_asset_text_search_chunks" (
	"asset_id" text NOT NULL,
	"chunk_index" integer NOT NULL,
	"content_text" text NOT NULL,
	CONSTRAINT "busabase_asset_text_search_chunks_asset_id_chunk_index_pk" PRIMARY KEY("asset_id","chunk_index")
);
--> statement-breakpoint
ALTER TABLE "busabase_asset_text_search" ADD CONSTRAINT "busabase_asset_text_search_asset_id_busabase_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."busabase_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_asset_text_search_chunks" ADD CONSTRAINT "busabase_asset_text_search_chunks_asset_id_busabase_asset_text_search_asset_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."busabase_asset_text_search"("asset_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "busabase_asset_text_search_space_idx" ON "busabase_asset_text_search" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "busabase_asset_text_search_chunks_trgm_idx" ON "busabase_asset_text_search_chunks" USING gin ("content_text" gin_trgm_ops);