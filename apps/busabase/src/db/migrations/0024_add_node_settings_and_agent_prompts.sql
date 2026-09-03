ALTER TABLE "busabase_nodes" ADD COLUMN "settings" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "busabase_nodes" ADD COLUMN "agent_prompts" jsonb;--> statement-breakpoint
-- Move the existing prompt lists off `metadata`, where the feature first
-- shipped. Only rows whose value is actually a JSON ARRAY are touched:
-- `metadata` is a free-form bag, so a hand-written non-array under this key must
-- not become the column's problem — it stays where it is, and the reader's
-- safeParse ignores it.
UPDATE "busabase_nodes"
SET "agent_prompts" = "metadata" -> 'agentPrompts'
WHERE jsonb_typeof("metadata" -> 'agentPrompts') = 'array';--> statement-breakpoint
-- Drop the old key only from the rows just copied, so a node whose value was
-- rejected above keeps whatever it had rather than losing it silently.
UPDATE "busabase_nodes"
SET "metadata" = "metadata" - 'agentPrompts'
WHERE "agent_prompts" IS NOT NULL;
