-- Applied directly to Supabase project pcrjmlpuqsbocqfwoxod on 2026-07-01 via Supabase MCP.
-- Closes: mcp_access_codes, challans, notices, embeddings, onboarding_steps,
-- ingestion_batches, ingestion_items had RLS fully disabled and were reachable
-- via the public anon key (mcp_access_codes holds live Bearer tokens).
-- This mirrors the existing service_role-bypass pattern already in place on the
-- other 9 compliance.* tables, so app behavior (which connects as the `postgres`
-- superuser via DATABASE_URL, and is unaffected by RLS either way) is unchanged.
-- Real per-tenant policies (replacing this blanket bypass) land in Wave 1.

ALTER TABLE compliance.mcp_access_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_mcp_access_codes ON compliance.mcp_access_codes FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE compliance.challans ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_challans ON compliance.challans FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE compliance.notices ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_notices ON compliance.notices FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE compliance.embeddings ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_embeddings ON compliance.embeddings FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE compliance.onboarding_steps ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_onboarding_steps ON compliance.onboarding_steps FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE compliance.ingestion_batches ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_ingestion_batches ON compliance.ingestion_batches FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE compliance.ingestion_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY service_role_bypass_ingestion_items ON compliance.ingestion_items FOR ALL TO service_role USING (true) WITH CHECK (true);
