CREATE TABLE "attachments" (
	"id" text PRIMARY KEY NOT NULL,
	"storage_key" varchar(512) NOT NULL,
	"file_name" varchar(255) NOT NULL,
	"mime_type" varchar(100) NOT NULL,
	"size_bytes" integer NOT NULL,
	"context" varchar(50) DEFAULT 'general' NOT NULL,
	"user_id" text NOT NULL,
	"space_id" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE INDEX "attachments_user_id_idx" ON "attachments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "attachments_space_id_idx" ON "attachments" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX "attachments_context_idx" ON "attachments" USING btree ("context");--> statement-breakpoint
CREATE INDEX "attachments_created_at_idx" ON "attachments" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "attachments_storage_key_idx" ON "attachments" USING btree ("storage_key");