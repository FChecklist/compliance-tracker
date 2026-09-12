-- R85 Addendum 3 v4, Phase 6 -- VISIBILITY AND THE CLIENT BOUNDARY (E2/Part
-- H: deliberately sequenced BEFORE Phase 7 exports -- build the boundary
-- before the thing it protects exists). Owner rulings D87 (claude_log 366),
-- D88 (372), D89 (373), D90 (374), D91 (375). Work order: Google Drive
-- WORK_ORDER_R85_ADDENDUM_3_v4_R50_FINAL.md, gates 6-01..6-05. Additive: one
-- new table.
--
-- Applied LIVE against pcrjmlpuqsbocqfwoxod via Supabase MCP apply_migration
-- (this repo's current-era convention for schema changes -- see
-- drizzle/0593's and drizzle/0594's own headers for the precedent this
-- migration follows).
--
-- WHAT THIS TABLE IS: a per-org, per-INTERNAL-role toggle of which roles may
-- see cost/variance/project-side BOQ figures (rate_project above all --
-- "THE MOST SENSITIVE FIELD IN THE PRODUCT", D91 B1, drizzle/0593's own
-- column comment). ONE row per (org_id, role) -- a missing row means "not
-- granted" (fail-closed default, enforced in application code by
-- src/lib/services/cost-visibility-service.ts's canRoleSeeCost(), never by
-- assuming a row exists).
--
-- ★★★ THE HARD FLOOR (6-01), NOT CONFIGURABLE BY ANYONE ★★★
-- client_viewer can NEVER be granted cost visibility. This is enforced HERE,
-- at the DB layer, not only in application code, exactly like this
-- codebase's established immutability convention (drizzle/0236's audit_logs
-- precedent, drizzle/0594's boq_baseline UPDATE/DELETE revoke) -- so a
-- direct SQL write, a future migration, or a future application-code bug can
-- never violate it. cost_visibility_config_no_client_viewer_grant below
-- makes it structurally IMPOSSIBLE to INSERT or UPDATE a row where
-- role = 'client_viewer' AND can_see_cost = true. Proven in
-- cost-visibility-service.test.ts by attempting exactly that write directly
-- against the table and asserting Postgres itself rejects it (23514, check
-- constraint violation) -- independent of, and in addition to, the
-- application-layer refusal in setCostVisibilityForRole().
--
-- `role` reuses the real, existing compliance.user_role enum (NOT a second,
-- duplicated role model, and NOT the PROJEXA-repo-only owner/admin/pm/
-- site_engineer/member/client_viewer OrgRole shape that lives in the
-- separate FChecklist/projexa repo -- see this repo's own CLAUDE.md
-- "PROJEXA is a SEPARATE repository" section) so an invalid role string is
-- rejected at the Postgres type level before the CHECK constraint is ever
-- reached.
--
-- changedById/changedAt (6-02): every visibility change captures who made it
-- and when. This is a live "last change" record, not a full history table --
-- the work order's own 6-02 asks for "changed_by/changed_at columns", not a
-- change-log table -- setCostVisibilityForRole()'s upsert always rewrites
-- BOTH together, never canSeeCost alone, so the row can never show a stale
-- changedBy/changedAt beside a fresh value.
--
-- No explicit app_runtime/service_role GRANT needed for SELECT/INSERT/UPDATE
-- -- drizzle/0010's ALTER DEFAULT PRIVILEGES IN SCHEMA compliance already
-- covers every future table in this schema (see drizzle/0512/0594's
-- identical note).

CREATE TABLE IF NOT EXISTS compliance.cost_visibility_config (
  id text PRIMARY KEY,
  org_id text NOT NULL,
  role compliance.user_role NOT NULL,
  can_see_cost boolean NOT NULL DEFAULT false,
  changed_by_id text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cost_visibility_config_org_role_unique UNIQUE (org_id, role),
  CONSTRAINT cost_visibility_config_no_client_viewer_grant
    CHECK (NOT (role = 'client_viewer' AND can_see_cost = true))
);

CREATE INDEX IF NOT EXISTS idx_cost_visibility_config_org_id ON compliance.cost_visibility_config(org_id);

ALTER TABLE compliance.cost_visibility_config ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY app_runtime_org_scoped ON compliance.cost_visibility_config
    FOR ALL TO app_runtime
    USING (org_id = compliance.current_org_id())
    WITH CHECK (org_id = compliance.current_org_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY service_role_bypass_cost_visibility_config ON compliance.cost_visibility_config
    FOR ALL TO service_role USING (true) WITH CHECK (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
