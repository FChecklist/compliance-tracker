-- Wave 113: Visitor Intelligence (VERIDIAN SALES AI). Anonymous public-site
-- analytics + exit-intent offer tracking feeding the Sales Engine's
-- conversion mission. Platform-owned tables (no org_id -- a public visitor
-- belongs to no tenant): RLS is service_role_bypass-only, identical posture
-- to the Wave 109 sales tables. All writes go through
-- visitor-intelligence-service.ts's raw db client.

CREATE TABLE IF NOT EXISTS compliance.visitor_sessions (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  visitor_id text NOT NULL UNIQUE,
  first_seen_at timestamp NOT NULL DEFAULT now(),
  last_seen_at timestamp NOT NULL DEFAULT now(),
  visit_count integer NOT NULL DEFAULT 1,
  first_page text,
  last_page text,
  referrer text,
  user_agent text,
  converted_org_id text,
  converted_at timestamp
);

CREATE TABLE IF NOT EXISTS compliance.visitor_events (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  visitor_id text NOT NULL,
  event_type text NOT NULL,
  page text NOT NULL,
  product_key text,
  section text,
  metadata jsonb,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_visitor_events_visitor ON compliance.visitor_events(visitor_id);
CREATE INDEX IF NOT EXISTS idx_visitor_events_type_created ON compliance.visitor_events(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_visitor_events_product ON compliance.visitor_events(product_key);
CREATE INDEX IF NOT EXISTS idx_visitor_sessions_last_seen ON compliance.visitor_sessions(last_seen_at);

ALTER TABLE compliance.visitor_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.visitor_events ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_visitor_sessions ON compliance.visitor_sessions FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_visitor_events ON compliance.visitor_events FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
