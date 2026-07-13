-- PLATFORM_STRATEGY.md section 29.3, Phase 0 ("Narrow Monitor Agents +
-- mandatory escalation hierarchy + three-tier model routing"). See
-- src/lib/db/schema.ts's own header comments on monitor_agents/
-- monitor_task_state for the full investigation and design-decision trail
-- (why a new dedicated table instead of overloading worker_agents.tier).
--
-- monitor_agents: platform-wide registry of monitor definitions (like
-- module_registry/deployment_events -- no org_id column by design).
-- monitor_task_state: tenant-scoped per-(org, task) escalation ownership +
-- retry/timeout tracking -- real RLS, per AGENTS.md Rule 9.
--
-- NOT applied to the live database by this PR -- a human orchestrator
-- applies it after review, same posture as every other migration this
-- session (e.g. 0165's comment).

CREATE TABLE IF NOT EXISTS compliance.monitor_agents (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL UNIQUE,
  description text,
  event_types text NOT NULL,
  execution_tier text NOT NULL DEFAULT 'rule_engine',
  owner text NOT NULL,
  report_to text NOT NULL,
  escalate_to text NOT NULL,
  escalation_level integer NOT NULL DEFAULT 1,
  max_retry integer NOT NULL DEFAULT 3,
  max_execution_time_ms integer NOT NULL,
  timeout_ms integer NOT NULL,
  failure_action text NOT NULL DEFAULT 'escalate',
  success_action text NOT NULL DEFAULT 'log_only',
  next_agent text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_monitor_agents_event_types ON compliance.monitor_agents(event_types);
CREATE INDEX IF NOT EXISTS idx_monitor_agents_is_active ON compliance.monitor_agents(is_active);

ALTER TABLE compliance.monitor_agents ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_read_monitor_agents ON compliance.monitor_agents FOR SELECT TO app_runtime USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_monitor_agents ON compliance.monitor_agents FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT ON compliance.monitor_agents TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.monitor_agents TO service_role;

CREATE TABLE IF NOT EXISTS compliance.monitor_task_state (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  task_id text NOT NULL,
  monitor_name text NOT NULL,
  owner_role_key text NOT NULL,
  rung_index integer NOT NULL,
  retry_count integer NOT NULL DEFAULT 1,
  max_retry integer NOT NULL,
  timeout_ms integer NOT NULL,
  status text NOT NULL DEFAULT 'active',
  last_escalated_at timestamp NOT NULL DEFAULT now(),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- One active escalation-state row per (org, task, monitor) -- the DB-level
-- half of the single-owner lock; evaluateEscalationClaim()/claimEscalation()
-- (escalation-ladder.ts) is the application-level half that decides what to
-- do when a claim attempt finds an existing row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_monitor_task_state_org_task_monitor ON compliance.monitor_task_state(org_id, task_id, monitor_name);
CREATE INDEX IF NOT EXISTS idx_monitor_task_state_org ON compliance.monitor_task_state(org_id);
CREATE INDEX IF NOT EXISTS idx_monitor_task_state_status ON compliance.monitor_task_state(status);

ALTER TABLE compliance.monitor_task_state ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.monitor_task_state FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_monitor_task_state ON compliance.monitor_task_state FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.monitor_task_state TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.monitor_task_state TO service_role;

-- Phase 0's one seeded monitor: proves the mechanism on
-- APPROVAL_GRANTED/APPROVAL_REJECTED only (approval_requests +
-- recordAuditTrigger's existing chokepoint, src/app/api/approvals/[id]/
-- route.ts), Tier 1, zero LLM calls. Rule: was the decision made within
-- max_execution_time_ms of the request being created (approval_requests.
-- created_at -> resolved_at)? 24h SLA, COO-owned (Performance Monitoring is
-- literally COO's named authority in escalation-ladder.ts's own LADDER),
-- starts escalation at COO (rung 1) because a slow decision is a
-- governance/policy-timing concern, not a software defect -- same
-- reasoning escalation-ladder.ts already applies to monitoring_rule_
-- violation/critical_risk_closure.
INSERT INTO compliance.monitor_agents (
  name, description, event_types, execution_tier,
  owner, report_to, escalate_to, escalation_level,
  max_retry, max_execution_time_ms, timeout_ms,
  failure_action, success_action, next_agent, is_active
) VALUES (
  'approval_decision_timeliness_monitor',
  'Tier 1 rule-engine monitor: checks an approval_requests decision (approve or reject) was made within the expected timeframe of the request being created. Fires on APPROVAL_GRANTED and APPROVAL_REJECTED only -- Phase 0 proof of the Narrow Monitor Agent mechanism.',
  'approval_granted,approval_rejected',
  'rule_engine',
  'chief_operating_officer', 'chief_operating_officer', 'chief_operating_officer', 1,
  3, 86400000, 21600000,
  'escalate', 'log_only', NULL, true
)
ON CONFLICT (name) DO NOTHING;
