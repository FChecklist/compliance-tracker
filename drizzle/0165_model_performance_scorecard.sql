-- GAP-MODEL-SCORECARD: real per-(AI model, complexity tier) performance
-- scorecard (dispatch count / success rate / audit-finding-rate), backing
-- src/lib/services/model-scorecard-service.ts.
--
-- Investigation before writing this migration (see that service's own
-- header for the full trail): activity_log already carries every column
-- needed to compute dispatch count, success rate (lifecycle_stage) and
-- audit-finding-rate (review_decision, from the internal AI Team Closure
-- Review gate, AI_TEAM_CLOSURE_REVIEW_LEAF) per role_key -- and role_key
-- resolves to a real model via roster.ts's getRole(), the same resolution
-- agent-directory-service.ts already relies on. The one genuinely missing
-- piece: complexity_tier (mechanical/integrative/judgment,
-- model-tier-eligibility.ts) is validated by POST /api/ai/team/dispatch
-- (checkTierEligibility, Wave 163 / AGENTS.md Operating Rule 10) but was
-- never persisted -- it was computed, used for the gate, and discarded.
-- Without it, "aggregated per AI model + complexity tier" is not
-- computable from real data at all. This is the smallest real column that
-- closes that gap -- nullable/additive, existing rows unaffected, set only
-- by the dispatch route going forward (see activity-log-service.ts's
-- recordActivity).
--
-- NOT applied to the live database by this PR -- a human orchestrator
-- applies it after review, same posture as every other migration this
-- session (e.g. 0149's comment).

ALTER TABLE compliance.activity_log ADD COLUMN IF NOT EXISTS complexity_tier text;

-- Backs the scorecard's group-by (activity_type, role_key, complexity_tier)
-- query -- mirrors 0149's partial-index precedent for a new activity_log
-- read pattern introduced by the same wave that added the column.
CREATE INDEX IF NOT EXISTS idx_activity_log_scorecard_grouping
  ON compliance.activity_log(activity_type, role_key, complexity_tier)
  WHERE activity_type = 'ai_team_dispatch';
