ALTER TABLE "busabase_commits" ALTER COLUMN "operation" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "busabase_commits" ALTER COLUMN "operation" SET DEFAULT 'record_create'::text;--> statement-breakpoint
ALTER TABLE "busabase_operations" ALTER COLUMN "operation" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."busabase_operation_kind";--> statement-breakpoint
CREATE TYPE "public"."busabase_operation_kind" AS ENUM('record_create', 'record_update', 'record_delete', 'record_variant', 'view_create', 'view_update', 'view_delete');--> statement-breakpoint
ALTER TABLE "busabase_commits" ALTER COLUMN "operation" SET DEFAULT 'record_create'::"public"."busabase_operation_kind";--> statement-breakpoint
ALTER TABLE "busabase_commits" ALTER COLUMN "operation" SET DATA TYPE "public"."busabase_operation_kind" USING "operation"::"public"."busabase_operation_kind";--> statement-breakpoint
ALTER TABLE "busabase_operations" ALTER COLUMN "operation" SET DATA TYPE "public"."busabase_operation_kind" USING "operation"::"public"."busabase_operation_kind";