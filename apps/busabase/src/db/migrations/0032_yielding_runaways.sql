CREATE TABLE "busabase_router_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"grant_id" text NOT NULL,
	"acprouter_enrollment_id" text NOT NULL,
	"acprouter_agent_id" text NOT NULL,
	"agent_slug" text NOT NULL,
	"vault_item_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "busabase_router_pending_enrollments" (
	"id" text PRIMARY KEY NOT NULL,
	"grant_id" text NOT NULL,
	"acprouter_enrollment_id" text NOT NULL,
	"acprouter_agent_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"consumer_secret_encrypted" text,
	"bridge_deadline_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "busabase_router_grants" (
	"id" text PRIMARY KEY NOT NULL,
	"busabase_actor_id" text NOT NULL,
	"busabase_space_id" text NOT NULL,
	"acprouter_space_id" text NOT NULL,
	"acprouter_space_name" text NOT NULL,
	"token_vault_item_id" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"revoked_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "busabase_router_oauth_states" (
	"id" text PRIMARY KEY NOT NULL,
	"busabase_actor_id" text NOT NULL,
	"busabase_space_id" text NOT NULL,
	"pkce_verifier" text NOT NULL,
	"signed_state" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"consumed_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "busabase_router_connections" ADD CONSTRAINT "busabase_router_connections_grant_id_busabase_router_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."busabase_router_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "busabase_router_pending_enrollments" ADD CONSTRAINT "busabase_router_pending_enrollments_grant_id_busabase_router_grants_id_fk" FOREIGN KEY ("grant_id") REFERENCES "public"."busabase_router_grants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "busabase_router_connections_grant_enrollment_idx" ON "busabase_router_connections" USING btree ("grant_id","acprouter_enrollment_id");--> statement-breakpoint
CREATE INDEX "busabase_router_connections_grant_idx" ON "busabase_router_connections" USING btree ("grant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "busabase_router_pending_enrollments_grant_enrollment_idx" ON "busabase_router_pending_enrollments" USING btree ("grant_id","acprouter_enrollment_id");--> statement-breakpoint
CREATE INDEX "busabase_router_pending_enrollments_status_idx" ON "busabase_router_pending_enrollments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "busabase_router_grants_space_idx" ON "busabase_router_grants" USING btree ("busabase_space_id");--> statement-breakpoint
CREATE UNIQUE INDEX "busabase_router_oauth_states_signed_state_idx" ON "busabase_router_oauth_states" USING btree ("signed_state");