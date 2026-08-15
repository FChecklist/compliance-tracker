-- AI Model Lifecycle & Benchmarking / Ongoing Quality Monitoring (VERIDIAN
-- Review Framework gap-closure, 2026-08-15). See schema.ts's own header
-- comment above these two tables for the full investigation trail. Same
-- platform-schema/RLS/grant posture as platform.dispatch_outcomes
-- (drizzle/0300_stage12_dispatch_outcomes.sql) -- platform-internal, no
-- owning customer org, fail-closed RLS (service_role bypass only).

CREATE TABLE IF NOT EXISTS platform.role_quality_runs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,

  role_key text NOT NULL, -- AI Team role_key (src/lib/ai-team/roster.ts)
  model text NOT NULL, -- role.model at the time this run executed
  prompt_template_key text NOT NULL, -- role.promptKey -- which template's eval cases were run

  total_cases integer NOT NULL,
  passed_cases integer NOT NULL,
  pass_rate numeric NOT NULL, -- passed_cases / total_cases, 0..1
  avg_latency_ms integer,

  baseline_pass_rate numeric, -- rolling mean of this role's own prior runs' pass_rate, null on the first run
  regression_detected boolean NOT NULL DEFAULT false,
  triggered_by text NOT NULL DEFAULT 'scheduled', -- 'scheduled' | 'manual'
  error_note text, -- set when one or more eval cases errored (LLM call failure) rather than scored fail

  created_at timestamp NOT NULL DEFAULT now(),

  CONSTRAINT role_quality_runs_triggered_by_check CHECK (triggered_by IN ('scheduled', 'manual')),
  CONSTRAINT role_quality_runs_cases_check CHECK (passed_cases >= 0 AND passed_cases <= total_cases AND total_cases > 0)
);

-- Per-role history, most recent first -- the primary read pattern (trend/regression queries).
CREATE INDEX IF NOT EXISTS idx_role_quality_runs_role ON platform.role_quality_runs(role_key, created_at DESC);
-- Cross-role "which runs regressed" queries (dashboards/alerts).
CREATE INDEX IF NOT EXISTS idx_role_quality_runs_regression ON platform.role_quality_runs(created_at DESC) WHERE regression_detected = true;

ALTER TABLE platform.role_quality_runs ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.role_quality_runs TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.role_quality_runs TO service_role;

DO $$ BEGIN
  CREATE POLICY service_role_bypass_role_quality_runs ON platform.role_quality_runs
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS platform.provider_outage_windows (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,

  provider text NOT NULL, -- LLMProvider ('groq'|'openai'|'anthropic'|'google'|'openrouter'|'cerebras')
  model text, -- null = applies to every model routed through this provider during the window

  started_at timestamp NOT NULL,
  ended_at timestamp, -- null = still ongoing / unresolved

  source text NOT NULL DEFAULT 'manual', -- 'manual' | 'auto_detected'
  detection_note text,
  recorded_by_id text,

  created_at timestamp NOT NULL DEFAULT now(),

  CONSTRAINT provider_outage_windows_source_check CHECK (source IN ('manual', 'auto_detected')),
  CONSTRAINT provider_outage_windows_window_check CHECK (ended_at IS NULL OR ended_at >= started_at)
);

-- Correlation-query lookup: which windows overlap a given failure timestamp, for a given provider/model.
CREATE INDEX IF NOT EXISTS idx_provider_outage_windows_provider_time ON platform.provider_outage_windows(provider, started_at DESC);

ALTER TABLE platform.provider_outage_windows ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON platform.provider_outage_windows TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON platform.provider_outage_windows TO service_role;

DO $$ BEGIN
  CREATE POLICY service_role_bypass_provider_outage_windows ON platform.provider_outage_windows
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
