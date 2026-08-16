-- Priority 4 (09-priority4-umr-universal-tracker.yaml): the "software
-- ensures every action is automatically registered, no AI, non-negotiable"
-- mechanism. A single generic PL/pgSQL trigger function, reused by every
-- table onboarded via a row in asset_registration_config -- registering a
-- new table going forward is a config row + one CREATE TRIGGER statement,
-- never new application code.

-- ─── Config table: which source tables are wired, and how to map their
--     columns onto platform_assets' fixed shape ──────────────────────────
CREATE TABLE compliance.asset_registration_config (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  source_table text NOT NULL UNIQUE,
  asset_type text NOT NULL,
  name_column text NOT NULL,
  purpose_column text,
  module_column text,
  org_column text,
  owner_column text,
  active_column text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now(),
  CONSTRAINT asset_registration_config_asset_type_check CHECK (
    asset_type IN (
      'report','screen','dashboard','ai_agent','workflow','api','prompt',
      'function','policy','rule','sql_query','email_template','notification',
      'template','project','task','document','decision','automation','role',
      'permission','computation_engine','dynamic_chain','other'
    )
  )
);

COMMENT ON TABLE compliance.asset_registration_config IS
  'Priority 4: registry of which tables auto-register into platform_assets via compliance.auto_register_asset(), and how to map each table''s own column names onto the registry''s fixed shape. Populated only by reviewed migrations, never by application code at runtime.';

-- ─── The generic trigger function ─────────────────────────────────────────
-- SECURITY DEFINER: this must succeed regardless of the invoking role's own
-- RLS context on platform_assets (a cron job, a script, or a request scoped
-- to a different org than the one being registered should never have its
-- registry write silently dropped by RLS) -- the same reasoning Postgres's
-- own docs give for trigger-driven system bookkeeping. The function body
-- only ever reads column names out of asset_registration_config (itself
-- migration-only, not runtime-writable by any request) and NEW/OLD's own
-- jsonb representation -- no dynamic SQL is built from row data at any
-- point, so there is no injection surface despite the elevated privilege.
CREATE OR REPLACE FUNCTION compliance.auto_register_asset()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = compliance, pg_temp
AS $$
DECLARE
  cfg compliance.asset_registration_config%ROWTYPE;
  row_data jsonb;
  row_id text;
  computed_name text;
  computed_purpose text;
  computed_module text;
  computed_org_id text;
  computed_owner_id text;
  computed_status text;
BEGIN
  SELECT * INTO cfg FROM compliance.asset_registration_config
    WHERE source_table = TG_TABLE_NAME AND is_active = true;

  -- No config row, or registration turned off for this table -- no-op.
  -- This is the safe default: a table only starts affecting
  -- platform_assets once a reviewed migration explicitly opts it in.
  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    row_data := to_jsonb(OLD);
    row_id := OLD.id;
    computed_status := 'deleted';
  ELSE
    row_data := to_jsonb(NEW);
    row_id := NEW.id;
    IF cfg.active_column IS NOT NULL AND (row_data ->> cfg.active_column) = 'false' THEN
      computed_status := 'archived';
    ELSE
      computed_status := 'active';
    END IF;
  END IF;

  computed_name := row_data ->> cfg.name_column;
  -- A source row can never register with a blank name -- platform_assets.
  -- name is NOT NULL, and a blank name would make the registry entry
  -- useless for search anyway. Fall back to the row id rather than fail
  -- the source table's own write (registration is a side effect, it must
  -- never block the primary transaction).
  IF computed_name IS NULL OR btrim(computed_name) = '' THEN
    computed_name := TG_TABLE_NAME || ':' || row_id;
  END IF;

  computed_purpose := CASE WHEN cfg.purpose_column IS NOT NULL THEN row_data ->> cfg.purpose_column ELSE NULL END;
  computed_module := CASE WHEN cfg.module_column IS NOT NULL THEN row_data ->> cfg.module_column ELSE NULL END;
  computed_org_id := CASE WHEN cfg.org_column IS NOT NULL THEN row_data ->> cfg.org_column ELSE NULL END;
  computed_owner_id := CASE WHEN cfg.owner_column IS NOT NULL THEN row_data ->> cfg.owner_column ELSE NULL END;

  -- asset_registration_config.asset_type/computed_status are plain `text`
  -- (validated by a CHECK constraint, not the real Postgres enum type,
  -- since the config table is meant to be trivially insertable by a
  -- migration without needing the enum type name in scope) -- but
  -- platform_assets.asset_type/status are the REAL enum columns, so both
  -- need an explicit cast. Caught by a live rolled-back transaction test
  -- against saved_reports before this mechanism was used by any dispatch
  -- (42804 "column is of type asset_type but expression is of type text").
  INSERT INTO compliance.platform_assets (
    name, asset_type, module, owner_id, status, source_table, source_id, org_id
  ) VALUES (
    computed_name, cfg.asset_type::compliance.asset_type, computed_module, computed_owner_id,
    computed_status::compliance.asset_status, TG_TABLE_NAME, row_id, computed_org_id
  )
  ON CONFLICT (source_table, source_id) DO UPDATE SET
    name = EXCLUDED.name,
    module = EXCLUDED.module,
    owner_id = EXCLUDED.owner_id,
    status = EXCLUDED.status,
    org_id = EXCLUDED.org_id,
    updated_at = now();
  -- Deliberately NOT updating purpose here in the same statement -- see
  -- below: purpose is set via a second, purpose-only UPDATE so a NULL
  -- purpose_column never clobbers an app-curated purpose (registerAsset()/
  -- updateAsset() may have set a richer purpose than the raw source
  -- column ever had). tags/permissions/aiCapabilities/dependencies are
  -- never touched by this trigger at all, for the same reason.
  IF computed_purpose IS NOT NULL THEN
    UPDATE compliance.platform_assets
      SET purpose = computed_purpose
      WHERE source_table = TG_TABLE_NAME AND source_id = row_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

COMMENT ON FUNCTION compliance.auto_register_asset() IS
  'Priority 4: generic AFTER INSERT/UPDATE/DELETE trigger -- automatically upserts a platform_assets row for any table listed in asset_registration_config. No application code and no AI call anywhere in this path.';

-- Helpful for auditing which tables currently have the trigger attached
-- (compliance.attached_asset_triggers view) -- pure read, no side effect.
CREATE VIEW compliance.attached_asset_triggers AS
SELECT
  c.source_table,
  c.asset_type,
  c.is_active AS registration_active,
  EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class cl ON cl.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = cl.relnamespace
    WHERE n.nspname = 'compliance'
      AND cl.relname = c.source_table
      AND t.tgname = 'auto_register_asset_trg'
      AND NOT t.tgisinternal
  ) AS trigger_attached
FROM compliance.asset_registration_config c;

COMMENT ON VIEW compliance.attached_asset_triggers IS
  'Priority 4: cross-check that every configured table actually has the auto_register_asset_trg trigger attached -- used by the deterministic registry audit script.';

GRANT SELECT, INSERT, UPDATE ON compliance.asset_registration_config TO app_runtime;
GRANT SELECT ON compliance.attached_asset_triggers TO app_runtime;

-- app_runtime does not need direct EXECUTE on auto_register_asset() --
-- Postgres invokes trigger functions automatically; explicit EXECUTE grants
-- are only needed for functions called directly in SQL/app code.
