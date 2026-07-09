CREATE TABLE "busabase_vault_items" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"kind" text NOT NULL,
	"key" text NOT NULL,
	"value_payload" jsonb NOT NULL,
	"scope_type" text DEFAULT 'personal' NOT NULL,
	"scope_id" text,
	"environment" text DEFAULT 'local' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"access" jsonb DEFAULT '{"runtime":true,"reveal":true,"edit":true,"share":false}'::jsonb NOT NULL,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DROP TABLE "busabase_user_env_vars" CASCADE;--> statement-breakpoint
CREATE INDEX "busabase_vault_items_user_updated_idx" ON "busabase_vault_items" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "busabase_vault_items_user_kind_idx" ON "busabase_vault_items" USING btree ("user_id","kind");--> statement-breakpoint
CREATE INDEX "busabase_vault_items_user_key_idx" ON "busabase_vault_items" USING btree ("user_id","key");