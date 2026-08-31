-- VERIDIAN Review Framework: Audit & Governance / Complete Audit Stamp
-- (Medium finding, task-20260718-075006). See src/lib/db/schema.ts's
-- comment on auditLogs.sessionId/officeId for full rationale -- summary:
-- the audit stamp already had Time/Date (created_at), IP (ip_address), a
-- "machine" proxy (user_agent), User (user_id/actor_name/actor_role) and
-- Organization (org_id); this adds the two still-missing fields the
-- finding named, Session and Office. Both nullable/additive -- every
-- pre-existing row and every pre-existing logActivity() call site is
-- completely unaffected.
--
-- Renamed 0313 -> 0335 during the rebase of PR #1234 onto current main
-- (2026-08-30): 0313 was already taken by
-- 0313_ai_team_role_overrides_rollout.sql (merged to main separately).
-- Renamed again 0335 -> 0337 during a second resync of the same rebase
-- (same day): 0335 was independently claimed by
-- 0335_crm_accounts_ai_and_bridge_columns.sql (merged to main via PR
-- #1475) and 0336 by a real pending R65 migration (PR #1479, not yet
-- merged at rename time) -- 0337 was the next genuinely free slot.
ALTER TABLE compliance.audit_logs ADD COLUMN IF NOT EXISTS session_id text;
ALTER TABLE compliance.audit_logs ADD COLUMN IF NOT EXISTS office_id text;
