CREATE TABLE "compliance"."mcp_access_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"token" text NOT NULL UNIQUE,
	"org_id" text NOT NULL,
	"name" text NOT NULL DEFAULT 'Default',
	"is_active" boolean NOT NULL DEFAULT true,
	"last_used_at" timestamp,
	"created_at" timestamp NOT NULL DEFAULT now()
);
