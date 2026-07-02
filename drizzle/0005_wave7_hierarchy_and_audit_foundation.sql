-- Wave 7 foundation, applied directly to Supabase project pcrjmlpuqsbocqfwoxod
-- via Supabase MCP. Two parts:
--
-- PART A (idempotent, documents existing state): branches/clients/
-- client_entities/user_client_access and their RLS policies were already
-- live in the database (applied in an earlier session, "Wave 1") but had no
-- corresponding migration file in this repo -- pure schema drift between
-- drizzle/ and reality. This section recreates them with IF NOT EXISTS /
-- ON CONFLICT guards so it's a safe no-op against the current live DB, and
-- brings the migration history back in sync with what's actually deployed.
--
-- PART B (new this session): organisations.account_type (company/ca_firm/
-- legal_firm/consultant), the unified audit_logs upgrade (org_id, client_id,
-- actor_name/actor_role snapshots, user_agent, action -> free text, and a
-- REVOKE that makes the table genuinely append-only at the DB level, not
-- just by convention), documents.org_id (fixes a real RLS gap where
-- notice-only documents were invisible), and three new tables --
-- compliance_costs / cost_payments / notice_dispatches -- for cost tracking
-- and dispatch evidence.

-- ============================================================
-- PART A -- retroactive: hierarchy tables (already live, documenting only)
-- ============================================================

CREATE TABLE IF NOT EXISTS compliance.branches (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.clients (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  branch_id text REFERENCES compliance.branches(id),
  name text NOT NULL,
  is_self boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.client_entities (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  client_id text NOT NULL REFERENCES compliance.clients(id),
  legal_name text NOT NULL,
  entity_type text,
  gstin text,
  pan text,
  cin text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.user_client_access (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id text NOT NULL REFERENCES compliance.users(id),
  client_id text NOT NULL REFERENCES compliance.clients(id),
  access_level text NOT NULL DEFAULT 'full',
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.client_entities ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.user_client_access ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.branches FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_branches ON compliance.branches FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.clients FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_clients ON compliance.clients FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.client_entities FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.clients c WHERE c.id = client_entities.client_id AND c.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_client_entities ON compliance.client_entities FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.user_client_access FOR ALL TO app_runtime
    USING (EXISTS (SELECT 1 FROM compliance.clients c WHERE c.id = user_client_access.client_id AND c.org_id = compliance.current_org_id()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_user_client_access ON compliance.user_client_access FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Backfill: every existing org gets exactly one "Self" client (already true
-- for the one org that exists today, per prior Wave 1 backfill -- ON
-- CONFLICT-free guard via NOT EXISTS makes this safe to rerun) and every
-- client gets at least one client_entities row seeded from the org's own
-- name/entity_type (this part had NOT happened yet -- client_entities was
-- at 0 rows before this migration).
INSERT INTO compliance.clients (org_id, name, is_self)
SELECT o.id, o.name, true
FROM compliance.organisations o
WHERE NOT EXISTS (SELECT 1 FROM compliance.clients c WHERE c.org_id = o.id AND c.is_self = true);

INSERT INTO compliance.client_entities (client_id, legal_name, entity_type)
SELECT c.id, o.name, o.entity_type
FROM compliance.clients c
JOIN compliance.organisations o ON o.id = c.org_id
WHERE c.is_self = true
  AND NOT EXISTS (SELECT 1 FROM compliance.client_entities ce WHERE ce.client_id = c.id);

-- ============================================================
-- PART B -- new this session
-- ============================================================

ALTER TABLE compliance.organisations ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'company';

-- audit_logs upgrade
ALTER TABLE compliance.audit_logs ADD COLUMN IF NOT EXISTS org_id text;
ALTER TABLE compliance.audit_logs ADD COLUMN IF NOT EXISTS client_id text;
ALTER TABLE compliance.audit_logs ADD COLUMN IF NOT EXISTS actor_name text;
ALTER TABLE compliance.audit_logs ADD COLUMN IF NOT EXISTS actor_role text;
ALTER TABLE compliance.audit_logs ADD COLUMN IF NOT EXISTS user_agent text;

-- Backfill the 20 existing rows (pre-Wave-7) so the new NOT NULL columns
-- can actually be enforced -- derives org/name/role from the user who
-- performed each action, the same denormalization the app now does at
-- write time going forward.
UPDATE compliance.audit_logs al
SET org_id = u.org_id, actor_name = u.name, actor_role = u.role::text
FROM compliance.users u
WHERE u.id = al.user_id AND al.org_id IS NULL;

ALTER TABLE compliance.audit_logs ALTER COLUMN org_id SET NOT NULL;
ALTER TABLE compliance.audit_logs ALTER COLUMN actor_name SET NOT NULL;
ALTER TABLE compliance.audit_logs ALTER COLUMN actor_role SET NOT NULL;

-- action: fixed enum -> free text. New GRC modules need new verbs
-- constantly (view/approve/reject/publish_request/escalate/...); an
-- ALTER TYPE per new verb doesn't scale. Existing values are already valid
-- text, so this cast is lossless.
ALTER TABLE compliance.audit_logs ALTER COLUMN action TYPE text USING action::text;

-- True immutability at the DB level, not just app convention: no code path
-- has ever updated or deleted an audit_logs row, so this can't break
-- anything real, and it closes off the possibility going forward.
REVOKE UPDATE, DELETE ON compliance.audit_logs FROM app_runtime;

DROP POLICY IF EXISTS app_runtime_tenant_isolation ON compliance.audit_logs;
DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.audit_logs FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- documents: three real drifts found between schema.ts and the live table,
-- beyond the org_id gap -- notice_id and extracted_data didn't exist at all
-- (schema.ts declared them, but they were never migrated), and
-- compliance_item_id was NOT NULL live despite being declared nullable in
-- schema.ts, which meant a notice-only or general-purpose document was
-- actually impossible to insert, not just invisible under RLS.
ALTER TABLE compliance.documents ADD COLUMN IF NOT EXISTS notice_id text REFERENCES compliance.notices(id);
ALTER TABLE compliance.documents ADD COLUMN IF NOT EXISTS extracted_data jsonb;
ALTER TABLE compliance.documents ALTER COLUMN compliance_item_id DROP NOT NULL;

-- org_id -- fixes a real RLS bug: the old policy only covered rows with
-- compliance_item_id set, so documents attached only to a notice were
-- invisible under RLS. A direct org_id (same pattern as every other table)
-- fixes that and lets documents be a general evidence store.
ALTER TABLE compliance.documents ADD COLUMN IF NOT EXISTS org_id text;

UPDATE compliance.documents d
SET org_id = ci.org_id
FROM compliance.compliance_items ci
WHERE d.compliance_item_id = ci.id AND d.org_id IS NULL;

UPDATE compliance.documents d
SET org_id = n.org_id
FROM compliance.notices n
WHERE d.notice_id = n.id AND d.org_id IS NULL;

-- Remaining rows (neither link set) fall back to the uploader's org.
UPDATE compliance.documents d
SET org_id = u.org_id
FROM compliance.users u
WHERE d.uploaded_by_id = u.id AND d.org_id IS NULL;

ALTER TABLE compliance.documents ALTER COLUMN org_id SET NOT NULL;

DROP POLICY IF EXISTS app_runtime_tenant_isolation ON compliance.documents;
DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.documents FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- compliance_costs / cost_payments / notice_dispatches
DO $$ BEGIN
  CREATE TYPE compliance.cost_type AS ENUM ('government_fee','consultant_fee','penalty_paid','other');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE TYPE compliance.payment_status AS ENUM ('pending','unpaid','partially_paid','paid');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS compliance.compliance_costs (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  compliance_item_id text REFERENCES compliance.compliance_items(id),
  notice_id text REFERENCES compliance.notices(id),
  cost_type compliance.cost_type NOT NULL,
  description text,
  amount numeric(14,2) NOT NULL,
  amount_paid numeric(14,2) NOT NULL DEFAULT 0,
  payment_status compliance.payment_status NOT NULL DEFAULT 'pending',
  paid_to text,
  due_date timestamp,
  receipt_document_id text REFERENCES compliance.documents(id),
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  recorded_by_id text NOT NULL REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.cost_payments (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  compliance_cost_id text NOT NULL REFERENCES compliance.compliance_costs(id),
  amount numeric(14,2) NOT NULL,
  payment_date timestamp NOT NULL,
  payment_method text,
  reference_number text,
  receipt_document_id text REFERENCES compliance.documents(id),
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  recorded_by_id text NOT NULL REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS compliance.notice_dispatches (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  notice_id text NOT NULL REFERENCES compliance.notices(id),
  dispatch_method text,
  tracking_number text,
  courier_name text,
  dispatch_date timestamp,
  delivery_confirmed_date timestamp,
  proof_document_id text REFERENCES compliance.documents(id),
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  client_id text REFERENCES compliance.clients(id),
  recorded_by_id text NOT NULL REFERENCES compliance.users(id),
  created_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.compliance_costs ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.cost_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.notice_dispatches ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.compliance_costs FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_compliance_costs ON compliance.compliance_costs FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- cost_payments is append-only, same principle as audit_logs -- payment
-- corrections are new rows, never edits to a past payment record.
DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.cost_payments FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_cost_payments ON compliance.cost_payments FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
REVOKE UPDATE, DELETE ON compliance.cost_payments FROM app_runtime;

DO $$ BEGIN
  CREATE POLICY app_runtime_tenant_isolation ON compliance.notice_dispatches FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_notice_dispatches ON compliance.notice_dispatches FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- PATCH /api/me referenced these 4 columns since before this session
-- (orgAddress/orgCin/orgGstin/orgPan) but they never existed on
-- organisations -- every admin settings save touching org details threw a
-- raw "column does not exist" error. Adding them for real.
ALTER TABLE compliance.organisations ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE compliance.organisations ADD COLUMN IF NOT EXISTS cin_number text;
ALTER TABLE compliance.organisations ADD COLUMN IF NOT EXISTS gstin text;
ALTER TABLE compliance.organisations ADD COLUMN IF NOT EXISTS pan_number text;
