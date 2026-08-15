-- VERIDIAN Review Framework remediation (Predictive AI Model Selection gap,
-- 2026-07-18): "No metric tracks whether AI usage/dependence decreases over
-- time." task_capabilities already stores CUMULATIVE full_software_count/
-- package_available_count/novel_count counters (recordExecutionOutcome() in
-- capability-learning-service.ts), but with no per-event timestamp there was
-- no way to answer "did the software-vs-AI mix improve THIS month" -- only
-- "what is it right now, cumulative since forever."
--
-- This table is a monthly, platform-wide snapshot of the SUM of those
-- cumulative counters across every task_capabilities row
-- (ai-reduction-service.ts's takeAiReductionSnapshot(), run by
-- /api/internal/ai-reduction-snapshot/run on the 1st of each month per
-- vercel.json). Diffing two consecutive rows gives that month's real bucket
-- distribution, since the underlying counters only ever increase.
--
-- No org_id: task_capabilities' own counters are already mostly
-- platform-wide (nullable org_id, see that table's own schema comment), and
-- a single platform-wide trend is what "is AI usage/dependence decreasing
-- over time" asks for -- a per-org breakdown is a straightforward additive
-- column later, not blocked by this shape.
--
-- Platform-level table, same RLS posture as prompt_templates (Wave 22):
-- readable by app_runtime (for a future dashboard), written only by the
-- cron job's own raw `db` client / service_role. No per-tenant isolation
-- needed -- there is no tenant-identifying data in this table at all, only
-- aggregate counts.
CREATE TABLE IF NOT EXISTS compliance.ai_reduction_snapshots (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  snapshot_date date NOT NULL,
  full_software_count integer NOT NULL,
  package_available_count integer NOT NULL,
  novel_count integer NOT NULL,
  total_count integer NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.ai_reduction_snapshots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_read_ai_reduction_snapshots ON compliance.ai_reduction_snapshots FOR SELECT TO app_runtime USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_insert_ai_reduction_snapshots ON compliance.ai_reduction_snapshots FOR INSERT TO app_runtime WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_ai_reduction_snapshots ON compliance.ai_reduction_snapshots FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT ON compliance.ai_reduction_snapshots TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.ai_reduction_snapshots TO service_role;

CREATE INDEX IF NOT EXISTS idx_ai_reduction_snapshots_date ON compliance.ai_reduction_snapshots(snapshot_date);
