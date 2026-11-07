ALTER TABLE "busabase_workflow_triggers" ADD COLUMN "config" jsonb;--> statement-breakpoint
ALTER TABLE "busabase_workflow_triggers" ADD COLUMN "next_run_at" timestamp;--> statement-breakpoint
CREATE INDEX "busabase_workflow_triggers_due_idx" ON "busabase_workflow_triggers" USING btree ("event_type","next_run_at");