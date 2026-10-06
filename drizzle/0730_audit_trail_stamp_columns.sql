-- AUDIT TRAIL slice 1 (ai-os/audit37/AUDIT_TRAIL_DESIGN_2026-10-06.md, sections 2.1A, 7 and 10): additive stamp columns on compliance.audit_logs.
-- Owner decisions 2026-10-06 (design section 10): FULL ip / device id / user agent are kept (ip_address and user_agent already exist; ip_prefix and
-- ua_family are only grouping helpers), and the trail is INTERNAL ONLY: users and org admins must not read these columns.
--
-- 1. 17 nullable columns, no default, no data rewrite: every existing row and every existing logActivity() call is unaffected.
-- 2. CHECKs (product, channel, source, action_class) added NOT VALID then VALIDATEd; all existing rows are NULL so validation passes.
-- 3. Column privileges. audit_logs was readable by app_runtime (table-level SELECT; live grants 2026-10-06: app_runtime INSERT+SELECT, service_role
--    INSERT+SELECT, compliance_app ALL, postgres owner). A column can only be hidden from a role that has no table-level SELECT, so table-level SELECT
--    is revoked from app_runtime, anon, authenticated and PUBLIC and re-granted on the 19 pre-existing columns only. service_role (staff) and the owner
--    keep everything. CONSEQUENCE for later migrations: a column added to audit_logs after this one is NOT readable by app_runtime until it is
--    granted explicitly. CONSEQUENCE for code: app_runtime must never `select *` / whole-row select from audit_logs through a Drizzle table object that
--    declares stamp columns; schema.ts keeps `auditLogs` WITHOUT them (read side) and declares them only on `auditLogsStamped` (insert side).
-- Idempotent.
ALTER TABLE compliance.audit_logs
  ADD COLUMN IF NOT EXISTS product text,
  ADD COLUMN IF NOT EXISTS channel text,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS action_class text,
  ADD COLUMN IF NOT EXISTS device_id text,
  ADD COLUMN IF NOT EXISTS ai_name text,
  ADD COLUMN IF NOT EXISTS ai_link_id text,
  ADD COLUMN IF NOT EXISTS ai_call_id text,
  ADD COLUMN IF NOT EXISTS client_at timestamptz,
  ADD COLUMN IF NOT EXISTS server_at timestamptz,
  ADD COLUMN IF NOT EXISTS clock_skew_ms integer,
  ADD COLUMN IF NOT EXISTS ip_prefix text,
  ADD COLUMN IF NOT EXISTS ua_family text,
  ADD COLUMN IF NOT EXISTS internet_id text,
  ADD COLUMN IF NOT EXISTS correlation_id text,
  ADD COLUMN IF NOT EXISTS relay_device_id text,
  ADD COLUMN IF NOT EXISTS diff jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_product_check') THEN
    ALTER TABLE compliance.audit_logs ADD CONSTRAINT audit_logs_product_check
      CHECK (product IS NULL OR product IN ('projexa', 'veridian_dpdp', 'tambola')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_channel_check') THEN
    ALTER TABLE compliance.audit_logs ADD CONSTRAINT audit_logs_channel_check
      CHECK (channel IS NULL OR channel IN ('web', 'ai', 'offline', 'online', 'sync')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_source_check') THEN
    ALTER TABLE compliance.audit_logs ADD CONSTRAINT audit_logs_source_check
      CHECK (source IS NULL OR source IN ('ui', 'ai_link', 'outbox_replay', 'peer_sync', 'server_job', 'import')) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'audit_logs_action_class_check') THEN
    ALTER TABLE compliance.audit_logs ADD CONSTRAINT audit_logs_action_class_check
      CHECK (action_class IS NULL OR action_class IN ('create', 'edit', 'delete', 'restore', 'import', 'other')) NOT VALID;
  END IF;
END $$;
ALTER TABLE compliance.audit_logs VALIDATE CONSTRAINT audit_logs_product_check;
ALTER TABLE compliance.audit_logs VALIDATE CONSTRAINT audit_logs_channel_check;
ALTER TABLE compliance.audit_logs VALIDATE CONSTRAINT audit_logs_source_check;
ALTER TABLE compliance.audit_logs VALIDATE CONSTRAINT audit_logs_action_class_check;

CREATE INDEX IF NOT EXISTS idx_audit_logs_org_correlation ON compliance.audit_logs (org_id, correlation_id) WHERE correlation_id IS NOT NULL;

-- Column-level read lock: the 19 pre-existing columns stay readable by app_runtime, the 17 stamp columns do not.
DO $$
DECLARE
  r text;
  readable text := 'id, action, entity_type, entity_id, user_id, details, ip_address, created_at, org_id, client_id, actor_name, actor_role, user_agent, api_key_id, support_session_id, acting_on_behalf_of_user_id, session_id, office_id, surface';
BEGIN
  REVOKE SELECT ON compliance.audit_logs FROM PUBLIC;
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated', 'app_runtime'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE SELECT ON compliance.audit_logs FROM %I', r);
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    EXECUTE format('GRANT SELECT (%s) ON compliance.audit_logs TO app_runtime', readable);
  END IF;
END $$;
