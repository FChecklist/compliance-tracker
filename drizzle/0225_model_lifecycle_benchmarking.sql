-- VERIDIAN Review Framework gap-closure: "AI Model Lifecycle & Benchmarking
-- / Ongoing Quality Monitoring" (3 findings, ai-os/tasks/
-- task-20260718-130006-retry-2--ai-model-lifecycle---benchmark).
--
-- Investigated before writing this migration, per that task's own
-- instruction not to assume the gap description is still accurate:
--   - model-scorecard-service.ts (GAP-MODEL-SCORECARD) already tracks
--     dispatch count / success rate / audit-finding-rate per (model,
--     complexity_tier) from activity_log -- a DISPATCH-OUTCOME signal
--     (did it complete, was it rejected on review), not a CONTENT-QUALITY
--     signal (promptfoo-style assertion scoring of what the role actually
--     produced). Finding 1 explicitly asks to "extend promptfoo-style
--     scoring to a per-role recurring job" -- genuinely missing, this
--     migration adds it.
--   - agent_review_records (GAP-AI-WORKFORCE-GOVERNANCE) computes a
--     periodic promote/maintain/retrain/deprecate VERDICT from the same
--     dispatch-outcome signals as the scorecard, deterministically, "never
--     an LLM judgment call" per its own schema comment -- also not
--     content-quality scoring.
--   - No table anywhere records a provider-outage window, and no query
--     joins cost data (token_usage_ledger) with any quality signal.
-- Both are real, still-open gaps; this migration adds the smallest real
-- schema needed to close all 3 findings as one coherent unit (they share
-- the same module -- src/lib/services/model-*-service.ts).
--
-- NOT applied to the live database by this PR -- a human orchestrator
-- applies it after review, same posture as every other migration in this
-- session (e.g. 0165's comment).

-- Finding 1 (Per-role quality regression tracked over time): one row per
-- (role, scoring run) -- an actual promptfoo-style assertion-scored probe
-- pass, not a dispatch-outcome aggregate. previous_score/score_delta/
-- regression_detected are computed AT INSERT TIME against that role's own
-- prior row, so "did this role's quality just drop" is a stored fact, not
-- something every reader has to recompute.
CREATE TABLE IF NOT EXISTS compliance.role_quality_snapshots (
  id TEXT PRIMARY KEY,
  role_key TEXT NOT NULL,
  model TEXT NOT NULL,
  complexity_tier TEXT,
  score NUMERIC NOT NULL,
  test_case_count INTEGER NOT NULL,
  passed_count INTEGER NOT NULL,
  failed_count INTEGER NOT NULL,
  previous_score NUMERIC,
  score_delta NUMERIC,
  regression_detected BOOLEAN NOT NULL DEFAULT false,
  triggered_by TEXT NOT NULL DEFAULT 'scheduled',
  probe_set_version TEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_role_quality_snapshots_role_created
  ON compliance.role_quality_snapshots(role_key, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_role_quality_snapshots_regression
  ON compliance.role_quality_snapshots(created_at DESC)
  WHERE regression_detected = true;

-- Finding 3 (Provider-outage historical incident correlation with role
-- failures): manually-recorded outage windows -- honestly scoped, no
-- external provider status-page integration exists anywhere in this
-- codebase to auto-populate this from (a real infrastructure decision, not
-- a migration), so this starts as an admin-recorded log, the same posture
-- incidents already has for other event types. ended_at nullable = an
-- ongoing/unresolved outage.
CREATE TABLE IF NOT EXISTS compliance.provider_outage_windows (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  started_at TIMESTAMP NOT NULL,
  ended_at TIMESTAMP,
  source TEXT NOT NULL DEFAULT 'manual',
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_provider_outage_windows_provider_started
  ON compliance.provider_outage_windows(provider, started_at DESC);
