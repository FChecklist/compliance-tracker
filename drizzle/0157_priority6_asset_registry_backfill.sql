-- Priority 6 (11-priority6-one-brain-integration-tracker.yaml): closes a
-- gap discovered during this priority's own investigation -- the
-- auto_register_asset() trigger from migration 0152 only fires on
-- INSERT/UPDATE/DELETE, so it never backfilled the rows that already
-- existed in each of the 29 tables (drizzle/0153-0155) at the moment the
-- trigger was attached to them. A live count confirmed this:
-- `SELECT count(*) FROM compliance.platform_assets` returned 0 despite
-- all 29 triggers being correctly attached.
--
-- This is a REUSABLE mechanism, not a one-off script: any table added to
-- asset_registration_config in the future (by a reviewed migration, same
-- as today) can be backfilled the same way, by the same function, without
-- new application code -- matching Priority 4's own "software, not a
-- one-off human/AI action" design intent for this whole subsystem.
--
-- The per-row mapping logic below is a deliberate line-for-line mirror of
-- compliance.auto_register_asset() (migration 0152). Kept as a separate
-- function body rather than refactored into a shared helper so that this
-- migration touches zero lines of the already-live trigger function
-- attached to 29 production tables -- if the two ever need to change
-- together, change both, but never let a backfill-only edit risk the
-- trigger path real writes depend on today.
CREATE OR REPLACE FUNCTION compliance.backfill_registered_assets(p_source_table text DEFAULT NULL)
RETURNS TABLE (out_source_table text, out_rows_seen bigint, out_rows_upserted bigint)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = compliance, pg_temp
AS $$
DECLARE
  cfg compliance.asset_registration_config%ROWTYPE;
  rec record;
  row_data jsonb;
  row_id text;
  computed_name text;
  computed_purpose text;
  computed_module text;
  computed_org_id text;
  computed_owner_id text;
  computed_status text;
  seen bigint;
  upserted bigint;
BEGIN
  FOR cfg IN
    SELECT * FROM compliance.asset_registration_config c
    WHERE c.is_active = true
      AND (p_source_table IS NULL OR c.source_table = p_source_table)
    ORDER BY c.source_table
  LOOP
    seen := 0;
    upserted := 0;

    FOR rec IN EXECUTE format('SELECT to_jsonb(t) AS row_data, t.id AS row_id FROM compliance.%I t', cfg.source_table)
    LOOP
      seen := seen + 1;
      row_data := rec.row_data;
      row_id := rec.row_id;

      IF cfg.active_column IS NOT NULL AND (row_data ->> cfg.active_column) = 'false' THEN
        computed_status := 'archived';
      ELSE
        computed_status := 'active';
      END IF;

      computed_name := row_data ->> cfg.name_column;
      IF computed_name IS NULL OR btrim(computed_name) = '' THEN
        computed_name := cfg.source_table || ':' || row_id;
      END IF;

      computed_purpose := CASE WHEN cfg.purpose_column IS NOT NULL THEN row_data ->> cfg.purpose_column ELSE NULL END;
      computed_module := CASE WHEN cfg.module_column IS NOT NULL THEN row_data ->> cfg.module_column ELSE NULL END;
      computed_org_id := CASE WHEN cfg.org_column IS NOT NULL THEN row_data ->> cfg.org_column ELSE NULL END;
      computed_owner_id := CASE WHEN cfg.owner_column IS NOT NULL THEN row_data ->> cfg.owner_column ELSE NULL END;

      INSERT INTO compliance.platform_assets (
        name, asset_type, module, owner_id, status, source_table, source_id, org_id
      ) VALUES (
        computed_name, cfg.asset_type::compliance.asset_type, computed_module, computed_owner_id,
        computed_status::compliance.asset_status, cfg.source_table, row_id, computed_org_id
      )
      ON CONFLICT (source_table, source_id) DO UPDATE SET
        name = EXCLUDED.name,
        module = EXCLUDED.module,
        owner_id = EXCLUDED.owner_id,
        status = EXCLUDED.status,
        org_id = EXCLUDED.org_id,
        updated_at = now();

      IF computed_purpose IS NOT NULL THEN
        UPDATE compliance.platform_assets
          SET purpose = computed_purpose
          WHERE source_table = cfg.source_table AND source_id = row_id;
      END IF;

      upserted := upserted + 1;
    END LOOP;

    out_source_table := cfg.source_table;
    out_rows_seen := seen;
    out_rows_upserted := upserted;
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION compliance.backfill_registered_assets(text) IS
  'Priority 6: reusable backfill for compliance.platform_assets -- upserts every EXISTING row of every table in asset_registration_config (or just one, if p_source_table is given), using the identical column-mapping rules as auto_register_asset(). Idempotent (ON CONFLICT DO UPDATE) -- safe to re-run any time, including after a table is newly onboarded.';

-- app_runtime does not get EXECUTE here deliberately -- this is a
-- Super-Boss/migration-console operation (like audit-asset-registry.ts),
-- not something any request path should ever be able to trigger.
