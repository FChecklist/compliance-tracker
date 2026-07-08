-- Gap closure, AUDIT_2026-07-09.md (Database & Schema Review section).
-- Applied live via Supabase MCP execute_sql on 2026-07-09; this file is the
-- committed record of that change (this repo's real migration-tracking is
-- Supabase MCP apply_migration/execute_sql, not drizzle-kit's journal --
-- confirmed during the same gap-closure pass, see 0114's own header note).
--
-- Part A: drop 4 confirmed duplicate indexes (get_advisors, performance,
-- WARN level) -- keeping the <table>_<col>_idx-named one in each pair
-- (matches this codebase's newer naming convention), dropping the
-- idx_<table>_<col>-named duplicate.
DROP INDEX IF EXISTS compliance.idx_client_entities_client_id;
DROP INDEX IF EXISTS compliance.idx_clients_org_id;
DROP INDEX IF EXISTS compliance.idx_user_client_access_client_id;
DROP INDEX IF EXISTS compliance.idx_user_client_access_user_id;

-- Part B: the single highest-leverage performance fix in the audit --
-- every financial report (Trial Balance/P&L/Balance Sheet/Cash Flow) filters
-- erp_journal_entries on exactly (org_id, status, posting_date), and no
-- index covered that combination (only org_id/created_by_id/company_id did).
CREATE INDEX IF NOT EXISTS idx_erp_journal_entries_org_status_posting_date
  ON compliance.erp_journal_entries (org_id, status, posting_date);
