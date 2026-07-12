ALTER TYPE "public"."busabase_operation_kind" ADD VALUE 'airapp_file_create' BEFORE 'doc_update';--> statement-breakpoint
ALTER TYPE "public"."busabase_operation_kind" ADD VALUE 'airapp_file_update' BEFORE 'doc_update';--> statement-breakpoint
ALTER TYPE "public"."busabase_operation_kind" ADD VALUE 'airapp_file_delete' BEFORE 'doc_update';--> statement-breakpoint
ALTER TYPE "public"."busabase_operation_kind" ADD VALUE 'airapp_metadata_update' BEFORE 'doc_update';