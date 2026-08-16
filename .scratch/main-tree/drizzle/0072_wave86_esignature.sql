-- Wave 86 (Comparison CSV 2 gap analysis: CLM007 "Electronic Contract
-- Signing" + DMS012 "Digital Signature Management" -- one build closes
-- both). Neither `documents` nor `erp_contracts` had any signing capability
-- before this wave. No paid e-signature provider -- a real first-party
-- signing workflow with a tamper-evident audit trail.

CREATE TABLE IF NOT EXISTS compliance.esignature_requests (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  linked_entity_type text NOT NULL,
  linked_entity_id text NOT NULL,
  title text NOT NULL,
  document_hash text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_by_id text,
  created_at timestamp NOT NULL DEFAULT now(),
  completed_at timestamp
);

CREATE TABLE IF NOT EXISTS compliance.esignature_signers (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL REFERENCES compliance.organisations(id),
  request_id text NOT NULL REFERENCES compliance.esignature_requests(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL,
  sign_order integer,
  status text NOT NULL DEFAULT 'pending',
  user_id text,
  access_token text NOT NULL UNIQUE,
  token_expires_at timestamp NOT NULL,
  signature_image_data text,
  signature_method text,
  signed_at timestamp,
  ip_address text,
  user_agent text,
  document_hash_at_signing text,
  declined_at timestamp,
  decline_reason text,
  created_at timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_esignature_requests_linked_entity ON compliance.esignature_requests(linked_entity_type, linked_entity_id);
CREATE INDEX IF NOT EXISTS idx_esignature_signers_request_id ON compliance.esignature_signers(request_id);

ALTER TABLE compliance.esignature_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.esignature_signers ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.esignature_requests FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.esignature_signers FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY['esignature_requests', 'esignature_signers'])
  LOOP
    EXECUTE format('CREATE POLICY service_role_bypass_%I ON compliance.%I FOR ALL TO service_role USING (true)', t, t);
  END LOOP;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.esignature_requests, compliance.esignature_signers TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.esignature_requests, compliance.esignature_signers TO service_role;
