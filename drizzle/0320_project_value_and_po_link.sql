ALTER TABLE compliance.projects ADD COLUMN IF NOT EXISTS project_value numeric;
ALTER TABLE compliance.erp_purchase_orders ADD COLUMN IF NOT EXISTS project_id text;
