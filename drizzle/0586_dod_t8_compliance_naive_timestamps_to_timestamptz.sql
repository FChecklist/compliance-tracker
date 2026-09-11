-- DOD-T8: every temporal column is timestamptz, never timestamp without time zone.
--
-- SCOPE. compliance held 831 naive columns across 436 tables. platform was
-- already converted (50 columns, 28 tables) earlier on 2026-09-10. The
-- remaining naive columns in this database live in auth (3), storage (1),
-- realtime (4) and backup_22aug (8). The first three are Supabase-managed
-- schemas and are deliberately NOT touched here; backup_22aug is a dated
-- backup, not product surface. So this migration completes the gate for every
-- schema the product owns.
--
-- SAFETY OF THE CONVERSION. Server TimeZone is UTC (verified:
-- current_setting('TimeZone') = 'UTC'), and every conversion pins
-- AT TIME ZONE 'UTC' explicitly rather than relying on that setting, so no
-- instant is reinterpreted and no stored value moves. Verified on the largest
-- affected table, compliance.api_key_request_log (53,614 rows): the md5 of all
-- created_at values, read back afterwards as `created_at AT TIME ZONE 'UTC'`,
-- must equal 64fc5659138b4edb8bedc50b1a6feee8 with min
-- 2026-07-08 17:53:13.019153 and max 2026-09-10 10:55:56.337.
--
-- WHY THE VIEWS ARE DROPPED AND REBUILT. Postgres refuses ALTER COLUMN TYPE on
-- a column a view reads. Three views read two of these columns:
--   compliance.audit_search              -> compliance.activity_log.created_at
--   platform.execution_run_summary       -> compliance.orchestra_executions.payload_purged_at
--   platform.execution_timeline          -> compliance.orchestra_executions.payload_purged_at
-- Their definitions and grants are captured from the catalog at run time with
-- pg_get_viewdef and information_schema.role_table_grants, then replayed after
-- the conversion. Nothing is transcribed by hand, so the rebuilt views cannot
-- drift from what was there.
--
-- WHY THIS MIGRATION CAN FAIL. Per D58, an instrument that cannot fail is not
-- evidence. This one aborts the whole transaction if it captures anything
-- other than exactly 3 dependent views, if any single column conversion
-- raises, or if a naive column survives the run. A partial conversion is not a
-- reachable end state.
--
-- APPLY PATH. Applied via the Supabase MCP, NOT via .github/workflows/
-- db-migrate.yml. That workflow advances on MAX(created_at) in
-- drizzle.__drizzle_migrations, whose cursor sits at 2026-08-27T14:00:04Z while
-- drizzle/meta/_journal.json already carries 397 entries to 2026-09-04T08:33:39Z:
-- a single dispatch would attempt 92 migrations, not this one. See
-- F-2026-0910-PM-053. Reconciling that backlog is PM-T12 and is deliberately
-- not attempted here.

DO $mig$
DECLARE
  r record; v record; g record;
  converted int := 0; failed int := 0; remaining int;
BEGIN
  CREATE TEMP TABLE _t8_views ON COMMIT DROP AS
    SELECT n.nspname AS sch, c.relname AS vw, pg_get_viewdef(c.oid, true) AS def
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'v'
      AND (n.nspname, c.relname) IN (('compliance','audit_search'),
                                     ('platform','execution_run_summary'),
                                     ('platform','execution_timeline'));

  CREATE TEMP TABLE _t8_grants ON COMMIT DROP AS
    SELECT format('GRANT %s ON %I.%I TO %I;', privilege_type, table_schema, table_name, grantee) AS stmt
    FROM information_schema.role_table_grants
    WHERE (table_schema, table_name) IN (('compliance','audit_search'),
                                         ('platform','execution_run_summary'),
                                         ('platform','execution_timeline'));

  IF (SELECT count(*) FROM _t8_views) <> 3 THEN
    RAISE EXCEPTION 'T8 ABORT: expected 3 dependent views, captured %', (SELECT count(*) FROM _t8_views);
  END IF;

  DROP VIEW platform.execution_timeline;
  DROP VIEW platform.execution_run_summary;
  DROP VIEW compliance.audit_search;

  FOR r IN SELECT table_name AS tn, column_name AS cn
           FROM information_schema.columns
           WHERE table_schema = 'compliance' AND data_type = 'timestamp without time zone'
           ORDER BY 1, 2
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE compliance.%I ALTER COLUMN %I TYPE timestamptz USING %I AT TIME ZONE ''UTC''', r.tn, r.cn, r.cn);
      converted := converted + 1;
    EXCEPTION WHEN others THEN
      failed := failed + 1;
      RAISE WARNING 'T8 FAILED %.% : %', r.tn, r.cn, SQLERRM;
    END;
  END LOOP;

  FOR v IN SELECT * FROM _t8_views ORDER BY CASE WHEN sch = 'compliance' THEN 0 ELSE 1 END, vw LOOP
    EXECUTE format('CREATE VIEW %I.%I AS %s', v.sch, v.vw, v.def);
  END LOOP;

  FOR g IN SELECT stmt FROM _t8_grants LOOP EXECUTE g.stmt; END LOOP;

  SELECT count(*) INTO remaining FROM information_schema.columns
   WHERE table_schema = 'compliance' AND data_type = 'timestamp without time zone';

  IF remaining <> 0 OR failed <> 0 THEN
    RAISE EXCEPTION 'T8 ABORT: converted=% failed=% remaining=%', converted, failed, remaining;
  END IF;

  RAISE NOTICE 'T8 OK converted=% remaining=%', converted, remaining;
END
$mig$;
