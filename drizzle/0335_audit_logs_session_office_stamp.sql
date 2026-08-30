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
-- Renamed from 0313 to 0335 during the rebase of PR #1234 onto current
-- main (2026-08-30): 0313 was already taken by
-- 0313_ai_team_role_overrides_rollout.sql (merged to main separately),
-- and 0334 was the highest migration number on main at rebase time.
ALTER TABLE compliance.audit_logs ADD COLUMN IF NOT EXISTS session_id text;
ALTER TABLE compliance.audit_logs ADD COLUMN IF NOT EXISTS office_id text;
