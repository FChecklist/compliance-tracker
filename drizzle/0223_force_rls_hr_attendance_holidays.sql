-- VERIDIAN Review Framework RE-SCORE (2026-07-17): re-verifying the original
-- Critical finding "RLS is enabled but not forced" (closed by
-- 0215_wave_a_force_rls_construction_interior_tables.sql, 6+5 tables)
-- surfaced 2 tables created AFTER that fix that carry the exact same gap:
-- hr_attendance_records and hr_holidays, both built by
-- 0220_hr_attendance.sql (2026-07-17, Wave 2 of the 9-workstream
-- implementation wave) with RLS enabled but never forced.
--
-- Confirmed live (2026-07-17, pg_class.relforcerowsecurity, project
-- pcrjmlpuqsbocqfwoxod) before this migration was written: both tables had
-- relrowsecurity=true / relforcerowsecurity=false. Applied live via the
-- Supabase MCP as part of this same change (not just this file).
--
-- Same non-exploitable-today reasoning as 0215's own header: app_runtime is
-- NOSUPERUSER NOBYPASSRLS and is not the owner of either table (owner is
-- postgres, confirmed live) -- RLS ENABLE alone already fully applies to
-- app_runtime's actual queries. FORCE is defense-in-depth against a future
-- accidental `ALTER TABLE ... OWNER TO app_runtime` mistake, zero behavior
-- change for any current connection. Idempotent, safe to re-run.
--
-- Still explicitly OUT OF SCOPE, same as 0215's own header noted (not
-- expanded here): the broader list of compliance-schema tables that are
-- also RLS-enabled-not-forced (activity_log, monitor_task_state,
-- report_definitions, org_join_codes, workspace_memory_capsule_events, and
-- more) -- a real, separately-deferred gap, not silently absorbed into this
-- 2-table fix.

ALTER TABLE compliance.hr_attendance_records FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.hr_holidays FORCE ROW LEVEL SECURITY;
