-- T0.4 (docs/infra/TOOL_INTEGRATION_PLAN.md): tracking table for on-demand
-- doc-processing jobs (PaddleOCR/Docling/Whisper.cpp/LibreOffice), dispatched
-- via repository_dispatch to a fresh GitHub Actions job per request (no
-- persistent host). The app creates a row (status='pending'), dispatches,
-- then polls (or subscribes via Realtime, once task #14 lands) for the
-- GitHub Actions job's service-role write to flip status to
-- completed/failed. Same posture as application_errors: a job can be
-- written by the Actions runner before any per-request org context exists
-- in that process, so writes are service_role-bypass; reads are
-- tenant-isolated like every other org-scoped table.
CREATE TABLE IF NOT EXISTS compliance.doc_processing_jobs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL,
  user_id text,
  operation text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  input_ref text NOT NULL,
  result jsonb,
  error text,
  created_at timestamp NOT NULL DEFAULT now(),
  completed_at timestamp
);

CREATE INDEX IF NOT EXISTS idx_doc_processing_jobs_org_id ON compliance.doc_processing_jobs(org_id);
CREATE INDEX IF NOT EXISTS idx_doc_processing_jobs_status ON compliance.doc_processing_jobs(status);
CREATE INDEX IF NOT EXISTS idx_doc_processing_jobs_created_at ON compliance.doc_processing_jobs(created_at);

ALTER TABLE compliance.doc_processing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.doc_processing_jobs FORCE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.doc_processing_jobs FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_doc_processing_jobs ON compliance.doc_processing_jobs FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.doc_processing_jobs TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.doc_processing_jobs TO app_runtime;
