-- Wave 110 (AI_OS_MASTER_PROMPT_GAP_ANALYSIS.md): LLM response cache --
-- closes the "cached answers" step of the routing cascade the user's
-- master prompt describes. Deliberately not the same shape as
-- embedding_cache (bare content hash, safe globally because identical
-- text always embeds identically) -- an LLM completion is not guaranteed
-- safe to share across orgs, so cache_key here is derived from
-- (org_id + provider + model + systemPrompt + userMessage), and every
-- entry has an expiry (business answers go stale; embedded static text
-- does not). See src/lib/llm-response-cache.ts's callLLMCached() --
-- deliberately opt-in per caller, not wired into every existing call site.

CREATE TABLE IF NOT EXISTS compliance.llm_response_cache (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  cache_key text NOT NULL UNIQUE,
  content text NOT NULL,
  prompt_tokens integer NOT NULL DEFAULT 0,
  completion_tokens integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now(),
  expires_at timestamp NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_response_cache_expires_at ON compliance.llm_response_cache(expires_at);

-- RLS: same posture as embedding_cache (drizzle/0083_wave99_vector_search_optimization.sql)
-- -- a permissive app_runtime policy scoped by the cache_key's own opacity
-- (a cache_key encodes no readable content, and a row only ever matches a
-- caller who already supplied the exact same org_id+provider+model+prompt
-- inputs to derive it), plus the standard service_role_bypass.
ALTER TABLE compliance.llm_response_cache ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_read_llm_response_cache ON compliance.llm_response_cache FOR SELECT TO app_runtime USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_write_llm_response_cache ON compliance.llm_response_cache FOR INSERT TO app_runtime WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_update_llm_response_cache ON compliance.llm_response_cache FOR UPDATE TO app_runtime USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_delete_llm_response_cache ON compliance.llm_response_cache FOR DELETE TO app_runtime USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_llm_response_cache ON compliance.llm_response_cache FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
