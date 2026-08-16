-- Wave 71 (Contract & Commercial Lifecycle Management, per
-- COMPARISON_CSV_GAP_ANALYSIS.md -- Sales>Contract Management was a
-- complete gap; the existing contract_compliance_items table is an
-- unrelated GRC obligations register. Independently designed, no
-- third-party code copied.

CREATE TYPE compliance.erp_contract_status AS ENUM ('draft', 'active', 'expired', 'terminated', 'renewed');
CREATE TYPE compliance.erp_contract_billing_frequency AS ENUM ('monthly', 'quarterly', 'half_yearly', 'annually', 'milestone');
CREATE TYPE compliance.erp_contract_amendment_status AS ENUM ('draft', 'approved');
CREATE TYPE compliance.erp_contract_obligation_status AS ENUM ('pending', 'completed', 'overdue');
CREATE TYPE compliance.erp_subscription_status AS ENUM ('active', 'paused', 'cancelled', 'expired');

CREATE TABLE IF NOT EXISTS compliance.erp_contracts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  customer_id text NOT NULL REFERENCES compliance.erp_customers(id),
  contract_number integer NOT NULL,
  title text NOT NULL,
  contract_type text,
  start_date date NOT NULL,
  end_date date,
  auto_renew boolean NOT NULL DEFAULT false,
  renewal_notice_days integer,
  contract_value numeric NOT NULL DEFAULT 0,
  currency_id text REFERENCES compliance.erp_currencies(id),
  sla_response_hours numeric,
  sla_resolution_hours numeric,
  owner_id text,
  status compliance.erp_contract_status NOT NULL DEFAULT 'draft',
  created_by_id text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_contract_amendments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  contract_id text NOT NULL REFERENCES compliance.erp_contracts(id) ON DELETE CASCADE,
  amendment_number integer NOT NULL,
  description text NOT NULL,
  previous_value numeric,
  new_value numeric,
  effective_date date NOT NULL,
  status compliance.erp_contract_amendment_status NOT NULL DEFAULT 'draft',
  created_by_id text,
  approved_by_id text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_contract_billing_schedules (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  contract_id text NOT NULL REFERENCES compliance.erp_contracts(id) ON DELETE CASCADE,
  billing_frequency compliance.erp_contract_billing_frequency NOT NULL,
  next_billing_date date NOT NULL,
  amount numeric NOT NULL,
  last_invoice_id text REFERENCES compliance.erp_sales_invoices(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_contract_revenue_schedules (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  contract_id text NOT NULL REFERENCES compliance.erp_contracts(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  period_end date NOT NULL,
  recognized_amount numeric NOT NULL DEFAULT 0,
  deferred_amount numeric NOT NULL DEFAULT 0,
  is_recognized boolean NOT NULL DEFAULT false,
  journal_entry_id text REFERENCES compliance.erp_journal_entries(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_contract_obligations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  contract_id text NOT NULL REFERENCES compliance.erp_contracts(id) ON DELETE CASCADE,
  description text NOT NULL,
  due_date date NOT NULL,
  status compliance.erp_contract_obligation_status NOT NULL DEFAULT 'pending',
  responsible_user_id text,
  completed_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_subscription_plans (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  name text NOT NULL,
  billing_frequency compliance.erp_contract_billing_frequency NOT NULL,
  price numeric NOT NULL,
  currency_id text REFERENCES compliance.erp_currencies(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_subscriptions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  contract_id text REFERENCES compliance.erp_contracts(id),
  customer_id text NOT NULL REFERENCES compliance.erp_customers(id),
  plan_id text NOT NULL REFERENCES compliance.erp_subscription_plans(id),
  status compliance.erp_subscription_status NOT NULL DEFAULT 'active',
  start_date date NOT NULL,
  next_renewal_date date,
  cancelled_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_erp_contracts_org_id ON compliance.erp_contracts(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_contracts_customer_id ON compliance.erp_contracts(customer_id);
CREATE INDEX IF NOT EXISTS idx_erp_contract_amendments_contract_id ON compliance.erp_contract_amendments(contract_id);
CREATE INDEX IF NOT EXISTS idx_erp_contract_billing_schedules_contract_id ON compliance.erp_contract_billing_schedules(contract_id);
CREATE INDEX IF NOT EXISTS idx_erp_contract_revenue_schedules_contract_id ON compliance.erp_contract_revenue_schedules(contract_id);
CREATE INDEX IF NOT EXISTS idx_erp_contract_obligations_contract_id ON compliance.erp_contract_obligations(contract_id);
CREATE INDEX IF NOT EXISTS idx_erp_subscription_plans_org_id ON compliance.erp_subscription_plans(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_subscriptions_org_id ON compliance.erp_subscriptions(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_subscriptions_contract_id ON compliance.erp_subscriptions(contract_id);
CREATE INDEX IF NOT EXISTS idx_erp_subscriptions_customer_id ON compliance.erp_subscriptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_erp_subscriptions_plan_id ON compliance.erp_subscriptions(plan_id);

ALTER TABLE compliance.erp_contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.erp_contract_amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.erp_contract_billing_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.erp_contract_revenue_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.erp_contract_obligations ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.erp_subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.erp_subscriptions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_contracts FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_contract_amendments FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.erp_contracts c WHERE c.id = erp_contract_amendments.contract_id AND c.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_contract_billing_schedules FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.erp_contracts c WHERE c.id = erp_contract_billing_schedules.contract_id AND c.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_contract_revenue_schedules FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.erp_contracts c WHERE c.id = erp_contract_revenue_schedules.contract_id AND c.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_contract_obligations FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.erp_contracts c WHERE c.id = erp_contract_obligations.contract_id AND c.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_subscription_plans FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_subscriptions FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_contracts', 'erp_contract_amendments', 'erp_contract_billing_schedules',
    'erp_contract_revenue_schedules', 'erp_contract_obligations',
    'erp_subscription_plans', 'erp_subscriptions'
  ])
  LOOP
    EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.erp_contracts, compliance.erp_contract_amendments, compliance.erp_contract_billing_schedules,
  compliance.erp_contract_revenue_schedules, compliance.erp_contract_obligations,
  compliance.erp_subscription_plans, compliance.erp_subscriptions
  TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.erp_contracts, compliance.erp_contract_amendments, compliance.erp_contract_billing_schedules,
  compliance.erp_contract_revenue_schedules, compliance.erp_contract_obligations,
  compliance.erp_subscription_plans, compliance.erp_subscriptions
  TO service_role;
