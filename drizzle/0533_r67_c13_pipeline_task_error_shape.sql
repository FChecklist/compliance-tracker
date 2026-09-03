-- R67 lane C, item C-13 (R-256 / R-250) -- SPLIT THE FAILURE INTO THE PART A
-- PERSON READS AND THE PART ONLY WE CAN USE.
--
-- Numbered 0533, the next free number after 0532_r67_i05_boq_line_category.sql
-- (lane I, already on this branch's base). Never renumbered once applied.
--
-- THE DEFECT, CAPTURED LIVE IN THE R66 WALKTHROUGH. compliance.pipeline_tasks
-- has ONE error column, and PROJEXA's Task Master renders it. So a site
-- engineer was shown:
--
--   "Review Leads > View — write CONNECT_TIMEOUT 3.109.171.244:6543"
--   "Record record_work_progress — item code 01 not found"
--
-- a pooler IP, a port, and a function id. Worse than the leak: the two rows
-- are different KINDS of thing -- one is a question for the person, the other
-- is a pool timeout nobody on site can do anything about -- and one column
-- could not tell them apart, so both sat in "needs you" and neither said what
-- to do next.
--
-- WHAT THIS ADDS
--   error_code     the closed vocabulary from
--                  src/lib/pipeline/failure-classification.ts:
--                  BOQ_LINE_REQUIRED | BOQ_LINE_NOT_FOUND | PROJECT_REQUIRED |
--                  VALUE_REQUIRED | TASK_REQUIRED | FUNCTION_NOT_AVAILABLE |
--                  INFRA_UNAVAILABLE | UNKNOWN.
--                  TEXT, not an enum, on purpose: the vocabulary belongs to
--                  that module and adding a sentence must not need a
--                  migration.
--   error_details  THE RAW TEXT. Ours, for diagnosis. No route in this repo
--                  returns it -- GET /api/v1/projexa/tasks selects error_code
--                  and never this column. That separation IS the fix.
--
-- WHAT THIS DELIBERATELY DOES NOT ADD: a sixth pipeline_task_status value.
-- C-13's wording asks for status 'failed_system'; schema.ts's own comment
-- closes that enum at five ("M24's closed 5-status set, verbatim -- no sixth
-- value") and records that extending it needs owner sign-off, which this lane
-- does not have. The classification is carried on the ExecutionOutcome
-- ('failed' | 'failed_system') and persisted as status='blocked' with
-- error_code='INFRA_UNAVAILABLE'. Everything the item asks for -- out of the
-- needs-you list, retryable, raw text kept apart -- keys off the CODE, which
-- is this column.
--
-- Both columns ARE declared in src/lib/db/schema.ts (pipelineTasks.errorCode /
-- .errorDetails), so the Migration Schema Drift gate sees them once applied
-- and `bun run db:generate` produces no further diff. Hand-written because the
-- backfill below is not something drizzle-kit emits.
--
-- REVERSIBILITY: both columns are nullable and additive; DROP COLUMN restores
-- the previous shape exactly. No data in `error` is modified or moved.
--
-- POST-APPLY VERIFICATION SQL (for the PR description):
--   SELECT column_name FROM information_schema.columns
--    WHERE table_schema = 'compliance' AND table_name = 'pipeline_tasks'
--      AND column_name IN ('error_code','error_details')
--    ORDER BY column_name;
--   -- expect exactly two rows: error_code, error_details
--
--   SELECT error_code, count(*) FROM compliance.pipeline_tasks
--    WHERE error_code IS NOT NULL GROUP BY 1 ORDER BY 2 DESC;
--   -- expect INFRA_UNAVAILABLE to be the only code present immediately after
--   -- this migration (nothing else is backfilled), and its count to equal:
--   SELECT count(*) FROM compliance.pipeline_tasks
--    WHERE status = 'blocked'
--      AND error ~ '(CONNECT_TIMEOUT|ECONNRESET|ECONNREFUSED|ETIMEDOUT|POOL_TIMEOUT)';
--
--   SELECT count(*) FROM compliance.pipeline_tasks
--    WHERE error_details IS NOT NULL AND error_code IS NULL;
--   -- expect 0: details are only ever written beside a code

-- ---------------------------------------------------------------------------
-- (1) The two columns. Nullable: every row that existed before this migration
-- legitimately has neither, and a task that succeeded has neither for ever.
ALTER TABLE compliance.pipeline_tasks ADD COLUMN IF NOT EXISTS error_code text;
ALTER TABLE compliance.pipeline_tasks ADD COLUMN IF NOT EXISTS error_details text;

-- ---------------------------------------------------------------------------
-- (2) The backfill C-13 names: "backfill rows whose error matches
-- CONNECT_TIMEOUT|ECONNRESET into code INFRA_UNAVAILABLE".
--
-- WIDENED, DELIBERATELY, to the transport codes this stack actually produces
-- (the two named plus ECONNREFUSED / ETIMEDOUT / POOL_TIMEOUT), because
-- leaving those rows uncoded would leave them in the needs-you list -- which
-- is the exact defect being fixed, just for three more spellings of it.
--
-- The raw text is COPIED into error_details rather than moved, and `error` is
-- left untouched: this migration must not destroy the only record of what
-- actually happened on rows that have already been read by someone. The
-- application masks `error` on the way out from here on; these historic rows
-- are additionally protected by PROJEXA's own maskTechnical(), which the R67
-- C-01 client already applies to every row it renders.
UPDATE compliance.pipeline_tasks
   SET error_code = 'INFRA_UNAVAILABLE',
       error_details = error
 WHERE status = 'blocked'
   AND error_code IS NULL
   AND error IS NOT NULL
   AND error ~ '(CONNECT_TIMEOUT|ECONNRESET|ECONNREFUSED|ETIMEDOUT|POOL_TIMEOUT)';

-- ---------------------------------------------------------------------------
-- (3) The index the needs-you query now needs. GET /api/v1/projexa/tasks
-- filters "blocked rows that are NOT a system failure" on every Task Master
-- read, which is the most frequent read this table has.
--
-- PARTIAL, on the blocked rows only: every other row has a null error_code and
-- has no business in this index. Named with the r67 prefix so its origin is
-- readable in \di output.
CREATE INDEX IF NOT EXISTS r67_pipeline_tasks_org_status_error_code_idx
    ON compliance.pipeline_tasks (org_id, status, error_code)
 WHERE status = 'blocked';
