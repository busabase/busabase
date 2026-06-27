ALTER TABLE "attachments" ADD COLUMN "content_hash" varchar(80);--> statement-breakpoint
CREATE INDEX "attachments_content_hash_idx" ON "attachments" USING btree ("content_hash");