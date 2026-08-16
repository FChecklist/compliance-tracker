-- Wave 16 (VAIOS Worker Agent Governance) -- see PLATFORM_STRATEGY.md §10-11
-- for the constitution text and gap analysis this implements.
--
-- lifecycle_status is the real new state machine ('draft'|'proposed'|
-- 'approved'|'published'|'retired'). is_immutable is left exactly as-is --
-- it's a live boolean already read by task-execution-engine.ts's dispatch
-- gate and GET /api/worker-agents; redefining its meaning would be a silent
-- breaking change. Every existing seeded row backfills to 'published' --
-- correct and non-lossy, since every one has been live/dispatchable already.
--
-- No new proposal table -- reuses compliance.approval_requests exactly as
-- Wave 8's Policy-publish flow already does (requestType/entityType are
-- free text, already generalizable).

ALTER TABLE compliance.worker_agents ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'published';
ALTER TABLE compliance.worker_agents ADD COLUMN IF NOT EXISTS supervisor_worker_agent_id text REFERENCES compliance.worker_agents(id);
ALTER TABLE compliance.worker_agents ADD COLUMN IF NOT EXISTS proposed_by_id text REFERENCES compliance.users(id);

CREATE INDEX IF NOT EXISTS idx_worker_agents_supervisor ON compliance.worker_agents(supervisor_worker_agent_id);
CREATE INDEX IF NOT EXISTS idx_worker_agents_lifecycle_status ON compliance.worker_agents(lifecycle_status);

-- Found by get_advisors (performance) during Wave 19's final verification
-- pass -- proposed_by_id was missing a covering index.
CREATE INDEX IF NOT EXISTS idx_worker_agents_proposed_by ON compliance.worker_agents(proposed_by_id);
