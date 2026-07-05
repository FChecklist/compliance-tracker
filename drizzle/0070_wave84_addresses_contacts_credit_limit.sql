-- Wave 84 (COMPARISON_CSV_GAP_ANALYSIS.md backlog #5): Customer/Vendor
-- Master was missing multiple addresses/contacts per record and credit
-- limits. Addresses/contacts are polymorphic (linked_entity_type/
-- linked_entity_id), matching the existing `documents` table's own
-- convention (Wave 61) rather than a parallel customer-only and
-- supplier-only pair of tables.

ALTER TABLE compliance.erp_customers ADD COLUMN IF NOT EXISTS credit_limit numeric;
ALTER TABLE compliance.erp_suppliers ADD COLUMN IF NOT EXISTS credit_limit numeric;

CREATE TABLE IF NOT EXISTS compliance.erp_addresses (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  linked_entity_type text NOT NULL,
  linked_entity_id text NOT NULL,
  address_type text NOT NULL DEFAULT 'billing',
  line1 text NOT NULL,
  line2 text,
  city text,
  state text,
  postal_code text,
  country text,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_contacts (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  linked_entity_type text NOT NULL,
  linked_entity_id text NOT NULL,
  contact_name text NOT NULL,
  designation text,
  email text,
  phone text,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_erp_addresses_linked_entity ON compliance.erp_addresses(linked_entity_type, linked_entity_id);
CREATE INDEX IF NOT EXISTS idx_erp_contacts_linked_entity ON compliance.erp_contacts(linked_entity_type, linked_entity_id);

ALTER TABLE compliance.erp_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.erp_contacts ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_addresses FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_contacts FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['erp_addresses', 'erp_contacts'])
  LOOP
    EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.erp_addresses, compliance.erp_contacts TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.erp_addresses, compliance.erp_contacts TO service_role;
