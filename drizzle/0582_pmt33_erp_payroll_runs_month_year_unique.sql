-- PM-T33 (D48: send for review before applying, two-directional dry run
-- required). Captures a real, live database constraint into a tracked
-- migration -- the actual fix behind DOD-F4's FALSE ruling, not a new
-- protection.
--
-- WHAT'S BEING CAPTURED, AND WHY. compliance.erp_payroll_runs already has
-- a real unique constraint, erp_payroll_runs_org_id_month_year_key, on
-- (org_id, month, year), applied directly to the live database at some
-- point outside this repo's tracked migration history (confirmed:
-- `SELECT conname FROM pg_constraint WHERE conrelid =
-- 'compliance.erp_payroll_runs'::regclass AND contype = 'u'` returns it;
-- grepping every drizzle/*.sql for that name returns zero hits). 8 real
-- concurrent-double-submit trials against the live DB (PM-T33's own
-- companion finding, instb-f4-f5-declared-scope.test.ts) found 0/8 ever
-- created a duplicate row -- but PM ruled DOD-F4 FALSE anyway, correctly:
-- the DoD is a release standard built from THIS REPOSITORY, and nothing
-- built from the tracked migration set alone has ever had this
-- constraint. This migration is the fix -- capture it here, and DOD-F4
-- becomes TRUE on the exact same evidence already gathered, because a
-- fresh build now genuinely has the protection too.
--
-- IDEMPOTENT ON PURPOSE. The constraint already exists on the live
-- database (applied out-of-band). A plain `ADD CONSTRAINT` would error
-- there ("constraint already exists") while being exactly what a fresh
-- build needs. The DO block below is a no-op where the constraint is
-- already present and a real ADD everywhere it is not -- same
-- IF-NOT-EXISTS discipline as drizzle/0581 (closure_ci_run_id) in the same
-- window, and the same shape needed anywhere this program captures
-- already-applied drift.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'erp_payroll_runs_org_id_month_year_key'
      AND conrelid = 'compliance.erp_payroll_runs'::regclass
  ) THEN
    ALTER TABLE compliance.erp_payroll_runs
      ADD CONSTRAINT erp_payroll_runs_org_id_month_year_key UNIQUE (org_id, month, year);
  END IF;
END $$;
