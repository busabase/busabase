CREATE TABLE "busabase_space_welcome" (
	"space_id" text PRIMARY KEY NOT NULL,
	"node_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
