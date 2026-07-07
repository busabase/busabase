CREATE TABLE "busabase_user_env_vars" (
	"user_id" text PRIMARY KEY NOT NULL,
	"env_payload" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
