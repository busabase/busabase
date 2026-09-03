CREATE TYPE "public"."busabase_comment_mention_dispatch" AS ENUM('not_applicable', 'queued', 'linked', 'failed');--> statement-breakpoint
CREATE TYPE "public"."busabase_comment_mention_target" AS ENUM('member', 'agent');--> statement-breakpoint
CREATE TABLE "busabase_comment_mentions" (
	"id" text PRIMARY KEY NOT NULL,
	"comment_id" text NOT NULL,
	"target_type" "busabase_comment_mention_target" NOT NULL,
	"target_id" text NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"label" text,
	"dispatch_status" "busabase_comment_mention_dispatch" DEFAULT 'not_applicable' NOT NULL,
	"session_id" text,
	"error" text,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "busabase_comment_mentions" ADD CONSTRAINT "busabase_comment_mentions_comment_id_busabase_comments_id_fk" FOREIGN KEY ("comment_id") REFERENCES "public"."busabase_comments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "busabase_comment_mentions_comment_idx" ON "busabase_comment_mentions" USING btree ("comment_id","start_offset");--> statement-breakpoint
CREATE UNIQUE INDEX "busabase_comment_mentions_agent_unique" ON "busabase_comment_mentions" USING btree ("comment_id","target_id") WHERE "busabase_comment_mentions"."target_type" = 'agent';--> statement-breakpoint
CREATE INDEX "busabase_comment_mentions_recipient_unread_idx" ON "busabase_comment_mentions" USING btree ("target_type","target_id","read_at");--> statement-breakpoint
ALTER TABLE "busabase_comments" DROP COLUMN "mentions_ai";