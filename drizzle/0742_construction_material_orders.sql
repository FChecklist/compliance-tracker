-- WHAT: adds compliance.construction_material_orders, the purchase-order side of the site materials ledger (create_material_order, M-ORDER).
--   An order says "this much of this material is expected on this date"; receipts (construction_material_receipts) are what actually arrived.
--   Closes EXC-ITEM-18 (material ordered without a BOQ line: boq_line_item_id is nullable on purpose and is what the exception check reads)
--   and EXC-ITEM-19 (ordered twice, or late: expected_date + status make "open and past due" a query, the executor refuses a twin).
-- ADDITIVE ONLY: one new table, three indexes, RLS. No existing table or row is touched. DATA LOSS: none.
-- IDEMPOTENT: IF NOT EXISTS / duplicate_object guards, as drizzle/0529 did for construction_material_issues.
-- HOW IT IS APPLIED: not applied by this change. The PM applies it through the Supabase MCP after merge and owner go-ahead, then 0743.
-- ROLLBACK: drizzle/down/0742_construction_material_orders.down.sql

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS compliance.construction_material_orders (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  material_id text NOT NULL REFERENCES compliance.construction_materials(id) ON DELETE RESTRICT,
  quantity numeric NOT NULL CHECK (quantity > 0),
  ordered_date date NOT NULL DEFAULT CURRENT_DATE,
  expected_date date NOT NULL,
  status text NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered', 'received', 'cancelled')),
  boq_line_item_id text,
  reference text,
  notes text,
  created_by_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS construction_material_orders_material_idx ON compliance.construction_material_orders (material_id);
CREATE INDEX IF NOT EXISTS construction_material_orders_project_expected_idx ON compliance.construction_material_orders (org_id, project_id, expected_date);
CREATE INDEX IF NOT EXISTS construction_material_orders_open_idx ON compliance.construction_material_orders (org_id, project_id, expected_date) WHERE status = 'ordered';

-- RLS, the same shape as construction_material_issues (drizzle/0529).
ALTER TABLE compliance.construction_material_orders ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_material_orders FOR ALL TO app_runtime USING (org_id = compliance.current_org_id()); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY service_role_bypass_construction_material_orders ON compliance.construction_material_orders FOR ALL TO service_role USING (true); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;
