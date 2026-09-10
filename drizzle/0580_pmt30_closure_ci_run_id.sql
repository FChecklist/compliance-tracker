-- PM-T30 (D48: send for review before applying). Adds the missing
-- re-runnable reference DOD-R6 asks for.
--
-- WHAT'S MISSING, PRECISELY. platform.sumeet_requirements already has
-- closure_test_path, closure_test_run_at, closure_commit_sha, and (as of
-- earlier this window's own correction) a closure_repo column that already
-- existed -- four closure columns, not three, contrary to an earlier stale
-- assumption. DOD-R6 requires a test id, a RUN id, a commit sha and a repo.
-- The repo column is already real. closure_test_run_at is a TIMESTAMP
-- (when the closure was recorded), not a re-runnable reference to anything
-- -- it cannot answer "show me that CI run" the way an actual GitHub
-- Actions run id can. This migration adds the one column actually missing:
-- closure_ci_run_id, the numeric GitHub Actions run id (e.g. the id in
-- https://github.com/FChecklist/<repo>/actions/runs/<id>), stored as text
-- to match this table's existing closure_test_path/closure_commit_sha/
-- closure_repo convention (never arithmetic'd, no reason to be numeric).
--
-- ADDITIVE ONLY. Nullable, no default, no backfill in this migration --
-- backfilling real run ids for every CLOSED row is a separate, later step
-- (query actions/runs?head_sha=<full sha> per row's own closure_commit_sha,
-- per this session's own standing trap note: never pipe gh api --paginate
-- into a JSON parser, and a failed/absent lookup is recorded honestly as
-- NULL, never guessed).
ALTER TABLE platform.sumeet_requirements
  ADD COLUMN IF NOT EXISTS closure_ci_run_id text;

COMMENT ON COLUMN platform.sumeet_requirements.closure_ci_run_id IS
  'GitHub Actions run id (numeric, stored as text) for the CI run that produced closure_test_run_at''s result -- a re-runnable reference, per DOD-R6. NULL until backfilled (PM-T30 step 2) or set by a future closure.';
