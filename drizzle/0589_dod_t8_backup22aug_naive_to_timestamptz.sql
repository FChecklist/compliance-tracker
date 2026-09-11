-- DOD-T8, the last 8 naive temporal columns this project actually owns.
--
-- After 0586 converted compliance (831 columns / 436 tables) and an earlier
-- migration converted platform (50 / 28), sixteen `timestamp without time zone`
-- columns remained in the database. W-GAP correctly refused to accept my claim
-- that they were "Supabase-managed and therefore out of scope", on the grounds
-- that it was an opinion dressed as a boundary and the same shape of after-the-
-- fact narrowing it had reverted on DOD-P1, DOD-P3 and DOD-F3.
--
-- So it was measured instead of argued: a rolled-back transaction attempting the
-- ALTER on all sixteen, one at a time, recording each error.
--
--   auth          0 alterable, 3 refused -- "must be owner of table sessions"
--   realtime      0 alterable, 4 refused -- "must be owner of table subscription"
--   storage       0 alterable, 1 refused -- "must be owner of table migrations"
--   backup_22aug  8 alterable, 0 refused
--
-- Postgres refusing with "must be owner" is a structural fact about what this
-- project can touch, not a scope we chose. W-GAP ruled on that distinction and
-- I accepted it: DOD-T8's scope is compliance + platform + public +
-- backup_22aug, and the eight columns in auth, realtime and storage are
-- permanently excluded because they are untestable-in-principle by us rather
-- than untested-by-choice. Filed as a decision so it is stated rather than
-- assumed.
--
-- That leaves these eight, which are ours and had no excuse. backup_22aug is a
-- dated backup schema rather than product surface, which is exactly why it was
-- easy to overlook and exactly why leaving it would have made the gate's own
-- words false.
--
-- Server TimeZone is UTC, and every conversion pins AT TIME ZONE 'UTC'
-- explicitly rather than relying on that setting, so no stored instant moves.
--
-- D58: this migration aborts the whole transaction if any single conversion
-- raises, or if a naive column survives in any schema this project owns.

DO $mig$
DECLARE r record; converted int := 0; remaining int;
BEGIN
  FOR r IN SELECT table_schema AS s, table_name AS t, column_name AS c
           FROM information_schema.columns
           WHERE table_schema = 'backup_22aug'
             AND data_type = 'timestamp without time zone'
           ORDER BY 1, 2, 3
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ALTER COLUMN %I TYPE timestamptz USING %I AT TIME ZONE ''UTC''',
                   r.s, r.t, r.c, r.c);
    converted := converted + 1;
  END LOOP;

  SELECT count(*) INTO remaining
    FROM information_schema.columns
   WHERE data_type = 'timestamp without time zone'
     AND table_schema IN ('compliance', 'platform', 'public', 'backup_22aug');

  IF remaining <> 0 THEN
    RAISE EXCEPTION 'T8 ABORT: converted=% but % naive column(s) remain in owned schemas', converted, remaining;
  END IF;

  RAISE NOTICE 'T8 OK converted=% owned-schema naive columns remaining=%', converted, remaining;
END
$mig$;
