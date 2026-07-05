-- Wave 81 (Customer Service enhancements, per COMPARISON_CSV_GAP_ANALYSIS.md
-- backlog item 2). Knowledge Base articles already exist (knowledge_base_pages,
-- Wave 29) -- only search was missing, added at the service layer with no
-- schema change. This migration covers the 4 genuinely new pieces:
-- installed-product/warranty tracking, CSAT/NPS surveys, field-service
-- dispatch, and problem management/RCA grouping.

ALTER TABLE compliance.tickets
  ADD COLUMN IF NOT EXISTS installed_product_id text;

CREATE TABLE IF NOT EXISTS compliance.installed_products (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text,
  product_name text NOT NULL,
  serial_number text,
  installed_at date,
  warranty_expires_at date,
  notes text,
  created_by_id text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.ticket_satisfaction_surveys (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  ticket_id text NOT NULL REFERENCES compliance.tickets(id) ON DELETE CASCADE,
  csat_score integer,
  nps_score integer,
  comment text,
  created_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT csat_score_range CHECK (csat_score IS NULL OR (csat_score BETWEEN 1 AND 5)),
  CONSTRAINT nps_score_range CHECK (nps_score IS NULL OR (nps_score BETWEEN 0 AND 10))
);

CREATE TABLE IF NOT EXISTS compliance.field_service_dispatches (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  ticket_id text NOT NULL REFERENCES compliance.tickets(id) ON DELETE CASCADE,
  technician_user_id text,
  scheduled_at timestamp NOT NULL,
  status text NOT NULL DEFAULT 'scheduled',
  address_text text,
  completed_at timestamp,
  notes text,
  created_by_id text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.problem_records (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  title text NOT NULL,
  root_cause text,
  status text NOT NULL DEFAULT 'open',
  created_by_id text,
  resolved_at timestamp,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.problem_tickets (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  problem_id text NOT NULL REFERENCES compliance.problem_records(id) ON DELETE CASCADE,
  ticket_id text NOT NULL REFERENCES compliance.tickets(id) ON DELETE CASCADE,
  linked_at timestamp NOT NULL DEFAULT now(),
  UNIQUE (problem_id, ticket_id)
);

CREATE INDEX IF NOT EXISTS idx_installed_products_org_id ON compliance.installed_products(org_id);
CREATE INDEX IF NOT EXISTS idx_installed_products_client_id ON compliance.installed_products(client_id);
CREATE INDEX IF NOT EXISTS idx_ticket_satisfaction_surveys_ticket_id ON compliance.ticket_satisfaction_surveys(ticket_id);
CREATE INDEX IF NOT EXISTS idx_field_service_dispatches_ticket_id ON compliance.field_service_dispatches(ticket_id);
CREATE INDEX IF NOT EXISTS idx_problem_records_org_id ON compliance.problem_records(org_id);
CREATE INDEX IF NOT EXISTS idx_problem_tickets_problem_id ON compliance.problem_tickets(problem_id);
CREATE INDEX IF NOT EXISTS idx_problem_tickets_ticket_id ON compliance.problem_tickets(ticket_id);

ALTER TABLE compliance.installed_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.ticket_satisfaction_surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.field_service_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.problem_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.problem_tickets ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.installed_products FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.ticket_satisfaction_surveys FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.field_service_dispatches FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.problem_records FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.problem_tickets FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.problem_records p WHERE p.id = problem_tickets.problem_id AND p.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'installed_products', 'ticket_satisfaction_surveys', 'field_service_dispatches',
    'problem_records', 'problem_tickets'
  ])
  LOOP
    EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.installed_products, compliance.ticket_satisfaction_surveys, compliance.field_service_dispatches,
  compliance.problem_records, compliance.problem_tickets
  TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON
  compliance.installed_products, compliance.ticket_satisfaction_surveys, compliance.field_service_dispatches,
  compliance.problem_records, compliance.problem_tickets
  TO service_role;
