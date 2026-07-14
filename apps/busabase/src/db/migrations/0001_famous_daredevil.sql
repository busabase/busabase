CREATE TABLE "busabase_cloud_connect" (
	"id" text PRIMARY KEY DEFAULT 'local' NOT NULL,
	"tunnel_id" text NOT NULL,
	"cloud_url" text NOT NULL,
	"oss_origin" text,
	"credential_token" text,
	"credential_expires_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
