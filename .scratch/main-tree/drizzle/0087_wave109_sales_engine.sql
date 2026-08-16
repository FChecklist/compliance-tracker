-- Wave 109 (Sales Engine): cross-product referral, pipeline & commission
-- tracking. Attaches to every existing product (grc/office, erp, pms, hr,
-- facilities_management, the_firm, forge) so external sales partners
-- (resellers, consultants, referral agents, commission agents, third
-- parties) each get a personalized referral link; anyone who clicks it is
-- attributed to that partner through signup, org provisioning, and
-- eventual payment, with a different commission structure per product.
-- All 5 tables are platform-owned (no org_id) -- a sales partner is not a
-- member of any one tenant, the same "no tenant to scope by" rationale
-- product_branches itself already carries. See RLS section below for why
-- these tables get NO app_runtime policy at all.

-- ============================================================
-- 1. Enums
-- ============================================================
DO $$ BEGIN
  CREATE TYPE compliance.sales_partner_type AS ENUM ('reseller', 'consultant', 'referral_agent', 'commission_agent', 'third_party');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.sales_partner_status AS ENUM ('active', 'suspended', 'offboarded');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.sales_referral_status AS ENUM ('clicked', 'signup_completed', 'org_provisioned', 'paid', 'lost');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.sales_commission_type AS ENUM ('percentage', 'flat');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.sales_commission_accrual_status AS ENUM ('accrued', 'paid', 'void');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- 2. Tables (dependency order)
-- ============================================================

CREATE TABLE IF NOT EXISTS compliance.sales_partners (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  phone text,
  partner_type compliance.sales_partner_type NOT NULL,
  status compliance.sales_partner_status NOT NULL DEFAULT 'active',
  company_name text,
  notes text,
  dashboard_token text NOT NULL UNIQUE,
  dashboard_token_expires_at timestamp NOT NULL,
  dashboard_token_revoked_at timestamp,
  created_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.sales_referral_links (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sales_partner_id text NOT NULL REFERENCES compliance.sales_partners(id),
  product_key text,
  token text NOT NULL UNIQUE,
  label text,
  is_active boolean NOT NULL DEFAULT true,
  click_count integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.sales_referrals (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sales_partner_id text NOT NULL REFERENCES compliance.sales_partners(id),
  sales_referral_link_id text NOT NULL REFERENCES compliance.sales_referral_links(id),
  product_key text,
  status compliance.sales_referral_status NOT NULL DEFAULT 'clicked',
  ip_address text,
  user_agent text,
  auth_user_id text,
  org_id text,
  clicked_at timestamp NOT NULL DEFAULT now(),
  signup_completed_at timestamp,
  org_provisioned_at timestamp,
  paid_at timestamp,
  lost_at timestamp,
  lost_reason text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.sales_commission_plans (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  product_key text NOT NULL,
  partner_type compliance.sales_partner_type,
  commission_type compliance.sales_commission_type NOT NULL,
  rate numeric(6,3),
  flat_amount numeric(12,2),
  currency text NOT NULL DEFAULT 'INR',
  valid_from timestamp NOT NULL DEFAULT now(),
  valid_to timestamp,
  is_active boolean NOT NULL DEFAULT true,
  created_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.sales_commission_accruals (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  sales_referral_id text NOT NULL REFERENCES compliance.sales_referrals(id),
  sales_partner_id text NOT NULL REFERENCES compliance.sales_partners(id),
  product_key text NOT NULL,
  sales_commission_plan_id text REFERENCES compliance.sales_commission_plans(id),
  deal_value numeric(12,2),
  amount numeric(12,2) NOT NULL,
  currency text NOT NULL DEFAULT 'INR',
  status compliance.sales_commission_accrual_status NOT NULL DEFAULT 'accrued',
  note text,
  recorded_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now()
);

-- ============================================================
-- 3. Indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_sales_referral_links_partner_id ON compliance.sales_referral_links(sales_partner_id);
CREATE INDEX IF NOT EXISTS idx_sales_referrals_partner_id ON compliance.sales_referrals(sales_partner_id);
CREATE INDEX IF NOT EXISTS idx_sales_referrals_link_id ON compliance.sales_referrals(sales_referral_link_id);
CREATE INDEX IF NOT EXISTS idx_sales_referrals_org_id ON compliance.sales_referrals(org_id);
CREATE INDEX IF NOT EXISTS idx_sales_referrals_status ON compliance.sales_referrals(status);
CREATE INDEX IF NOT EXISTS idx_sales_commission_plans_product_key ON compliance.sales_commission_plans(product_key);
CREATE INDEX IF NOT EXISTS idx_sales_commission_accruals_referral_id ON compliance.sales_commission_accruals(sales_referral_id);
CREATE INDEX IF NOT EXISTS idx_sales_commission_accruals_partner_id ON compliance.sales_commission_accruals(sales_partner_id);

-- ============================================================
-- 4. RLS -- deliberately NO app_runtime policy on any of these 5 tables.
--    There is no org_id and no tenant GUC means anything for an external
--    sales partner; every application access path uses the raw
--    (RLS-bypassing) `db` export in sales-engine-service.ts, gated
--    instead by explicit token/role checks in application code -- the
--    exact same posture auth-guard.ts's autoProvisionUser() already uses
--    for organisations/users/departments. service_role_bypass alone is
--    the correct and sufficient policy here.
-- ============================================================
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'sales_partners', 'sales_referral_links', 'sales_referrals',
    'sales_commission_plans', 'sales_commission_accruals'
  ]
  LOOP
    EXECUTE format('ALTER TABLE compliance.%I ENABLE ROW LEVEL SECURITY', t);
    BEGIN
      EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END LOOP;
END $$;

-- ============================================================
-- 5. Seed: product_branches row for 'forge' -- a pure marketing/services
--    page today (src/app/forge/page.tsx), not a self-serve tenant
--    feature, but needs to be referenceable by product_key convention.
--    Reuses the already-valid 'planned' status rather than inventing a
--    new one.
-- ============================================================
INSERT INTO compliance.product_branches
  (branch_key, display_name, domain, description, tagline, icon, status, launch_order, parent_domain, build_tier) VALUES
  ('forge', 'FORGE - AI Engineering', 'services',
   'Bespoke, flat-fee custom AI-OS software engineering service (not a self-serve tenant feature) -- referenced by the Sales Engine for commission-plan and referral-link product_key attribution.',
   'Custom software shouldn''t cost lakhs. Or months.', 'Hammer', 'planned', 16, 'professional_services', null)
ON CONFLICT (branch_key) DO NOTHING;

-- ============================================================
-- 6. Seed: default commission plans, one per existing live product, at a
--    placeholder 10% rate -- a real business decision for the platform
--    owner to confirm/adjust, not assumed correct. Partial unique index
--    (one default, still-current plan per product) makes this seed
--    idempotent on a re-run without constraining the schema's intentional
--    support for multiple historical/override plans over time.
-- ============================================================
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_commission_plans_default_current
  ON compliance.sales_commission_plans(product_key) WHERE partner_type IS NULL AND valid_to IS NULL;

INSERT INTO compliance.sales_commission_plans (product_key, partner_type, commission_type, rate, currency) VALUES
  ('grc', NULL, 'percentage', 10.000, 'INR'),
  ('erp', NULL, 'percentage', 10.000, 'INR'),
  ('pms', NULL, 'percentage', 10.000, 'INR'),
  ('hr', NULL, 'percentage', 10.000, 'INR'),
  ('facilities_management', NULL, 'percentage', 10.000, 'INR'),
  ('the_firm', NULL, 'percentage', 10.000, 'INR'),
  ('forge', NULL, 'percentage', 10.000, 'INR')
ON CONFLICT (product_key) WHERE partner_type IS NULL AND valid_to IS NULL DO NOTHING;
