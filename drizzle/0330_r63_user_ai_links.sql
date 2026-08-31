-- R63 (owner directive, 2026-08-29): per-user unique AI-delegation link.
-- Shown bottom-left of the chat box; the user adds it as an MCP connector
-- in any MCP-compatible AI client (Claude.ai Connectors today; more
-- clients as MCP adoption spreads) so that AI can submit tasks/chat into
-- VERIDIAN/PROJEXA on their behalf -- this table is the server-side half.
-- No RLS: resolution happens by token, before any tenant context exists
-- (same posture as ai_model_registry/ai_routing_policies -- platform-wide
-- lookup tables, not per-org data).

CREATE TABLE "platform"."user_ai_links" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	-- 256-bit random, base64url -- generated server-side only (crypto.randomBytes),
	-- never derived from anything guessable (not a hash of user_id/email/timestamp).
	"token" text NOT NULL UNIQUE,
	"status" text NOT NULL DEFAULT 'active', -- 'active' | 'revoked'
	"created_at" timestamp DEFAULT now() NOT NULL,
	"last_used_at" timestamp,
	"revoked_at" timestamp
);
--> statement-breakpoint

-- One active link per user -- generateUserAiLink() is idempotent (returns
-- the existing active row rather than minting a second live credential for
-- the same person).
CREATE UNIQUE INDEX IF NOT EXISTS "user_ai_links_one_active_per_user"
  ON "platform"."user_ai_links" ("org_id", "user_id")
  WHERE "status" = 'active';
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "user_ai_links_token_idx" ON "platform"."user_ai_links" ("token") WHERE "status" = 'active';
