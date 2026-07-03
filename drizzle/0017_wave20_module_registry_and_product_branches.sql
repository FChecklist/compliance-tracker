-- Wave 20 (VERIDIAN module-reusability): Module Registry + Product-Branch
-- enablement. See PLATFORM_STRATEGY.md's Wave 20-21 section for the user's
-- objective this implements: "same module, customized rules per scope,
-- module evolves over time" instead of forking a module per customer.
--
-- Pure additive infrastructure -- no existing table or hot-path code
-- changes in this wave. Global-read catalog tables, same posture as
-- orchestra_layers: only service_role may write; app_runtime gets SELECT
-- only (catalog mutation is a migration-only, Layer-1 action).

CREATE TABLE IF NOT EXISTS compliance.module_registry (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  module_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  table_name text NOT NULL,
  domain text NOT NULL,
  category text,
  description text,
  is_core boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- A platform-wide concept, distinct from Wave 19's org-scoped
-- products/projects (one customer's own internal projects, org_id NOT
-- NULL). Exactly one seeded row today: 'grc' -- the only real branch;
-- future Sales/HR/SCM branches per PLATFORM_STRATEGY.md §2 are not built
-- yet and this table does not pretend otherwise.
CREATE TABLE IF NOT EXISTS compliance.product_branches (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  branch_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  domain text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.product_branch_modules (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  product_branch_id text NOT NULL REFERENCES compliance.product_branches(id),
  module_key text NOT NULL REFERENCES compliance.module_registry(module_key),
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(product_branch_id, module_key)
);

ALTER TABLE compliance.module_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.product_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.product_branch_modules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_read_module_registry ON compliance.module_registry FOR SELECT TO app_runtime USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_module_registry ON compliance.module_registry FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_read_product_branches ON compliance.product_branches FOR SELECT TO app_runtime USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_product_branches ON compliance.product_branches FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_read_product_branch_modules ON compliance.product_branch_modules FOR SELECT TO app_runtime USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_product_branch_modules ON compliance.product_branch_modules FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT ON compliance.module_registry, compliance.product_branches, compliance.product_branch_modules TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.module_registry, compliance.product_branches, compliance.product_branch_modules TO service_role;

CREATE INDEX IF NOT EXISTS idx_module_registry_domain ON compliance.module_registry(domain);
CREATE INDEX IF NOT EXISTS idx_module_registry_category ON compliance.module_registry(category);
CREATE INDEX IF NOT EXISTS idx_product_branch_modules_branch_id ON compliance.product_branch_modules(product_branch_id);
CREATE INDEX IF NOT EXISTS idx_product_branch_modules_module_key ON compliance.product_branch_modules(module_key);

-- ============================================================
-- Seed: the ~40 confirmed module tables (4 pre-Wave-7 core + 36 Wave 7-8
-- modules), all domain='compliance' (honest single-domain state, matches
-- purpose-bound-ai.ts's own DEFAULT_DOMAIN). Categories mirror this
-- repo's own schema.ts section-comment groupings.
-- ============================================================
INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('compliance_items', 'Compliance Items', 'compliance_items', 'compliance', 'CORE', true, 'Core statutory compliance item tracking'),
  ('challans', 'Challan Payments', 'challans', 'compliance', 'CORE', true, 'Government challan payment tracking'),
  ('notices', 'Government Notices', 'notices', 'compliance', 'CORE', true, 'Government notices and show-cause notices'),
  ('audit_points', 'Audit Points', 'audit_points', 'compliance', 'CORE', true, 'Internal/external audit observation tracking'),

  ('board_meetings', 'Board Meetings', 'board_meetings', 'compliance', 'GOVERNANCE', false, 'Board meeting scheduling, minutes, action items'),
  ('committees', 'Committees', 'committees', 'compliance', 'GOVERNANCE', false, 'Board committee composition and charters'),
  ('related_party_transactions', 'Related Party Transactions', 'related_party_transactions', 'compliance', 'GOVERNANCE', false, 'RPT disclosure and approval tracking'),
  ('delegation_of_authority', 'Delegation of Authority', 'delegation_of_authority', 'compliance', 'GOVERNANCE', false, 'DoA matrix and approval limits'),
  ('directors_kmp', 'Directors & KMP Register', 'directors_kmp', 'compliance', 'GOVERNANCE', false, 'Director and key managerial personnel register'),
  ('board_evaluations', 'Board Evaluations', 'board_evaluations', 'compliance', 'GOVERNANCE', false, 'Annual board performance evaluation'),
  ('policies', 'Policy Management', 'policies', 'compliance', 'GOVERNANCE', false, 'Corporate policy lifecycle and publishing'),

  ('cap_table_entries', 'Cap Table Entries', 'cap_table_entries', 'compliance', 'COMPANY_SECRETARIAL', false, 'Shareholding cap table'),
  ('cap_table_events', 'Cap Table Events', 'cap_table_events', 'compliance', 'COMPANY_SECRETARIAL', false, 'Allotment, transfer, buyback events'),
  ('company_charges', 'Company Charges', 'company_charges', 'compliance', 'COMPANY_SECRETARIAL', false, 'Charge creation/modification/satisfaction'),
  ('secretarial_audits', 'Secretarial Audits', 'secretarial_audits', 'compliance', 'COMPANY_SECRETARIAL', false, 'Annual secretarial audit tracking'),
  ('mca_filings', 'MCA e-Filings', 'mca_filings', 'compliance', 'COMPANY_SECRETARIAL', false, 'MCA21 form filing tracking'),

  ('legal_vendors', 'External Legal Vendors', 'legal_vendors', 'compliance', 'LEGAL', false, 'External counsel/law firm empanelment'),
  ('litigation_matters', 'Litigation Matters', 'litigation_matters', 'compliance', 'LEGAL', false, 'Case tracking across courts/forums'),
  ('ip_portfolio', 'IP Portfolio', 'ip_portfolio', 'compliance', 'LEGAL', false, 'Trademarks, patents, copyrights register'),
  ('legal_opinions', 'Legal Opinions', 'legal_opinions', 'compliance', 'LEGAL', false, 'Legal opinion requests and records'),

  ('hr_compliance_items', 'HR Compliance Items', 'hr_compliance_items', 'compliance', 'HR', false, 'PF/ESI/labour law compliance'),
  ('leave_policy_entries', 'Leave Policy Entries', 'leave_policy_entries', 'compliance', 'HR', false, 'Statutory leave policy configuration'),
  ('holiday_list_filings', 'Holiday List Filings', 'holiday_list_filings', 'compliance', 'HR', false, 'Annual holiday list filing'),
  ('posh_committee', 'POSH Committee', 'posh_committee', 'compliance', 'HR', false, 'Internal Committee composition'),
  ('posh_complaints', 'POSH Complaints', 'posh_complaints', 'compliance', 'HR', false, 'POSH complaint case management -- classification-gated'),
  ('posh_annual_reports', 'POSH Annual Reports', 'posh_annual_reports', 'compliance', 'HR', false, 'Annual POSH report filing'),

  ('risks', 'Risk Register', 'risks', 'compliance', 'RISK', false, 'Enterprise risk register with likelihood/impact scoring'),

  ('sebi_compliance_items', 'SEBI Compliance', 'sebi_compliance_items', 'compliance', 'SECTOR_REGULATORS', false, 'SEBI LODR/listing compliance'),
  ('rbi_compliance_items', 'RBI Compliance', 'rbi_compliance_items', 'compliance', 'SECTOR_REGULATORS', false, 'RBI regulatory compliance'),
  ('irdai_compliance_items', 'IRDAI Compliance', 'irdai_compliance_items', 'compliance', 'SECTOR_REGULATORS', false, 'IRDAI regulatory compliance'),

  ('compliance_frameworks', 'Compliance Frameworks', 'compliance_frameworks', 'compliance', 'AUDIT', false, 'Framework library (ISO/SOC2/etc.)'),
  ('framework_controls', 'Framework Controls', 'framework_controls', 'compliance', 'AUDIT', false, 'Control library mapped to frameworks'),
  ('audit_engagements', 'Audit Engagements', 'audit_engagements', 'compliance', 'AUDIT', false, 'Internal/external audit engagement tracking'),
  ('audit_findings', 'Audit Findings', 'audit_findings', 'compliance', 'AUDIT', false, 'Audit finding remediation tracking'),

  ('vendor_risk_profiles', 'Vendor Risk Profiles', 'vendor_risk_profiles', 'compliance', 'ESG', false, 'Third-party/vendor risk assessment'),
  ('esg_metrics', 'ESG / BRSR Metrics', 'esg_metrics', 'compliance', 'ESG', false, 'ESG and BRSR disclosure metrics'),

  ('whistleblower_cases', 'Whistleblower Cases', 'whistleblower_cases', 'compliance', 'INTEGRITY', false, 'Whistleblower case management -- classification-gated'),
  ('bcm_plans', 'BCM Plans', 'bcm_plans', 'compliance', 'INTEGRITY', false, 'Business continuity management plans'),
  ('contract_compliance_items', 'Contract Compliance Items', 'contract_compliance_items', 'compliance', 'INTEGRITY', false, 'Contract obligation compliance tracking'),

  ('incidents', 'Incidents & Events', 'incidents', 'compliance', 'INCIDENTS', false, 'Incident logging with regulatory notification triggers')
ON CONFLICT (module_key) DO NOTHING;

INSERT INTO compliance.product_branches (branch_key, display_name, domain, description) VALUES
  ('grc', 'VERIDIAN AI GRC', 'compliance', 'Governance, Risk & Compliance -- the only product branch live today')
ON CONFLICT (branch_key) DO NOTHING;

-- Every module enabled for the 'grc' branch -- today's actual behavior
-- (every org sees all modules), made explicit rather than implicit.
INSERT INTO compliance.product_branch_modules (product_branch_id, module_key, is_enabled)
SELECT pb.id, mr.module_key, true
FROM compliance.product_branches pb, compliance.module_registry mr
WHERE pb.branch_key = 'grc'
ON CONFLICT (product_branch_id, module_key) DO NOTHING;
