-- Wave 141: RFIs/Submittals/Punch Lists/Change Orders. None of these exist
-- as OSS libraries -- genuine in-house build, matching this codebase's
-- existing construction module CRUD/status-workflow patterns.

CREATE TYPE compliance.construction_rfi_status AS ENUM ('open', 'answered', 'closed');
CREATE TYPE compliance.construction_ball_in_court AS ENUM ('contractor', 'architect', 'owner', 'consultant');

CREATE TABLE IF NOT EXISTS compliance.construction_rfis (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  number integer NOT NULL,
  subject text NOT NULL,
  question text NOT NULL,
  status compliance.construction_rfi_status NOT NULL DEFAULT 'open',
  ball_in_court compliance.construction_ball_in_court NOT NULL DEFAULT 'architect',
  raised_by_id text NOT NULL,
  assigned_to_id text,
  due_date date,
  answer text,
  answered_by_id text,
  answered_at timestamp,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TYPE compliance.construction_submittal_type AS ENUM ('shop_drawing', 'product_data', 'sample', 'other');
CREATE TYPE compliance.construction_submittal_status AS ENUM ('pending', 'approved', 'approved_as_noted', 'revise_resubmit', 'rejected');

CREATE TABLE IF NOT EXISTS compliance.construction_submittals (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  number integer NOT NULL,
  title text NOT NULL,
  spec_section text,
  type compliance.construction_submittal_type NOT NULL DEFAULT 'shop_drawing',
  status compliance.construction_submittal_status NOT NULL DEFAULT 'pending',
  submitted_by_id text NOT NULL,
  due_date date,
  reviewed_by_id text,
  reviewed_at timestamp,
  review_comments text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TYPE compliance.construction_punch_status AS ENUM ('open', 'ready_for_review', 'verified_closed');
CREATE TYPE compliance.construction_punch_priority AS ENUM ('low', 'medium', 'high');

CREATE TABLE IF NOT EXISTS compliance.construction_punch_list_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  number integer NOT NULL,
  description text NOT NULL,
  location text,
  trade text,
  priority compliance.construction_punch_priority NOT NULL DEFAULT 'medium',
  status compliance.construction_punch_status NOT NULL DEFAULT 'open',
  assigned_to_id text,
  due_date date,
  verified_by_id text,
  verified_at timestamp,
  created_by_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TYPE compliance.construction_change_order_status AS ENUM ('draft', 'pending_approval', 'approved', 'rejected');

CREATE TABLE IF NOT EXISTS compliance.construction_change_orders (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  number integer NOT NULL,
  title text NOT NULL,
  description text,
  reason text,
  cost_impact numeric NOT NULL DEFAULT 0,
  schedule_impact_days integer NOT NULL DEFAULT 0,
  status compliance.construction_change_order_status NOT NULL DEFAULT 'draft',
  requested_by_id text NOT NULL,
  approved_by_id text,
  approved_at timestamp,
  esignature_request_id text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_construction_rfis_org_project ON compliance.construction_rfis(org_id, project_id);
CREATE INDEX IF NOT EXISTS idx_construction_submittals_org_project ON compliance.construction_submittals(org_id, project_id);
CREATE INDEX IF NOT EXISTS idx_construction_punch_list_items_org_project ON compliance.construction_punch_list_items(org_id, project_id);
CREATE INDEX IF NOT EXISTS idx_construction_change_orders_org_project ON compliance.construction_change_orders(org_id, project_id);

ALTER TABLE compliance.construction_rfis ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_submittals ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_punch_list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_change_orders ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_rfis FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_construction_rfis ON compliance.construction_rfis FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_submittals FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_construction_submittals ON compliance.construction_submittals FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_punch_list_items FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_construction_punch_list_items ON compliance.construction_punch_list_items FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.construction_change_orders FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_construction_change_orders ON compliance.construction_change_orders FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
