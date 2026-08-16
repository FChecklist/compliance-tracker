-- Wave 60 (Tier 3 #11 remainder): Pricing rules. Sales/Purchase invoicing
-- itself needs no new schema -- erp_sales_invoices/erp_purchase_invoices
-- have existed since Wave 49 with zero service-layer consumer until now.

DO $$ BEGIN
  CREATE TYPE compliance.erp_pricing_applies_to AS ENUM ('all', 'customer', 'item');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.erp_pricing_discount_type AS ENUM ('percentage', 'flat');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS compliance.erp_pricing_rules (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  name text NOT NULL,
  applies_to compliance.erp_pricing_applies_to NOT NULL DEFAULT 'all',
  target_id text,
  discount_type compliance.erp_pricing_discount_type NOT NULL DEFAULT 'percentage',
  discount_value numeric NOT NULL,
  min_qty numeric NOT NULL DEFAULT 0,
  valid_from date NOT NULL,
  valid_to date,
  priority integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by_id text,
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.erp_pricing_rules ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_pricing_rules FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY service_role_bypass_erp_pricing_rules ON compliance.erp_pricing_rules FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.erp_pricing_rules TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.erp_pricing_rules TO service_role;

CREATE INDEX IF NOT EXISTS idx_erp_pricing_rules_org_id ON compliance.erp_pricing_rules(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_pricing_rules_target_id ON compliance.erp_pricing_rules(target_id);

INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('erp_pricing_rules', 'Pricing Rules', 'erp_pricing_rules', 'erp', 'Selling', false, 'Configurable discount rules applied to sales invoice line pricing (all/customer/item scope)')
ON CONFLICT (module_key) DO NOTHING;

INSERT INTO compliance.product_branch_modules (product_branch_id, module_key, is_enabled)
SELECT pb.id, mr.module_key, true
FROM compliance.product_branches pb, compliance.module_registry mr
WHERE pb.branch_key = 'erp' AND mr.module_key = 'erp_pricing_rules'
ON CONFLICT (product_branch_id, module_key) DO NOTHING;
