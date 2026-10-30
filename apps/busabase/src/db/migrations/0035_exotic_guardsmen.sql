CREATE TABLE "busabase_storage_cleanup_jobs" (
	"storage_key" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"kind" text DEFAULT 'attachment' NOT NULL,
	"size_bytes" bigint DEFAULT 0 NOT NULL,
	"state" text DEFAULT 'retained' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp DEFAULT now() NOT NULL,
	"last_error" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "busabase_assets" ADD COLUMN "retain_in_library" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "busabase_storage_cleanup_due_idx" ON "busabase_storage_cleanup_jobs" USING btree ("state","next_attempt_at");