CREATE TABLE "busabase_app_branding" (
	"id" text PRIMARY KEY DEFAULT 'local' NOT NULL,
	"name" text,
	"description" text,
	"logo_url" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
