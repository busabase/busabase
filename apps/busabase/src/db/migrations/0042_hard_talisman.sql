CREATE TABLE "busabase_workflow_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"workflow_node_id" text NOT NULL,
	"status" text NOT NULL,
	"trigger" text NOT NULL,
	"started_by" text NOT NULL,
	"cancelled_by" text,
	"cursor_node_id" text,
	"previous_node_id" text,
	"record_id" text,
	"payload" jsonb NOT NULL,
	"outputs" jsonb NOT NULL,
	"pause" jsonb,
	"resume_at" timestamp,
	"error" text,
	"lease_until" timestamp,
	"started_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "busabase_workflow_triggers" (
	"id" text PRIMARY KEY NOT NULL,
	"space_id" text NOT NULL,
	"workflow_node_id" text NOT NULL,
	"trigger_node_id" text NOT NULL,
	"event_type" text NOT NULL,
	"base_id" text,
	"armed_by" text NOT NULL,
	"created_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX "busabase_workflow_runs_space_workflow_started_idx" ON "busabase_workflow_runs" USING btree ("space_id","workflow_node_id","started_at");--> statement-breakpoint
CREATE INDEX "busabase_workflow_runs_status_resume_idx" ON "busabase_workflow_runs" USING btree ("status","resume_at");--> statement-breakpoint
CREATE INDEX "busabase_workflow_runs_status_updated_idx" ON "busabase_workflow_runs" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "busabase_workflow_triggers_space_event_idx" ON "busabase_workflow_triggers" USING btree ("space_id","event_type");--> statement-breakpoint
CREATE INDEX "busabase_workflow_triggers_workflow_idx" ON "busabase_workflow_triggers" USING btree ("workflow_node_id");