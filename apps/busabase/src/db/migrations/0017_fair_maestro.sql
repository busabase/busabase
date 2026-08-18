CREATE TABLE "busabase_agent_session_events" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"seq" integer NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "busabase_agent_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"actor_id" text,
	"slug" text NOT NULL,
	"agent_name" text NOT NULL,
	"transport" text NOT NULL,
	"status" text NOT NULL,
	"acp_session_id" text,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_activity_at" timestamp DEFAULT now() NOT NULL,
	"ended_at" timestamp
);
--> statement-breakpoint
ALTER TABLE "busabase_agent_session_events" ADD CONSTRAINT "busabase_agent_session_events_session_id_busabase_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."busabase_agent_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "busabase_agent_session_events_session_seq_idx" ON "busabase_agent_session_events" USING btree ("session_id","seq");--> statement-breakpoint
CREATE INDEX "busabase_agent_session_events_at_idx" ON "busabase_agent_session_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "busabase_agent_sessions_space_activity_idx" ON "busabase_agent_sessions" USING btree ("space_id","last_activity_at");