-- R63 (owner directive, 2026-08-29): data-driven AI-connector provider
-- registry -- "no hard coding, flows from a table, can change any time."
-- Seeded from real, current (2026-08) research per provider, not assumed
-- uniform -- support level genuinely differs (Claude.ai: native one-click;
-- ChatGPT: paid-plan Developer Mode; Gemini: Enterprise-admin-only today;
-- Z.ai/DeepSeek: developer/API-level, no consumer one-click yet). Editing
-- a row here (e.g. once Gemini/Z.ai/DeepSeek ship a consumer one-click
-- flow) is how this gets updated -- never a code deploy.

CREATE TABLE "platform"."ai_connector_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"provider_key" text NOT NULL UNIQUE,
	"display_name" text NOT NULL,
	-- 'native_one_click' | 'requires_paid_plan' | 'enterprise_admin_only' | 'developer_only'
	"support_level" text NOT NULL,
	"deep_link_template" text, -- null when there's no single confirmed URL to send the user to
	"instructions_md" text NOT NULL,
	"requires_plan" text, -- human-readable, e.g. 'Free (1 connector limit)', 'Pro/Plus/Business/Enterprise/Education', 'Enterprise (admin-configured)'
	"sort_order" integer NOT NULL DEFAULT 0,
	"status" text NOT NULL DEFAULT 'active', -- 'active' | 'inactive' -- flip to hide a provider without deleting its row/history
	"source_note" text, -- where this was verified, so a future edit knows what to re-check
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "ai_connector_providers_active_idx" ON "platform"."ai_connector_providers" ("sort_order") WHERE "status" = 'active';
--> statement-breakpoint

INSERT INTO "platform"."ai_connector_providers"
  ("id", "provider_key", "display_name", "support_level", "deep_link_template", "instructions_md", "requires_plan", "sort_order", "source_note")
VALUES
  ('seed_claude', 'claude', 'Claude', 'native_one_click',
   'https://claude.ai/settings/connectors?modal=add-custom-connector',
   'Click below, paste your AI link into **MCP server URL**, click **Add**. Done.',
   'Free (limited to 1 custom connector), Pro, Max, Team, Enterprise', 10,
   'Confirmed working deep link + flow, WebSearch 2026-08-29'),

  ('seed_chatgpt', 'chatgpt', 'ChatGPT', 'requires_paid_plan',
   'https://chatgpt.com/#settings',
   'Requires a paid plan. First: **Settings → Apps → Advanced settings → turn on Developer mode**. Then: **Settings → Connectors → Create**, paste your AI link as the **MCP Server URL** (the ''/mcp'' path is already included in your link). Not available on the ChatGPT Free plan.',
   'Pro, Plus, Business, Enterprise, Education (NOT Free)', 20,
   'WebSearch 2026-08-29, OpenAI Help Center'),

  ('seed_gemini', 'gemini', 'Gemini', 'enterprise_admin_only',
   NULL,
   'Only available on **Gemini Enterprise** today, and only your workspace admin can add it (Manage team → Connected apps → Add MCP Server). Not available on the free consumer Gemini app yet.',
   'Gemini Enterprise, admin-configured only', 30,
   'WebSearch 2026-08-29 -- consumer Gemini app has no confirmed custom-MCP setting'),

  ('seed_zai', 'zai', 'Z.ai (GLM)', 'developer_only',
   NULL,
   'Z.ai supports MCP at the API/developer level (MCP Agent Studio, API tool-calling) -- there is no simple "paste a link" setting in its consumer chat app yet. If you or your team build against Z.ai''s API, your AI link works as a standard MCP server URL there.',
   'Developer/API access', 40,
   'WebSearch 2026-08-29 -- no consumer one-click connector setting found'),

  ('seed_deepseek', 'deepseek', 'DeepSeek', 'developer_only',
   NULL,
   'DeepSeek supports MCP at the API/developer level -- third-party tools (e.g. MCP Agent Studio) let you paste a server URL and pick a DeepSeek model, but DeepSeek''s own consumer chat app has no native "Connectors" setting yet.',
   'Developer/API access', 50,
   'WebSearch 2026-08-29 -- no native consumer connector setting found')
ON CONFLICT ("provider_key") DO NOTHING;
