-- GAP-AI-WORKFORCE-GOVERNANCE, Agent Review Registry (ARR) --
-- PLATFORM_STRATEGY.md section 30.2: "Does not exist... no periodic,
-- performance-driven promote/retrain/deprecate/retire cycle exists
-- anywhere. Genuinely new territory." Sequenced last per section 30.4's own
-- recommendation, after Agent Performance (model-scorecard-service.ts,
-- GAP-MODEL-SCORECARD, PR #230) and Agent Escalation
-- (escalation-ladder.ts / audit_trigger.ai_escalation) both already exist.
--
-- Append-only history table -- one row per (role_key, review cycle), NOT an
-- upsert-on-conflict table like ai_agent_directory. See schema.ts's own
-- header comment on this table for the full reasoning distinguishing this
-- from model-scorecard-service.ts (live/ephemeral, model-level) and the AI
-- Team Closure Review gate (activity_log.review_decision, per-dispatch).
--
-- Platform-level table, not tenant data (see schema.ts comment) -- no RLS
-- policy needed beyond the existing service-role-bypass-only posture already
-- applied to ai_agent_directory / token_usage_ledger / loop_executions in
-- this schema.

CREATE TABLE IF NOT EXISTS compliance.agent_review_records (
  id text PRIMARY KEY,
  role_key text NOT NULL,
  title text,
  team text,
  model text,
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
  complexity_tier_trust jsonb,
  verdict text NOT NULL,
  verdict_reason text NOT NULL,
  trust_tier_flag text,
  reviewed_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now()
);

-- Fast "history for this role" / "latest review per role" reads -- the two
-- real query shapes agent-review-service.ts's getAgentReviewHistory() and
-- getLatestAgentReviews() use.
CREATE INDEX IF NOT EXISTS agent_review_records_role_key_reviewed_at_idx
  ON compliance.agent_review_records (role_key, reviewed_at DESC);
