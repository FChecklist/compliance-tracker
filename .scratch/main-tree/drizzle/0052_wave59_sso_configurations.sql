-- Wave 59 (Tier 3 #13, second half): SAML SSO configuration per org.
-- One config per org for this pass. Session establishment reuses the
-- existing Supabase magic-link + /auth/callback flow, not a new mechanism.

CREATE TABLE IF NOT EXISTS compliance.sso_configurations (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id text NOT NULL UNIQUE REFERENCES compliance.organisations(id),
  idp_entry_point text NOT NULL,
  idp_issuer text NOT NULL,
  idp_cert text NOT NULL,
  sp_entity_id text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT false,
  created_by_id text,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);

ALTER TABLE compliance.sso_configurations ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.sso_configurations FOR ALL TO app_runtime USING (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY service_role_bypass_sso_configurations ON compliance.sso_configurations FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.sso_configurations TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.sso_configurations TO service_role;

CREATE INDEX IF NOT EXISTS idx_sso_configurations_org_id ON compliance.sso_configurations(org_id);

INSERT INTO compliance.module_registry (module_key, display_name, table_name, domain, category, is_core, description) VALUES
  ('sso_saml', 'SAML SSO', 'sso_configurations', 'platform', 'Security', false, 'Service-Provider-side SAML 2.0 single sign-on, one identity provider per organisation')
ON CONFLICT (module_key) DO NOTHING;
