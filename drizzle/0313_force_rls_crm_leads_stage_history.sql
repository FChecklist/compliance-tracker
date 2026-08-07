-- VERIDIAN Review Framework gap-closure (2026-08-07), CRM Leads "Audit
-- Trail & Change History" (folds in "Multi-Tenant / Multi-Project
-- Isolation"'s recommended periodic re-verification): re-running the same
-- "RLS is enabled but not forced" check 0215/0219/0223 already fixed for
-- other tables surfaced that crm_leads, crm_opportunities, and
-- crm_stage_history (all created by 0031_wave41_crm.sql and
-- 0198_priority15_sales_crm_depth.sql, both predating 0215's original
-- sweep) were never covered by any of those three passes.
--
-- Same non-exploitable-today reasoning as 0215/0223's own headers:
-- app_runtime is NOSUPERUSER NOBYPASSRLS and is not the owner of any of
-- these tables (owner is postgres) -- RLS ENABLE alone already fully
-- applies to app_runtime's actual queries. FORCE is defense-in-depth
-- against a future accidental `ALTER TABLE ... OWNER TO app_runtime`
-- mistake, zero behavior change for any current connection. Idempotent,
-- safe to re-run.
--
-- Still explicitly OUT OF SCOPE (same list 0183's own header already
-- flagged, not expanded here): the broader set of compliance-schema
-- tables that are also RLS-enabled-not-forced platform-wide (activity_log,
-- monitor_task_state, report_definitions, org_join_codes, and more) -- a
-- real, separately-tracked gap, not silently absorbed into this 3-table
-- CRM-leads-scoped fix.

ALTER TABLE compliance.crm_leads FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.crm_opportunities FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance.crm_stage_history FORCE ROW LEVEL SECURITY;
