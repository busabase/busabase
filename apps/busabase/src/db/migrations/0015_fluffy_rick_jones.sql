ALTER TYPE "public"."busabase_operation_kind" ADD VALUE 'whiteboard_document_update' BEFORE 'base_add_field';--> statement-breakpoint
ALTER TYPE "public"."busabase_operation_kind" ADD VALUE 'workflow_document_update' BEFORE 'base_add_field';--> statement-breakpoint
ALTER TYPE "public"."busabase_operation_kind" ADD VALUE 'html_document_update' BEFORE 'base_add_field';