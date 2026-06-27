CREATE TABLE "busabase_asset_usages" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"asset_id" text NOT NULL,
	"node_id" text NOT NULL,
	"record_id" text DEFAULT '' NOT NULL,
	"field_slug" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "busabase_assets" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"attachment_id" text NOT NULL,
	"name" text NOT NULL,
	"created_by" text DEFAULT 'local-producer' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "busabase_asset_usages" ADD CONSTRAINT "busabase_asset_usages_asset_id_busabase_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."busabase_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_asset_usages" ADD CONSTRAINT "busabase_asset_usages_node_id_busabase_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."busabase_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "busabase_asset_usages_asset_idx" ON "busabase_asset_usages" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "busabase_asset_usages_node_idx" ON "busabase_asset_usages" USING btree ("node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "busabase_asset_usages_uniq" ON "busabase_asset_usages" USING btree ("asset_id","node_id","record_id","field_slug");--> statement-breakpoint
CREATE INDEX "busabase_assets_space_idx" ON "busabase_assets" USING btree ("space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "busabase_assets_space_attachment_uniq" ON "busabase_assets" USING btree ("space_id","attachment_id");