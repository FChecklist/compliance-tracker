-- Wave 19 (VAIOS): Code-Change-Request workflow + Product/Project (L2)
-- scope layer. See PLATFORM_STRATEGY.md §10-11 for the constitution text
-- and gap analysis this implements, and the honesty sections there for
-- exactly what this wave does and does NOT establish (no literal L2 AI
-- actor, no automated code-change pipeline).

-- ============================================================
-- PART A: Code-Change-Request workflow
-- ============================================================
-- Reuses compliance.approval_requests (same generic maker-checker Wave 8's
-- Policy-publish and Wave 16's worker_agent_proposal flows already use) --
-- this satellite table holds the extra fields a code-change request needs
-- that approval_requests' entityId (which assumes a pre-existing row to
-- point at) can't.
CREATE TABLE IF NOT EXISTS compliance.code_change_requests (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  approval_request_id text NOT NULL REFERENCES compliance.approval_requests(id),
  originating_layer text NOT NULL,
  requested_change text NOT NULL,
  justification text,
  status text NOT NULL DEFAULT 'pending',
  implemented_at timestamp,
  implementation_note text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.code_change_requests ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.code_change_requests FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_code_change_requests ON compliance.code_change_requests FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE ON compliance.code_change_requests TO service_role;

CREATE INDEX IF NOT EXISTS idx_code_change_requests_approval_request_id ON compliance.code_change_requests(approval_request_id);
CREATE INDEX IF NOT EXISTS idx_code_change_requests_org_id ON compliance.code_change_requests(org_id);
CREATE INDEX IF NOT EXISTS idx_code_change_requests_status ON compliance.code_change_requests(status);

-- ============================================================
-- PART B: Product/Project (L2) scope layer
-- ============================================================
-- A scope/data layer only, NOT an AI actor -- clients/client_entities are
-- the wrong shape for this (a CA firm's own client companies, not a
-- "product" like Sales/HR/GRC per PLATFORM_STRATEGY.md §2).
CREATE TABLE IF NOT EXISTS compliance.products (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  name text NOT NULL,
  slug text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  UNIQUE(org_id, slug)
);

CREATE TABLE IF NOT EXISTS compliance.projects (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  product_id text NOT NULL REFERENCES compliance.products(id),
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

-- Wired into two real existing concepts to prove the layer is functional,
-- not decorative.
ALTER TABLE compliance.tasks ADD COLUMN IF NOT EXISTS project_id text REFERENCES compliance.projects(id);
ALTER TABLE compliance.worker_agents ADD COLUMN IF NOT EXISTS project_id text REFERENCES compliance.projects(id);

ALTER TABLE compliance.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.projects ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.products FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_products ON compliance.products FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.projects FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_projects ON compliance.projects FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.products, compliance.projects TO service_role;

CREATE INDEX IF NOT EXISTS idx_products_org_id ON compliance.products(org_id);
CREATE INDEX IF NOT EXISTS idx_projects_product_id ON compliance.projects(product_id);
CREATE INDEX IF NOT EXISTS idx_projects_org_id ON compliance.projects(org_id);
CREATE INDEX IF NOT EXISTS idx_projects_client_id ON compliance.projects(client_id);
CREATE INDEX IF NOT EXISTS idx_tasks_project_id ON compliance.tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_worker_agents_project_id ON compliance.worker_agents(project_id);
