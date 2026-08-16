-- Landing-page lead capture (Join Us / Contact Us). Platform-owned table (no
-- org_id -- a public visitor belongs to no tenant yet), same posture as Wave
-- 113's visitor_sessions/visitor_events: RLS is service_role_bypass-only, all
-- writes go through contact-service.ts's raw db client. Keyed by the same
-- anonymous visitor_id VisitorIntelligence.tsx already generates, so a draft
-- started on /join-us and later submitted on /contact still ties back to one
-- visitor's journey.

CREATE TABLE IF NOT EXISTS compliance.contact_submissions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  visitor_id text NOT NULL,
  category text, -- 'associate' | 'sales_partner' | 'ai_researcher' | null (general contact)
  name text,
  email text,
  mobile text,
  message text,
  status text NOT NULL DEFAULT 'draft', -- 'draft' | 'submitted'
  confirm_token text,
  email_confirmed_at timestamp,
  submitted_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_submissions_visitor ON compliance.contact_submissions(visitor_id);
CREATE INDEX IF NOT EXISTS idx_contact_submissions_status ON compliance.contact_submissions(status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_contact_submissions_confirm_token ON compliance.contact_submissions(confirm_token) WHERE confirm_token IS NOT NULL;

ALTER TABLE compliance.contact_submissions ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_contact_submissions ON compliance.contact_submissions FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
