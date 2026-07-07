ALTER TYPE "public"."busabase_operation_kind" ADD VALUE 'drive_file_create' BEFORE 'doc_update';--> statement-breakpoint
ALTER TYPE "public"."busabase_operation_kind" ADD VALUE 'drive_file_update' BEFORE 'doc_update';--> statement-breakpoint
ALTER TYPE "public"."busabase_operation_kind" ADD VALUE 'drive_file_delete' BEFORE 'doc_update';--> statement-breakpoint
ALTER TYPE "public"."busabase_operation_kind" ADD VALUE 'drive_metadata_update' BEFORE 'doc_update';