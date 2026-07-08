-- FORGE intake requests. Platform-owned (no org_id -- a prospective
-- customer belongs to no tenant yet), same posture as contact_submissions/
-- visitor_sessions: RLS is service_role_bypass-only, all writes go through
-- forge-intake-service.ts's raw db client. selection_path stores the full
-- Mode Pill + Chain Selector walk (ordered array of node keys) so the FORGE
-- team can see exactly what was captured without re-deriving it from labels.

CREATE TABLE IF NOT EXISTS compliance.forge_project_requests (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  visitor_id text NOT NULL,
  selection_path jsonb NOT NULL DEFAULT '[]',
  selection_labels jsonb NOT NULL DEFAULT '[]',
  notes text,
  email text,
  status text NOT NULL DEFAULT 'draft', -- 'draft' | 'submitted'
  confirm_token text,
  email_confirmed_at timestamp,
  submitted_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_forge_project_requests_visitor ON compliance.forge_project_requests(visitor_id);
CREATE INDEX IF NOT EXISTS idx_forge_project_requests_status ON compliance.forge_project_requests(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_forge_project_requests_confirm_token ON compliance.forge_project_requests(confirm_token) WHERE confirm_token IS NOT NULL;

ALTER TABLE compliance.forge_project_requests ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_forge_project_requests ON compliance.forge_project_requests FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
