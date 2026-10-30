CREATE TABLE "busabase_space_instructions" (
	"space_id" text PRIMARY KEY NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
