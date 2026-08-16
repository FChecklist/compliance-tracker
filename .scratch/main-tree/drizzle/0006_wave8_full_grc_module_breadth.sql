-- Wave 8: full GRC module breadth (Governance, Company Secretarial, Legal,
-- People & HR, Risk, Sector Regulators, Audit/Controls, Third-Party & ESG,
-- Integrity, Incidents), matching a separate design-mockup session. Applied
-- directly to Supabase via MCP, same approach as every prior wave (Free
-- plan has no branching). Every table: org_id NOT NULL + client_id
-- nullable (Wave 7 precedent), RLS via org_id = compliance.current_org_id(),
-- service_role bypass policy for platform-level operations.

-- ─── Enums ─────────────────────────────────────────────────────────────
DO $$ BEGIN CREATE TYPE compliance.board_meeting_type AS ENUM ('board_meeting','agm','egm','committee_meeting'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE compliance.board_meeting_status AS ENUM ('scheduled','held','cancelled'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE compliance.rpt_approval_status AS ENUM ('pending','approved','rejected'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE compliance.policy_status AS ENUM ('draft','under_review','published'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE compliance.approval_request_status AS ENUM ('pending','approved','rejected'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE compliance.litigation_stage AS ENUM ('filed','hearing_scheduled','judgment_reserved','judgment_passed','appeal_filed','closed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE compliance.risk_category AS ENUM ('regulatory','operational','financial','strategic','reputational','cyber'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE compliance.risk_status AS ENUM ('open','mitigating','closed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE compliance.incident_stage AS ENUM ('logged','triaged','investigating','contained','notified','remediated','closed'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE compliance.organisations ADD COLUMN IF NOT EXISTS regulatory_entity_type text NOT NULL DEFAULT 'general';

-- ─── GOVERNANCE ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance.board_meetings (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title text NOT NULL,
  meeting_type compliance.board_meeting_type NOT NULL DEFAULT 'board_meeting',
  meeting_date timestamp NOT NULL,
  status compliance.board_meeting_status NOT NULL DEFAULT 'scheduled',
  agenda jsonb NOT NULL DEFAULT '[]',
  attendees jsonb NOT NULL DEFAULT '[]',
  minutes text,
  minutes_history jsonb NOT NULL DEFAULT '[]',
  classification text NOT NULL DEFAULT 'board_only',
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_by_id text NOT NULL REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.board_action_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  board_meeting_id text NOT NULL REFERENCES compliance.board_meetings(id),
  item text NOT NULL,
  owner_id text REFERENCES compliance.users(id),
  due_date timestamp,
  status text NOT NULL DEFAULT 'open',
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.committees (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL,
  charter text,
  chair_id text REFERENCES compliance.users(id),
  cadence text,
  last_met_date timestamp,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.related_party_transactions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  party_name text NOT NULL,
  nature_of_transaction text,
  amount numeric(14,2),
  approval_status compliance.rpt_approval_status NOT NULL DEFAULT 'pending',
  approved_by_id text REFERENCES compliance.users(id),
  transaction_date timestamp,
  classification text NOT NULL DEFAULT 'board_only',
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_by_id text NOT NULL REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.delegation_of_authority (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  activity text NOT NULL,
  threshold_description text,
  approver_role text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.directors_kmp (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL,
  din text,
  designation text,
  is_independent boolean NOT NULL DEFAULT false,
  kyc_status text DEFAULT 'valid',
  kyc_valid_till timestamp,
  appointed_date timestamp,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.board_evaluations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  cycle text NOT NULL,
  current_stage text NOT NULL DEFAULT 'initiated',
  scope jsonb NOT NULL DEFAULT '[]',
  respondents jsonb NOT NULL DEFAULT '[]',
  action_items jsonb NOT NULL DEFAULT '[]',
  history jsonb NOT NULL DEFAULT '[]',
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.policies (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'governance',
  version text NOT NULL DEFAULT 'v1.0',
  status compliance.policy_status NOT NULL DEFAULT 'draft',
  attestation_rate integer NOT NULL DEFAULT 0,
  history jsonb NOT NULL DEFAULT '[]',
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_by_id text NOT NULL REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.approval_requests (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  request_type text NOT NULL,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  description text,
  status compliance.approval_request_status NOT NULL DEFAULT 'pending',
  requested_by_id text NOT NULL REFERENCES compliance.users(id),
  approved_by_id text REFERENCES compliance.users(id),
  rejection_reason text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_at timestamp NOT NULL DEFAULT now(),
  resolved_at timestamp
);

-- ─── COMPANY SECRETARIAL ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance.cap_table_entries (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  holder_name text NOT NULL,
  shares integer NOT NULL,
  percent numeric(5,2),
  share_class text DEFAULT 'Equity',
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.cap_table_events (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  event_type text NOT NULL,
  description text,
  shares integer,
  event_date timestamp,
  status text DEFAULT 'registered',
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  recorded_by_id text NOT NULL REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.company_charges (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  charge_holder text NOT NULL,
  charge_type text,
  amount numeric(14,2),
  filing_reference text,
  status text NOT NULL DEFAULT 'open',
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.secretarial_audits (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  period text NOT NULL,
  auditor_name text,
  status text NOT NULL DEFAULT 'in_progress',
  due_date timestamp,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.mca_filings (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  form_type text NOT NULL,
  description text,
  due_date timestamp,
  status text NOT NULL DEFAULT 'preparing',
  srn text,
  filed_date timestamp,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- ─── LEGAL ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance.legal_vendors (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL,
  vendor_type text,
  engagement_type text,
  current_matter text,
  status text NOT NULL DEFAULT 'active',
  fee numeric(14,2),
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.litigation_matters (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  matter text NOT NULL,
  matter_type text,
  forum text,
  stage compliance.litigation_stage NOT NULL DEFAULT 'filed',
  next_hearing_date timestamp,
  counsel text,
  amount numeric(14,2),
  linked_notice_id text REFERENCES compliance.notices(id),
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.ip_portfolio (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  mark text NOT NULL,
  ip_type text,
  status text NOT NULL DEFAULT 'application_filed',
  renewal_date timestamp,
  class_description text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.legal_opinions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  topic text NOT NULL,
  opinion_date timestamp,
  advisor text,
  linked_risk_id text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_at timestamp NOT NULL DEFAULT now()
);

-- ─── PEOPLE & HR ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance.hr_compliance_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  item text NOT NULL,
  governing_law text,
  state text NOT NULL DEFAULT 'All India',
  due_date timestamp,
  status text NOT NULL DEFAULT 'not_due_yet',
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.leave_policy_entries (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  leave_type text NOT NULL,
  governing_law text,
  entitlement text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.holiday_list_filings (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  state text NOT NULL,
  year text NOT NULL,
  status text NOT NULL DEFAULT 'pending_filing',
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.posh_committee (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  member_name text NOT NULL,
  role text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.posh_complaints (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  case_ref text NOT NULL,
  received_date timestamp NOT NULL,
  status text NOT NULL DEFAULT 'under_inquiry',
  classification text NOT NULL DEFAULT 'confidential',
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  recorded_by_id text NOT NULL REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.posh_annual_reports (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  year text NOT NULL,
  filed_with text,
  status text NOT NULL DEFAULT 'pending',
  filed_date timestamp,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_at timestamp NOT NULL DEFAULT now()
);

-- ─── RISK ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance.risks (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title text NOT NULL,
  category compliance.risk_category NOT NULL DEFAULT 'operational',
  likelihood integer NOT NULL DEFAULT 3,
  impact integer NOT NULL DEFAULT 3,
  owner_id text REFERENCES compliance.users(id),
  owner_dept text,
  status compliance.risk_status NOT NULL DEFAULT 'open',
  linked_control_ids jsonb NOT NULL DEFAULT '[]',
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- ─── SECTOR REGULATORS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance.sebi_compliance_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  requirement text NOT NULL,
  due_date timestamp,
  status text NOT NULL DEFAULT 'not_due_yet',
  linked_module text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.rbi_compliance_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  circular text NOT NULL,
  category text,
  status text NOT NULL DEFAULT 'not_started',
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.irdai_compliance_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  requirement text NOT NULL,
  category text,
  status text NOT NULL DEFAULT 'not_started',
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_at timestamp NOT NULL DEFAULT now()
);

-- ─── AUDIT — Controls & Framework Library, risk-based Audit Management ──
CREATE TABLE IF NOT EXISTS compliance.compliance_frameworks (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  framework_key text NOT NULL,
  name text NOT NULL,
  relevance_note text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.framework_controls (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  framework_id text NOT NULL REFERENCES compliance.compliance_frameworks(id),
  control_ref text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'not_started',
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.audit_engagements (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL,
  audit_type text NOT NULL DEFAULT 'internal',
  status text NOT NULL DEFAULT 'planned',
  covers_risk_ids jsonb NOT NULL DEFAULT '[]',
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.audit_findings (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  audit_engagement_id text NOT NULL REFERENCES compliance.audit_engagements(id),
  title text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',
  capa_status text NOT NULL DEFAULT 'open',
  linked_risk_id text REFERENCES compliance.risks(id),
  owner_id text REFERENCES compliance.users(id),
  due_date timestamp,
  retest_result text DEFAULT 'not_started',
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- ─── THIRD-PARTY & ESG ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance.vendor_risk_profiles (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL,
  risk_tier text NOT NULL DEFAULT 'medium',
  certifications jsonb NOT NULL DEFAULT '[]',
  last_assessed_date timestamp,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.esg_metrics (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  pillar text NOT NULL,
  label text NOT NULL,
  value_percent integer NOT NULL DEFAULT 0,
  note text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- ─── INTEGRITY ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance.whistleblower_cases (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  case_ref text NOT NULL,
  category text,
  received_date timestamp NOT NULL,
  status text NOT NULL DEFAULT 'open',
  classification text NOT NULL DEFAULT 'confidential',
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  recorded_by_id text NOT NULL REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.bcm_plans (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  plan_name text NOT NULL,
  last_tested_date timestamp,
  status text NOT NULL DEFAULT 'not_tested',
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.contract_compliance_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  vendor_name text NOT NULL,
  clause_description text,
  renewal_date timestamp,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- ─── INCIDENTS & EVENTS ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS compliance.incidents (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  title text NOT NULL,
  category text NOT NULL,
  severity text NOT NULL DEFAULT 'medium',
  classification text NOT NULL DEFAULT 'department',
  stage compliance.incident_stage NOT NULL DEFAULT 'logged',
  linked_risk_id text REFERENCES compliance.risks(id),
  linked_control_id text,
  regulatory_notify_required boolean NOT NULL DEFAULT false,
  notify_deadline text,
  notified boolean NOT NULL DEFAULT false,
  capa_owner_id text REFERENCES compliance.users(id),
  capa_due_date timestamp,
  closed_date timestamp,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  reported_by_id text NOT NULL REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════════
-- RLS -- every table above, identical pattern: app_runtime scoped by
-- org_id = current_org_id(), service_role full bypass.
-- ═══════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'board_meetings','board_action_items','committees','related_party_transactions',
    'delegation_of_authority','directors_kmp','board_evaluations','policies','approval_requests',
    'cap_table_entries','cap_table_events','company_charges','secretarial_audits','mca_filings',
    'legal_vendors','litigation_matters','ip_portfolio','legal_opinions',
    'hr_compliance_items','leave_policy_entries','holiday_list_filings','posh_committee','posh_complaints','posh_annual_reports',
    'risks',
    'sebi_compliance_items','rbi_compliance_items','irdai_compliance_items',
    'compliance_frameworks','framework_controls','audit_engagements','audit_findings',
    'vendor_risk_profiles','esg_metrics',
    'whistleblower_cases','bcm_plans','contract_compliance_items',
    'incidents'
  ])
  LOOP
    EXECUTE format('ALTER TABLE compliance.%I ENABLE ROW LEVEL SECURITY', t);
    BEGIN
      EXECUTE format('CREATE POLICY app_runtime_tenant_isolation ON compliance.%I FOR ALL TO app_runtime USING (org_id = compliance.current_org_id())', t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════════════
-- Indexes -- org_id on every table (RLS hot path) + the FK lookups routes
-- actually perform.
-- ═══════════════════════════════════════════════════════════════════════
DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'board_meetings','board_action_items','committees','related_party_transactions',
    'delegation_of_authority','directors_kmp','board_evaluations','policies','approval_requests',
    'cap_table_entries','cap_table_events','company_charges','secretarial_audits','mca_filings',
    'legal_vendors','litigation_matters','ip_portfolio','legal_opinions',
    'hr_compliance_items','leave_policy_entries','holiday_list_filings','posh_committee','posh_complaints','posh_annual_reports',
    'risks',
    'sebi_compliance_items','rbi_compliance_items','irdai_compliance_items',
    'compliance_frameworks','framework_controls','audit_engagements','audit_findings',
    'vendor_risk_profiles','esg_metrics',
    'whistleblower_cases','bcm_plans','contract_compliance_items',
    'incidents'
  ])
  LOOP
    EXECUTE format('CREATE INDEX IF NOT EXISTS idx_%I_org_id ON compliance.%I(org_id)', t, t);
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_board_action_items_meeting_id ON compliance.board_action_items(board_meeting_id);
CREATE INDEX IF NOT EXISTS idx_audit_findings_engagement_id ON compliance.audit_findings(audit_engagement_id);
CREATE INDEX IF NOT EXISTS idx_framework_controls_framework_id ON compliance.framework_controls(framework_id);
