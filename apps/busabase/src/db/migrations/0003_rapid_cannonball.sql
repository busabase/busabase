CREATE TABLE "busabase_webhook_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"base_id" text,
	"name" text NOT NULL,
	"event_type" text NOT NULL,
	"action_kind" text NOT NULL,
	"config" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"last_triggered_at" timestamp,
	"last_status" text
);
--> statement-breakpoint
CREATE TABLE "busabase_webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"rule_id" text NOT NULL,
	"space_id" text NOT NULL,
	"event_type" text NOT NULL,
	"status" text NOT NULL,
	"http_status" integer,
	"detail" text,
	"duration_ms" integer,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "busabase_webhook_rules_space_event_enabled_idx" ON "busabase_webhook_rules" USING btree ("space_id","event_type","enabled");--> statement-breakpoint
CREATE INDEX "busabase_webhook_deliveries_rule_created_idx" ON "busabase_webhook_deliveries" USING btree ("rule_id","created_at");