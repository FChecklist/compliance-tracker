-- AI Model Lifecycle & Benchmarking: Ongoing Quality Monitoring.
--
-- The model half of PLATFORM_STRATEGY.md 30.2's Agent Performance (APR)
-- row, which by its own admission stopped at model-scorecard-service.ts's
-- live/ephemeral aggregation ("real but narrow... no hallucination-score or
-- cost field yet"). agent_review_records (drizzle/0211) already runs a
-- periodic promote/maintain/retrain/deprecate cycle at roster.ts role_key
-- granularity; this table runs the same real, deterministic verdict
-- machinery at MODEL granularity instead, since multiple roles routinely
-- share one model and a single role's standing says nothing about whether
-- the underlying model should keep receiving judgment-tier work
-- platform-wide.
--
-- Append-only history table -- one row per (model, complexity_tier, review
-- cycle), never upserted/overwritten, same convention as
-- agent_review_records.
--
-- Platform-level table, not tenant data (mirrors agent_review_records /
-- token_usage_ledger / ai_agent_directory) -- no RLS policy needed beyond
-- the existing service-role-bypass-only posture already applied to that
-- class of table in this schema.

CREATE TABLE IF NOT EXISTS compliance.model_lifecycle_reviews (
  id text PRIMARY KEY,
  model text NOT NULL,
  complexity_tier text NOT NULL,
  period_start timestamp NOT NULL,
  period_end timestamp NOT NULL,
  dispatch_count integer NOT NULL DEFAULT 0,
  terminal_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  failure_count integer NOT NULL DEFAULT 0,
  success_rate numeric,
  reviewed_count integer NOT NULL DEFAULT 0,
  audit_finding_count integer NOT NULL DEFAULT 0,
  audit_finding_rate numeric,
  escalation_count integer NOT NULL DEFAULT 0,
  escalation_rate numeric,
  cost_usd numeric,
  verdict text NOT NULL,
  verdict_reason text NOT NULL,
  trust_tier_flag text,
  reviewed_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS model_lifecycle_reviews_model_idx
  ON compliance.model_lifecycle_reviews (model, reviewed_at DESC);
