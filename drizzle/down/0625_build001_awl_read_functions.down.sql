-- Down-migration for drizzle/0625_build001_awl_read_functions.sql (PROJEXA-BUILD-001 U-46 step 1). Convention: docs/ROLLBACK_RUNBOOK.md
-- section 3. Not auto-applied by any script or CI job; the PM runs it deliberately, after the same always-aborted rehearsal as the
-- forward file.
--
-- WHAT IT RESTORES: the schema as it was before 0625. The three read functions public.ai_work_link_record, public.ai_work_link_records and public.ai_work_link__records_core are dropped.
--
-- ORDER: run it after the down file of 0626 and before the down file of 0624 (the helpers it calls are dropped there).
--
-- DATA LOSS: none. Functions hold no rows; no table is touched.
--
-- WHEN IT REFUSES: never; DROP FUNCTION IF EXISTS. Safe to run twice.

BEGIN;

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.ai_work_link_record(text, text, text);
DROP FUNCTION IF EXISTS public.ai_work_link_records(text, text, text, integer, jsonb);
DROP FUNCTION IF EXISTS public.ai_work_link__records_core(jsonb, text, text, integer, jsonb, text);

COMMIT;
