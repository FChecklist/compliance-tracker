-- PROJEXA-BUILD-002 WP-15 (AW-902 live testing, 2026-09-27): compliance.token_usage_ledger has RLS enabled with ONLY a service_role
-- bypass policy -- no policy at all for app_runtime, the role every normal server request uses. Every real, non-service-role AI
-- usage-metering write (recordTokenUsage, token-usage-service.ts) has therefore been silently refused by Postgres's default-deny RLS
-- since this table gained row-level security, for every caller of this table, not just this session's testing: found live while
-- proving the internal AI's metered extraction path end to end (a real 275s model call succeeded, then "usage could not be
-- recorded -> 503" refused the whole request).
--
-- Root cause, not just the missing policy: recordTokenUsage() writes through the plain db client (DATABASE_URL/app_runtime), never
-- inside withTenantContext, so compliance.current_org_id() is never set for this write -- an org-matching USING/WITH CHECK clause
-- (the app_runtime_org_scoped shape used elsewhere, e.g. fm_checklist_templates) can therefore never pass for a real (non-null)
-- org_id row on THIS table, confirmed by testing it live and watching it still fail. The right shape for an append-only,
-- server-authored usage ledger: INSERT is permissive (the server decides org_id itself; nothing here lets a caller choose whose
-- ledger a row lands in beyond what recordTokenUsage's own callers already pass), reads stay tenant-scoped.
BEGIN;

CREATE POLICY app_runtime_insert ON compliance.token_usage_ledger
  FOR INSERT TO app_runtime
  WITH CHECK (true);

CREATE POLICY app_runtime_read ON compliance.token_usage_ledger
  FOR SELECT TO app_runtime
  USING (org_id IS NULL OR org_id = compliance.current_org_id());

COMMIT;
