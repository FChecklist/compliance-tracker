-- Helpdesk gap-closure (DEEP_ERP_FUNCTIONALITY_COMPLETION_VIA_ODOO_ERPNEXT_REFERENCE
-- Phase 0, 2026-07-27). Closes 3 confirmed-real gaps versus Odoo's stock
-- Helpdesk app (this codebase's own Helpdesk already exceeds Odoo in
-- several other respects -- ITIL problem management, AI ticket
-- intelligence, voice-to-ticket -- this is narrow gap-closure, not a
-- rebuild):
--   1. Tiered, policy-based SLA + team/queue routing (ticket_teams,
--      business_hours_schedules, sla_policies, escalation_rules,
--      ticket_escalation_events) -- see ticket-service.ts's createTicket/
--      resolveSlaPolicy/computeSlaDeadline/checkTicketEscalations.
--   2. Email-to-ticket promotion (email_intelligence_items.promoted_ticket_id)
--      -- see ticket-service.ts's createTicketFromEmailIntelligenceItem.
--   3. Public self-service portal (knowledge_base_pages.is_published,
--      public_ticket_submission_attempts) -- see public-portal-service.ts.
-- RLS follows the same tenant-isolation + service-role-bypass pattern as
-- every other new table (AGENTS.md Rule 9); the public-portal tables'
-- real pre-auth read/write paths run through the raw (RLS-bypassing) db
-- client, same posture org_join_code_attempts already documents.

ALTER TABLE compliance.tickets
  ADD COLUMN IF NOT EXISTS team_id text,
  ADD COLUMN IF NOT EXISTS sla_policy_id text,
  ADD COLUMN IF NOT EXISTS requester_email text;

CREATE TABLE IF NOT EXISTS compliance.ticket_teams (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  name text NOT NULL,
  description text,
  lead_user_id text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.business_hours_schedules (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  name text NOT NULL,
  timezone text NOT NULL DEFAULT 'UTC',
  weekly_hours jsonb NOT NULL DEFAULT '{}',
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.sla_policies (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  name text NOT NULL,
  team_id text REFERENCES compliance.ticket_teams(id),
  priority text,
  category text,
  first_response_hours integer,
  resolution_hours integer NOT NULL,
  business_hours_only boolean NOT NULL DEFAULT false,
  business_hours_schedule_id text REFERENCES compliance.business_hours_schedules(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT sla_policies_priority_check CHECK (priority IS NULL OR priority IN ('low', 'medium', 'high', 'critical'))
);

CREATE TABLE IF NOT EXISTS compliance.escalation_rules (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  sla_policy_id text NOT NULL REFERENCES compliance.sla_policies(id) ON DELETE CASCADE,
  threshold_percent integer NOT NULL,
  escalate_to_team_id text REFERENCES compliance.ticket_teams(id),
  escalate_to_user_id text,
  notify_user_ids jsonb NOT NULL DEFAULT '[]',
  step_order integer NOT NULL DEFAULT 1,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.ticket_escalation_events (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  ticket_id text NOT NULL REFERENCES compliance.tickets(id) ON DELETE CASCADE,
  escalation_rule_id text NOT NULL REFERENCES compliance.escalation_rules(id) ON DELETE CASCADE,
  fired_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (ticket_id, escalation_rule_id)
);

ALTER TABLE compliance.email_intelligence_items
  ADD COLUMN IF NOT EXISTS promoted_ticket_id text;

ALTER TABLE compliance.knowledge_base_pages
  ADD COLUMN IF NOT EXISTS is_published boolean NOT NULL DEFAULT false;

-- Rate-limit log for the public ticket-raise form, same shape/rationale as
-- org_join_code_attempts -- keyed by requester IP since an unresolved org
-- slug has no org to attribute the attempt to.
CREATE TABLE IF NOT EXISTS compliance.public_ticket_submission_attempts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  ip_address text NOT NULL,
  org_id text,
  was_successful boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ticket_teams_org_id ON compliance.ticket_teams(org_id);
CREATE INDEX IF NOT EXISTS idx_sla_policies_org_id ON compliance.sla_policies(org_id);
CREATE INDEX IF NOT EXISTS idx_escalation_rules_sla_policy_id ON compliance.escalation_rules(sla_policy_id);
CREATE INDEX IF NOT EXISTS idx_ticket_escalation_events_ticket_id ON compliance.ticket_escalation_events(ticket_id);
CREATE INDEX IF NOT EXISTS idx_tickets_team_id ON compliance.tickets(team_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_base_pages_org_published ON compliance.knowledge_base_pages(org_id, is_published);
CREATE INDEX IF NOT EXISTS idx_public_ticket_submission_attempts_ip_created ON compliance.public_ticket_submission_attempts(ip_address, created_at);

ALTER TABLE compliance.ticket_teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.business_hours_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.sla_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.escalation_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.ticket_escalation_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.public_ticket_submission_attempts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.ticket_teams FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.business_hours_schedules FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.sla_policies FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.escalation_rules FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.ticket_escalation_events FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.tickets t WHERE t.id = ticket_escalation_events.ticket_id AND t.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- No app_runtime tenant-isolation policy for public_ticket_submission_attempts
-- -- same posture as org_join_code_attempts's own pre-auth rate-limit table,
-- which is read/written exclusively through the raw (RLS-bypassing) db
-- client since there's no session-scoped org at the point a public form
-- submission is checked. service_role bypass only.

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'ticket_teams', 'business_hours_schedules', 'sla_policies', 'escalation_rules',
    'ticket_escalation_events', 'public_ticket_submission_attempts'
  ])
  LOOP
    EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.ticket_teams, compliance.business_hours_schedules, compliance.sla_policies,
  compliance.escalation_rules, compliance.ticket_escalation_events
  TO app_runtime;
GRANT SELECT, INSERT ON compliance.public_ticket_submission_attempts TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.ticket_teams, compliance.business_hours_schedules, compliance.sla_policies,
  compliance.escalation_rules, compliance.ticket_escalation_events, compliance.public_ticket_submission_attempts
  TO service_role;
