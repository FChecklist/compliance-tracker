-- VERIDIAN Review Framework remediation, Wave A (security/bug quick fixes),
-- item 2: FORCE ROW LEVEL SECURITY on the PROJEXA construction/interior
-- tables the audit named, plus their same-origin-migration siblings.
--
-- Background: 0116_wave134_force_rls_all_tables.sql (2026-07-09) forced RLS
-- across every compliance-schema table that existed AT THAT MOMENT (a
-- one-time DO-block loop over pg_tables, not an ongoing constraint). Every
-- table created by a LATER migration -- including
-- 0124_wave141_rfis_submittals_punchlist_changeorders.sql and
-- 0125_wave142_interior_moodboards_ffe.sql -- enabled RLS but was never
-- forced. 0179_rls_gap_fix_7_tables.sql later closed a different
-- ENABLE-only gap on 7 unrelated tables but likewise never added FORCE.
--
-- Scope is 11 tables, not just the 6 named in the remediation brief (whose
-- shorthand names were resolved against src/lib/db/schema.ts):
--   submittals    -> construction_submittals
--   punch_list    -> construction_punch_list_items
--   change_orders -> construction_change_orders
--   mood_boards   -> interior_mood_boards
--   ffe_items     -> interior_ffe_items
--   floor_plans   -> interior_floor_plans
-- plus 5 same-origin-migration siblings (created by the identical two
-- CREATE TABLE migrations, same org-scoped app data, same gap): construction_rfis,
-- interior_floor_plan_rooms, interior_furniture_placements, interior_materials,
-- interior_mood_board_items. No reason to leave adjacent rows of the same
-- migration half-fixed.
--
-- Confirmed live (2026-07-17, pg_class.relforcerowsecurity, project
-- pcrjmlpuqsbocqfwoxod) before this migration was written: all 11 tables
-- had relrowsecurity=true / relforcerowsecurity=false. Applied live via the
-- Supabase MCP as part of this same change (not just this file) --
-- get_advisors re-run afterward shows zero new/changed findings, expected
-- per Supabase's own linter having no lint category for "enabled but not
-- forced" (only "disabled" / "no policy" are flagged) -- that is a gap in
-- what that specific linter checks, not evidence this fix is a no-op.
--
-- Explicitly OUT OF SCOPE (left for a separate, approved pass): the
-- remaining compliance-schema tables that are also RLS-enabled-not-forced
-- (e.g. activity_log, monitor_task_state, report_definitions,
-- org_join_codes, workspace_memory_capsule_events, and more) -- a real,
-- broader gap, but distinct from this Wave A remediation item.
--
-- Non-exploitable today for the same reason 0116's own header gives:
-- app_runtime is NOSUPERUSER NOBYPASSRLS and is not the table owner, so
-- RLS ENABLE alone already fully applies to app_runtime's actual queries.
-- FORCE is defense-in-depth against a future accidental
-- `ALTER TABLE ... OWNER TO app_runtime` mistake -- zero behavior change
-- for any current connection. This migration is idempotent (FORCE ROW
-- LEVEL SECURITY is a safe no-op to re-run against a table where it is
-- already set) so it applies cleanly to any environment (staging, a fresh
-- database, CI) regardless of whether the live production database has
-- already had it applied out-of-band.

ALTER TABLE compliance.construction_submittals FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_punch_list_items FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.construction_change_orders FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.interior_mood_boards FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.interior_ffe_items FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.interior_floor_plans FORCE ROW LEVEL SECURITY;

ALTER TABLE compliance.construction_rfis FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.interior_floor_plan_rooms FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.interior_furniture_placements FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.interior_materials FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.interior_mood_board_items FORCE ROW LEVEL SECURITY;
