-- Down-migration for drizzle/0730_audit_trail_stamp_columns.sql. Run deliberately by the PM, not by any script.
-- DATA LOSS: drops the 17 stamp columns and every value stored in them since 0730 was applied. Deploy code that no longer passes `stamp` FIRST.
BEGIN;
DROP INDEX IF EXISTS compliance.idx_audit_logs_org_correlation;
ALTER TABLE compliance.audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_product_check,
  DROP CONSTRAINT IF EXISTS audit_logs_channel_check,
  DROP CONSTRAINT IF EXISTS audit_logs_source_check,
  DROP CONSTRAINT IF EXISTS audit_logs_action_class_check,
  DROP COLUMN IF EXISTS product, DROP COLUMN IF EXISTS channel, DROP COLUMN IF EXISTS source, DROP COLUMN IF EXISTS action_class,
  DROP COLUMN IF EXISTS device_id, DROP COLUMN IF EXISTS ai_name, DROP COLUMN IF EXISTS ai_link_id, DROP COLUMN IF EXISTS ai_call_id,
  DROP COLUMN IF EXISTS client_at, DROP COLUMN IF EXISTS server_at, DROP COLUMN IF EXISTS clock_skew_ms, DROP COLUMN IF EXISTS ip_prefix,
  DROP COLUMN IF EXISTS ua_family, DROP COLUMN IF EXISTS internet_id, DROP COLUMN IF EXISTS correlation_id, DROP COLUMN IF EXISTS relay_device_id,
  DROP COLUMN IF EXISTS diff;
-- Restore the pre-0730 table-level SELECT for app_runtime (column grants vanish with their columns only for dropped ones).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_runtime') THEN
    GRANT SELECT ON compliance.audit_logs TO app_runtime;
  END IF;
END $$;
COMMIT;
