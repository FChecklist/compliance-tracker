-- Wave 87 (Comparison CSV 2 gap analysis: REP001-004 "Replenishment" +
-- CC001-006 "Inventory Control/Cycle Count/ABC"). Reorder point/safety
-- stock/min-max on items, ABC classification (real Pareto analysis over
-- stock-ledger consumption value), cycle count plans + physical count +
-- variance.

CREATE TABLE IF NOT EXISTS compliance.erp_reorder_levels (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  item_id text NOT NULL REFERENCES compliance.erp_items(id),
  warehouse_id text REFERENCES compliance.erp_warehouses(id),
  reorder_point numeric NOT NULL,
  reorder_qty numeric NOT NULL,
  safety_stock numeric,
  min_level numeric,
  max_level numeric,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_abc_classifications (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  item_id text NOT NULL REFERENCES compliance.erp_items(id),
  classification text NOT NULL,
  consumption_value numeric NOT NULL,
  computed_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_cycle_count_plans (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  warehouse_id text NOT NULL REFERENCES compliance.erp_warehouses(id),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  scheduled_date date,
  created_by_id text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.erp_cycle_count_lines (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  plan_id text NOT NULL REFERENCES compliance.erp_cycle_count_plans(id) ON DELETE CASCADE,
  item_id text NOT NULL REFERENCES compliance.erp_items(id),
  system_qty numeric NOT NULL,
  counted_qty numeric,
  status text NOT NULL DEFAULT 'pending',
  counted_by_id text,
  counted_at timestamp
);

CREATE INDEX IF NOT EXISTS idx_erp_reorder_levels_item_id ON compliance.erp_reorder_levels(item_id);
CREATE INDEX IF NOT EXISTS idx_erp_abc_classifications_item_id ON compliance.erp_abc_classifications(item_id);
CREATE INDEX IF NOT EXISTS idx_erp_cycle_count_lines_plan_id ON compliance.erp_cycle_count_lines(plan_id);

ALTER TABLE compliance.erp_reorder_levels ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.erp_abc_classifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.erp_cycle_count_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.erp_cycle_count_lines ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_reorder_levels FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_abc_classifications FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_cycle_count_plans FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- erp_cycle_count_lines has no org_id of its own (a line belongs to a plan,
-- which is org-scoped) -- matching erp_purchase_order_items/erp_rfq_items'
-- own established convention of scoping via the parent's org_id through a
-- subquery rather than denormalizing org_id onto every child line table.
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.erp_cycle_count_lines FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.erp_cycle_count_plans p WHERE p.id = erp_cycle_count_lines.plan_id AND p.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['erp_reorder_levels', 'erp_abc_classifications', 'erp_cycle_count_plans', 'erp_cycle_count_lines'])
  LOOP
    EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.erp_reorder_levels, compliance.erp_abc_classifications, compliance.erp_cycle_count_plans, compliance.erp_cycle_count_lines
  TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.erp_reorder_levels, compliance.erp_abc_classifications, compliance.erp_cycle_count_plans, compliance.erp_cycle_count_lines
  TO service_role;
