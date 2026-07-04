-- Wave 39: VERIDIAN Ticketing (PLATFORM_STRATEGY.md §21). Peppermint/
-- Trudesk/FlowInquiry evaluated and rejected as software (each needs its
-- own standalone server). A support ticket wraps an existing conversation
-- (Wave 12) rather than rebuilding a second messaging system -- every
-- reply, guest message (Wave 36), markdown rendering (Wave 37), and
-- attachment (Wave 32) already works for free via conversation_id.

CREATE TABLE IF NOT EXISTS compliance.tickets (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  conversation_id text NOT NULL REFERENCES compliance.conversations(id),
  subject text NOT NULL,
  category text,
  priority text NOT NULL DEFAULT 'medium',
  status text NOT NULL DEFAULT 'open',
  assignee_id text REFERENCES compliance.users(id),
  requester_user_id text REFERENCES compliance.users(id),
  sla_deadline timestamp,
  resolved_at timestamp,
  created_by_id text NOT NULL REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.tickets ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.tickets FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_tickets ON compliance.tickets FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.tickets TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.tickets TO service_role;

CREATE INDEX IF NOT EXISTS idx_tickets_org_id ON compliance.tickets(org_id);
CREATE INDEX IF NOT EXISTS idx_tickets_conversation_id ON compliance.tickets(conversation_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON compliance.tickets(status);
CREATE INDEX IF NOT EXISTS idx_tickets_assignee_id ON compliance.tickets(assignee_id);

INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('tickets', 'Ticketing', 'tickets', 'ticketing', 'TOOLS', true, 'Customer-facing support tickets, wrapping the existing VERI Chat conversation/guest-access substrate')
ON CONFLICT (module_key) DO NOTHING;
