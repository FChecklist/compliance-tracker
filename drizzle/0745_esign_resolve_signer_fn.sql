-- PRE-APPROVED-LIVE-DDL: Owner (Rajat Agarwal) approved the D3 e-sign token-lookup hardening in chat on 2026-10-10 ("fix the manual and do the D3 change and complete all the pending work")
-- Applied live by the lead after review (additive: one SECURITY DEFINER function, nothing dropped or altered).
--
-- D3: the public, tokenized e-sign path (esignature-service.ts) looked the signer up with the shared db handle, which only works when the connecting role
-- bypasses row-level security (true for `postgres`, false for `app_runtime`: the lookup then finds nothing and a valid signing link answers 404).
-- This function is the ONE narrow bypass: it maps an exact access token to (signer id, org id) and nothing else. The service then does every other read
-- and write inside withTenantContext({ orgId }) like the rest of the app, so RLS stays on for them.
CREATE OR REPLACE FUNCTION compliance.esign_resolve_signer(p_token text)
RETURNS TABLE (signer_id text, org_id text)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = compliance, pg_temp
AS $$
  SELECT s.id, s.org_id FROM compliance.esignature_signers s WHERE s.access_token = p_token LIMIT 1;
$$;

REVOKE ALL ON FUNCTION compliance.esign_resolve_signer(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION compliance.esign_resolve_signer(text) TO app_runtime, service_role;
