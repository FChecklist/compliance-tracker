-- Fix: enable RLS on compliance.chunk_policy (Supabase advisor CRITICAL
-- finding, project pcrjmlpuqsbocqfwoxod / verdian-ai). chunk_policy was the
-- only table left in the compliance schema with RLS disabled entirely --
-- 0327_crr_p2_schema_drizzle_sync.sql created the table and explicitly
-- enabled RLS on every other new table in that migration EXCEPT this one,
-- with its own comment noting why: "RLS: enabled + tenant-isolation
-- policies on every table above with an org_id column (all except
-- chunk_policy, which is shared platform config)." schema.ts's own header
-- comment on the table (chunkPolicy, compliance/schema.ts) says the same
-- thing: "Global, non-tenant-scoped chunking configuration per
-- business-object type -- replaces a hard-coded 1000-character constant in
-- TypeScript. No orgId: this is shared platform config, not tenant data."
--
-- Real live shape (verified against pcrjmlpuqsbocqfwoxod): id (text PK),
-- business_object_type (text, UNIQUE), max_chars (integer), overlap_chars
-- (integer), split_on (enum: paragraph/sentence/page/fixed), created_at.
-- No org_id column. Exactly 3 rows live today (generic/construction/
-- india_compliance business-object types) -- genuine platform-wide
-- reference/config data, not tenant data.
--
-- A bare `ENABLE ROW LEVEL SECURITY` with zero policies (the Supabase
-- advisor's own generic remediation) would be WRONG here: Postgres RLS
-- defaults to deny-all once enabled, and
-- src/lib/services/document-extraction-service.ts's chunkAndEmbedSourceObject()
-- does an unfiltered `db.select().from(chunkPolicy)` (fetches all 3 rows,
-- then picks the right one in-process via pickChunkPolicy()) -- every org's
-- document-ingestion pipeline depends on that unfiltered read succeeding.
-- A deny-all policy set would silently return zero rows to every org and
-- break ingestion platform-wide.
--
-- Instead this follows this repo's own established "platform-wide
-- reference table" RLS convention (Pattern A), the same shape already used
-- for gst_gstin_master/gst_hsn_master (drizzle/0100_gst_reconciliation_engine.sql)
-- and platform_billing_plans (drizzle/0400_platform_billing_plans_invoices.sql):
-- RLS enabled + FORCED, a SELECT-only app_runtime_read_all policy
-- (USING (true)) so every org's read path keeps working unfiltered, and the
-- standard unconditional service_role_bypass policy. No write policy for
-- app_runtime -- like gst_hsn_master, chunk_policy is owner/admin-edited
-- config seeded by migrations, not something org users write to via the
-- app; GRANT is SELECT-only for app_runtime, full CRUD for service_role.
--
-- Idempotent throughout (ENABLE/FORCE ROW LEVEL SECURITY are natural
-- no-ops if already applied; CREATE POLICY is wrapped in the
-- duplicate_object-tolerant DO block this repo uses everywhere else), so
-- this is a safe no-op if ever re-run and a correct from-scratch build
-- against a fresh database.
ALTER TABLE compliance.chunk_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance.chunk_policy FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  CREATE POLICY app_runtime_read_all ON compliance.chunk_policy FOR SELECT TO app_runtime USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY service_role_bypass_chunk_policy ON compliance.chunk_policy FOR ALL TO service_role USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT SELECT ON compliance.chunk_policy TO app_runtime;
GRANT SELECT, INSERT, UPDATE, DELETE ON compliance.chunk_policy TO service_role;
