ALTER TABLE "busabase_agent_sessions" ADD COLUMN "lease_owner_id" text;--> statement-breakpoint
ALTER TABLE "busabase_agent_sessions" ADD COLUMN "lease_fencing_token" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "busabase_agent_sessions" ADD COLUMN "lease_expires_at" timestamp;