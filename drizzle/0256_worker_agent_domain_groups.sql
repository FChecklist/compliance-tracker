-- Agent Hierarchy Registry (AHR), real version.
--
-- Context (PLATFORM_STRATEGY.md §30.2, "AI Workforce Governance framework"):
-- worker_agents.supervisor_worker_agent_id (a self-referencing FK meant to
-- encode "which agent supervises which") was confirmed dead -- 0 of the
-- real worker_agents rows have it set, and no code path writes to it.
--
-- Investigation of the live compliance.worker_agents table (22 real rows as
-- of this migration, all tier='global') found NO genuine 1:1 supervisor
-- relationship between individual rows -- they are independent capability/
-- tool functions (e.g. "Get Task Status", "List Departments",
-- "Run GST 2B Reconciliation"), not agents with people-style reporting
-- lines. Picking one row at random within a cluster to be another row's
-- "supervisor" (e.g. is get_compliance_stats the supervisor of
-- get_overdue_items?) would be exactly the guessed/arbitrary hierarchy
-- PLATFORM_STRATEGY.md's own finding warns against -- so
-- supervisor_worker_agent_id is intentionally left alone (still reserved,
-- still unpopulated) rather than force-populated with a fake chain.
--
-- What IS real and meaningful in the data: every row's `domain` column
-- already follows a "Category > Subcategory" free-text convention (verified
-- live, 2026-07-13):
--   Construction > Project Intelligence   (7 rows)
--   Cross-Cutting > Data Access           (6 rows)
--   Cross-Cutting > Reporting             (2 rows)
--   Finance > GST Reconciliation          (6 rows)
--   India Compliance > Penalty Calculation (1 row)
-- The top-level "Category" segment is a real, non-arbitrary department-style
-- grouping -- structurally the same shape as src/lib/ai-team/roster.ts's own
-- TeamName enum (a small, bounded, governable set of departments the 198 AI
-- Dev Team roles are grouped into, not a 1:1 supervisor chain either).
-- PLATFORM_STRATEGY.md §30.1's own finding is explicit that a governable
-- registry needs a SMALL BOUNDED set, not an ever-growing one -- so this
-- table is deliberately NOT auto-grown at request time (see
-- worker-agent-service.ts's resolveDomainGroupKey/proposeWorkerAgent): new
-- top-level categories fall back to 'general' until a human adds a real row
-- here via a follow-up migration, the same governance model TeamName uses
-- (adding a team requires a code change, not a runtime auto-insert).
--
-- Applied directly to Supabase project pcrjmlpuqsbocqfwoxod via a local
-- script against APP_RUNTIME_DATABASE_URL (Supabase MCP was unreachable in
-- this session).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS compliance.worker_agent_domain_groups (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  key text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.worker_agents
  ADD COLUMN IF NOT EXISTS domain_group_id text REFERENCES compliance.worker_agent_domain_groups(id);

CREATE INDEX IF NOT EXISTS idx_worker_agents_domain_group_id ON compliance.worker_agents(domain_group_id);

-- Same RLS shape as module_registry (drizzle/0017): a small, shared,
-- platform-wide governance table, not tenant-scoped data -- app_runtime
-- reads it, only service_role (migrations) writes it.
ALTER TABLE compliance.worker_agent_domain_groups ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_read_worker_agent_domain_groups ON compliance.worker_agent_domain_groups FOR SELECT TO app_runtime USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_worker_agent_domain_groups ON compliance.worker_agent_domain_groups FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT ON compliance.worker_agent_domain_groups TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.worker_agent_domain_groups TO service_role;

-- Seed: the 4 real top-level categories found in the live data, plus one
-- fallback bucket ('general') for any worker_agents row whose domain is
-- null or doesn't match a known category -- keeps domain_group_id always
-- resolvable (never left null going forward) without ever guessing a
-- category that isn't actually there.
INSERT INTO compliance.worker_agent_domain_groups (key, name, description) VALUES
  ('construction', 'Construction', 'Construction project intelligence capabilities (budget/schedule risk, progress, KPI, dashboard).'),
  ('cross_cutting', 'Cross-Cutting', 'Org-wide data access and reporting capabilities used across every module (compliance items, departments, notices, stats).'),
  ('finance', 'Finance', 'Finance capabilities -- GST reconciliation, returns, import batches.'),
  ('india_compliance', 'India Compliance', 'India statutory compliance capabilities (penalty estimation and related).'),
  ('general', 'General', 'Fallback group for worker agents whose domain is unset or does not match a known top-level category. Grows only via a reviewed migration, never auto-created at request time -- same governance discipline as roster.ts''s TeamName set.')
ON CONFLICT (key) DO NOTHING;

-- Backfill: every existing worker_agents row gets a real, non-null
-- domain_group_id derived from its own actual `domain` value (never
-- hand-picked per row).
UPDATE compliance.worker_agents wa
SET domain_group_id = g.id
FROM compliance.worker_agent_domain_groups g
WHERE g.key = CASE
  WHEN wa.domain LIKE 'Construction%' THEN 'construction'
  WHEN wa.domain LIKE 'Cross-Cutting%' THEN 'cross_cutting'
  WHEN wa.domain LIKE 'Finance%' THEN 'finance'
  WHEN wa.domain LIKE 'India Compliance%' THEN 'india_compliance'
  ELSE 'general'
END
AND wa.domain_group_id IS NULL;
