CREATE TABLE "busabase_agent_session_commands" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"space_id" text NOT NULL,
	"actor_id" text,
	"command_id" text NOT NULL,
	"kind" text NOT NULL,
	"state" text DEFAULT 'queued' NOT NULL,
	"binding_generation" bigint NOT NULL,
	"content_digest" text NOT NULL,
	"payload" jsonb NOT NULL,
	"presentation" jsonb,
	"target_command_id" text,
	"claiming_epoch" bigint,
	"receipt" jsonb,
	"error_code" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
ALTER TABLE "busabase_agent_session_events" ADD COLUMN "stable_identity" text;--> statement-breakpoint
ALTER TABLE "busabase_agent_session_events" ADD COLUMN "content_digest" text;--> statement-breakpoint
ALTER TABLE "busabase_agent_session_events" ADD COLUMN "source_seq" integer;--> statement-breakpoint
ALTER TABLE "busabase_agent_sessions" ADD COLUMN "journal_mode" text DEFAULT 'legacy' NOT NULL;--> statement-breakpoint
ALTER TABLE "busabase_agent_sessions" ADD COLUMN "binding_generation" bigint DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "busabase_agent_sessions" ADD COLUMN "writer_owner_id" text;--> statement-breakpoint
ALTER TABLE "busabase_agent_sessions" ADD COLUMN "writer_epoch" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "busabase_agent_sessions" ADD COLUMN "writer_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "busabase_agent_sessions" ADD COLUMN "journal_head" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "busabase_agent_sessions" ADD COLUMN "source_generation" text;--> statement-breakpoint
ALTER TABLE "busabase_agent_sessions" ADD COLUMN "source_checkpoint" bigint;--> statement-breakpoint
ALTER TABLE "busabase_agent_sessions" ADD COLUMN "active_command_id" text;--> statement-breakpoint
ALTER TABLE "busabase_agent_sessions" ADD COLUMN "demand_until" timestamp;--> statement-breakpoint
ALTER TABLE "busabase_agent_sessions" ADD COLUMN "sync_state" text;--> statement-breakpoint
ALTER TABLE "busabase_agent_sessions" ADD COLUMN "connection_state" text;--> statement-breakpoint
ALTER TABLE "busabase_agent_sessions" ADD COLUMN "execution_state" text;--> statement-breakpoint
ALTER TABLE "busabase_agent_sessions" ADD COLUMN "diagnostic_ref" text;--> statement-breakpoint
ALTER TABLE "busabase_agent_sessions" ADD COLUMN "capabilities" jsonb;--> statement-breakpoint
ALTER TABLE "busabase_agent_sessions" ADD COLUMN "recovery_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "busabase_agent_sessions" ADD COLUMN "creation_state" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "busabase_agent_session_commands" ADD CONSTRAINT "busabase_agent_session_commands_session_id_busabase_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."busabase_agent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "busabase_agent_session_commands_identity_idx" ON "busabase_agent_session_commands" USING btree ("session_id","command_id");--> statement-breakpoint
CREATE INDEX "busabase_agent_session_commands_pending_idx" ON "busabase_agent_session_commands" USING btree ("session_id","state","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "busabase_agent_session_events_identity_idx" ON "busabase_agent_session_events" USING btree ("session_id","stable_identity");--> statement-breakpoint
CREATE INDEX "busabase_agent_sessions_demand_idx" ON "busabase_agent_sessions" USING btree ("journal_mode","demand_until");