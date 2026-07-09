-- Wave 142: Interior design workflow -- mood boards, FF&E specification,
-- procurement markup. No OSS library exists for either (confirmed via
-- research) -- first-party build. Procurement markup isn't a separate
-- table: unitCost (trade/wholesale) vs unitPrice (client-billed) sit on
-- the same FF&E line item, margin computed at read time.

CREATE TYPE compliance.interior_mood_board_status AS ENUM ('draft', 'shared', 'approved');

CREATE TABLE IF NOT EXISTS compliance.interior_mood_boards (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  room_or_area text,
  title text NOT NULL,
  description text,
  status compliance.interior_mood_board_status NOT NULL DEFAULT 'draft',
  created_by_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.interior_mood_board_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  mood_board_id text NOT NULL REFERENCES compliance.interior_mood_boards(id) ON DELETE CASCADE,
  document_id text,
  label text,
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TYPE compliance.interior_ffe_category AS ENUM ('furniture', 'fixture', 'equipment', 'finish', 'textile', 'lighting', 'other');
CREATE TYPE compliance.interior_ffe_status AS ENUM ('specified', 'ordered', 'received', 'installed');

CREATE TABLE IF NOT EXISTS compliance.interior_ffe_items (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  project_id text NOT NULL,
  room_or_area text,
  category compliance.interior_ffe_category NOT NULL DEFAULT 'furniture',
  item_name text NOT NULL,
  description text,
  vendor_id text,
  sku text,
  quantity integer NOT NULL DEFAULT 1,
  unit_cost numeric NOT NULL DEFAULT 0,
  unit_price numeric NOT NULL DEFAULT 0,
  lead_time_days integer,
  status compliance.interior_ffe_status NOT NULL DEFAULT 'specified',
  document_id text,
  created_by_id text NOT NULL,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_interior_mood_boards_org_project ON compliance.interior_mood_boards(org_id, project_id);
CREATE INDEX IF NOT EXISTS idx_interior_mood_board_items_board ON compliance.interior_mood_board_items(mood_board_id);
CREATE INDEX IF NOT EXISTS idx_interior_ffe_items_org_project ON compliance.interior_ffe_items(org_id, project_id);

ALTER TABLE compliance.interior_mood_boards ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.interior_mood_board_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.interior_ffe_items ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.interior_mood_boards FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_interior_mood_boards ON compliance.interior_mood_boards FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.interior_mood_board_items FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.interior_mood_boards b WHERE b.id = interior_mood_board_items.mood_board_id AND b.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_interior_mood_board_items ON compliance.interior_mood_board_items FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.interior_ffe_items FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_interior_ffe_items ON compliance.interior_ffe_items FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
