-- R74 Phase 2 (Y2-02, Y2-03): fix the measurement.
--
-- Y2-02: four-state closure tracking on sumeet_requirements, separate from
-- the pre-existing boolean/status columns (kept as evidence, never dropped).
-- Only the PM ever writes closure_state (R74-RULING-03's six conditions).
ALTER TABLE platform.sumeet_requirements
  ADD COLUMN closure_state text CHECK (closure_state IN ('CLOSED','OPEN','BLOCKED','NOT_TESTABLE')),
  ADD COLUMN closure_test_path text,
  ADD COLUMN closure_test_run_at timestamptz,
  ADD COLUMN closure_commit_sha text;

COMMENT ON COLUMN platform.sumeet_requirements.closure_state IS 'R74 Y2-02/R74-RULING-03: the ONLY place completion is counted from. Never backfilled from booleans or the status column. Written only by the PM (Y13-01), never an agent.';

-- Y2-03: classify the 218 free-text `surface` values (108 distinct) into 6
-- countable buckets. surface itself is preserved as evidence, never dropped.
ALTER TABLE platform.sumeet_uat
  ADD COLUMN surface_class text CHECK (surface_class IN ('BROWSER','API','DB','CI','MANUAL','UNKNOWN'));

COMMENT ON COLUMN platform.sumeet_uat.surface_class IS 'R74 Y2-03: classification of the free-text surface column into 6 countable buckets. PM spot-verified a random 20 (claude_log id 206) before accepting.';

UPDATE platform.sumeet_uat
SET surface_class = CASE
  WHEN surface ~* 'browser|chromium|devtools|page\.goto|playwright|puppeteer|click|ui test' THEN 'BROWSER'
  WHEN surface ~* '\yci\y|github action|pipeline' THEN 'CI'
  WHEN surface ~* 'manual|human|visual inspection' THEN 'MANUAL'
  WHEN surface ~* 'api|/api/|endpoint|curl|postman|fetch\(' THEN 'API'
  -- NOTE: Postgres's regex dialect (ARE) does not treat \b as a word
  -- boundary the way PCRE does -- \y is the correct ARE word-boundary
  -- anchor. A first draft of this classification used \b and silently
  -- failed to match "DB" as a whole word at all (caught by a PM spot-check
  -- before this migration was written, not after -- see claude_log id 206).
  WHEN surface ~* '\ydb\y|database|sql|query|postgres|supabase|compliance\.|platform\.' THEN 'DB'
  ELSE 'UNKNOWN'
END;
