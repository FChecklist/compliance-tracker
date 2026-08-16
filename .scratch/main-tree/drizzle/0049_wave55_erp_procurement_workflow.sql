-- Wave 55 (VERI ERP gap-fill, Tier 3 #10): Procurement Workflow above the
-- PO -- Purchase Requisition + RFQ + Supplier Quotation. Zero schema
-- existed for any of these before this wave; every PO was a standalone
-- document with no upstream authorization trail.

DO $$ BEGIN
  CREATE TYPE compliance.erp_requisition_status AS ENUM ('draft', 'submitted', 'approved', 'rejected', 'converted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.erp_rfq_status AS ENUM ('draft', 'sent', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.erp_supplier_quotation_status AS ENUM ('draft', 'submitted');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS compliance.erp_purchase_requisitions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  requisition_number integer NOT NULL,
  requested_by_id text REFERENCES compliance.users(id),
  department_id text REFERENCES compliance.departments(id),
  purpose text,
  posting_date date NOT NULL,
  status compliance.erp_requisition_status NOT NULL DEFAULT 'draft',
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_purchase_requisition_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  requisition_id text NOT NULL REFERENCES compliance.erp_purchase_requisitions(id) ON DELETE CASCADE,
  item_id text REFERENCES compliance.erp_items(id),
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  estimated_rate numeric
);

CREATE TABLE IF NOT EXISTS compliance.erp_rfqs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  rfq_number integer NOT NULL,
  requisition_id text REFERENCES compliance.erp_purchase_requisitions(id),
  posting_date date NOT NULL,
  status compliance.erp_rfq_status NOT NULL DEFAULT 'draft',
  created_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_rfq_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  rfq_id text NOT NULL REFERENCES compliance.erp_rfqs(id) ON DELETE CASCADE,
  item_id text REFERENCES compliance.erp_items(id),
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS compliance.erp_rfq_suppliers (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  rfq_id text NOT NULL REFERENCES compliance.erp_rfqs(id) ON DELETE CASCADE,
  supplier_id text NOT NULL REFERENCES compliance.erp_suppliers(id)
);

CREATE TABLE IF NOT EXISTS compliance.erp_supplier_quotations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  rfq_id text REFERENCES compliance.erp_rfqs(id),
  supplier_id text NOT NULL REFERENCES compliance.erp_suppliers(id),
  quotation_number integer NOT NULL,
  posting_date date NOT NULL,
  valid_till date,
  status compliance.erp_supplier_quotation_status NOT NULL DEFAULT 'draft',
  created_by_id text REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_supplier_quotation_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  quotation_id text NOT NULL REFERENCES compliance.erp_supplier_quotations(id) ON DELETE CASCADE,
  item_id text REFERENCES compliance.erp_items(id),
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  rate numeric NOT NULL DEFAULT 0
);

-- ============================================================
-- RLS
-- ============================================================
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_purchase_requisitions', 'erp_purchase_requisition_items',
    'erp_rfqs', 'erp_rfq_items', 'erp_rfq_suppliers',
    'erp_supplier_quotations', 'erp_supplier_quotation_items'
  ])
  LOOP
    EXECUTE format('ALTER TABLE compliance.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_purchase_requisitions FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_purchase_requisition_items FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.erp_purchase_requisitions r WHERE r.id = erp_purchase_requisition_items.requisition_id AND r.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_rfqs FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_rfq_items FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.erp_rfqs q WHERE q.id = erp_rfq_items.rfq_id AND q.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_rfq_suppliers FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.erp_rfqs q WHERE q.id = erp_rfq_suppliers.rfq_id AND q.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_supplier_quotations FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_supplier_quotation_items FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.erp_supplier_quotations sq WHERE sq.id = erp_supplier_quotation_items.quotation_id AND sq.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'erp_purchase_requisitions', 'erp_purchase_requisition_items',
    'erp_rfqs', 'erp_rfq_items', 'erp_rfq_suppliers',
    'erp_supplier_quotations', 'erp_supplier_quotation_items'
  ])
  LOOP
    EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.erp_purchase_requisitions, compliance.erp_purchase_requisition_items,
  compliance.erp_rfqs, compliance.erp_rfq_items, compliance.erp_rfq_suppliers,
  compliance.erp_supplier_quotations, compliance.erp_supplier_quotation_items
  TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.erp_purchase_requisitions, compliance.erp_purchase_requisition_items,
  compliance.erp_rfqs, compliance.erp_rfq_items, compliance.erp_rfq_suppliers,
  compliance.erp_supplier_quotations, compliance.erp_supplier_quotation_items
  TO service_role;

-- ============================================================
-- Covering indexes
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_erp_pr_org_id ON compliance.erp_purchase_requisitions(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_pr_requested_by_id ON compliance.erp_purchase_requisitions(requested_by_id);
CREATE INDEX IF NOT EXISTS idx_erp_pr_department_id ON compliance.erp_purchase_requisitions(department_id);
CREATE INDEX IF NOT EXISTS idx_erp_pri_requisition_id ON compliance.erp_purchase_requisition_items(requisition_id);
CREATE INDEX IF NOT EXISTS idx_erp_pri_item_id ON compliance.erp_purchase_requisition_items(item_id);
CREATE INDEX IF NOT EXISTS idx_erp_rfqs_org_id ON compliance.erp_rfqs(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_rfqs_requisition_id ON compliance.erp_rfqs(requisition_id);
CREATE INDEX IF NOT EXISTS idx_erp_rfqs_created_by_id ON compliance.erp_rfqs(created_by_id);
CREATE INDEX IF NOT EXISTS idx_erp_rfq_items_rfq_id ON compliance.erp_rfq_items(rfq_id);
CREATE INDEX IF NOT EXISTS idx_erp_rfq_items_item_id ON compliance.erp_rfq_items(item_id);
CREATE INDEX IF NOT EXISTS idx_erp_rfq_suppliers_rfq_id ON compliance.erp_rfq_suppliers(rfq_id);
CREATE INDEX IF NOT EXISTS idx_erp_rfq_suppliers_supplier_id ON compliance.erp_rfq_suppliers(supplier_id);
CREATE INDEX IF NOT EXISTS idx_erp_sq_org_id ON compliance.erp_supplier_quotations(org_id);
CREATE INDEX IF NOT EXISTS idx_erp_sq_rfq_id ON compliance.erp_supplier_quotations(rfq_id);
CREATE INDEX IF NOT EXISTS idx_erp_sq_supplier_id ON compliance.erp_supplier_quotations(supplier_id);
CREATE INDEX IF NOT EXISTS idx_erp_sq_created_by_id ON compliance.erp_supplier_quotations(created_by_id);
CREATE INDEX IF NOT EXISTS idx_erp_sqi_quotation_id ON compliance.erp_supplier_quotation_items(quotation_id);
CREATE INDEX IF NOT EXISTS idx_erp_sqi_item_id ON compliance.erp_supplier_quotation_items(item_id);

-- ============================================================
-- Module Registry seed
-- ============================================================
INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('erp_procurement_workflow', 'Procurement Workflow', 'erp_purchase_requisitions', 'erp', 'Buying', false, 'Purchase requisition, RFQ, and supplier quotation comparison above the PO')
ON CONFLICT (module_key) DO NOTHING;

INSERT INTO compliance.product_branch_modules (product_branch_id, module_key, is_enabled)
SELECT pb.id, mr.module_key, true
FROM compliance.product_branches pb, compliance.module_registry mr
WHERE pb.branch_key = 'erp' AND mr.module_key = 'erp_procurement_workflow'
ON CONFLICT (product_branch_id, module_key) DO NOTHING;
