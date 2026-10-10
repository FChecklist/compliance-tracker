-- Down-migration for drizzle/0623_build001_awl_call_log.sql (PROJEXA-BUILD-001 U-46 step 1). Convention: docs/ROLLBACK_RUNBOOK.md
-- section 3. Not auto-applied by any script or CI job; the PM runs it deliberately, after the same always-aborted rehearsal as the
-- forward file.
--
-- WHAT IT RESTORES: the schema as it was before 0623. platform.ai_work_link_call is dropped, and with it every partition
--   platform.ai_work_link_call_YYYY_MM (including the ones the retention job made later), its indexes and its guard trigger. The
--   trigger function public.ai_work_link_call_guard() and the helper public.ai_work_link__create_call_partition(date) are
--   dropped too. platform.user_ai_links is untouched.
--
-- ORDER: run it after the down files of 0627 (the retention function calls the helper) and 0624 (the log functions write the table),
--   and before the down file of 0621.
--
-- DATA LOSS: every call-log row still held (at most 90 days of them). The log is the only record of which calls a link made. The
--   guard trigger's no-DELETE rule is not in the way: a table is dropped, not deleted from, and only the owner may do it.
--
-- WHEN IT REFUSES: never; every drop uses IF EXISTS. Safe to run twice.

BEGIN;

SET LOCAL lock_timeout = '5s';

DROP TABLE IF EXISTS platform.ai_work_link_call;
DROP FUNCTION IF EXISTS public.ai_work_link__create_call_partition(date);
DROP FUNCTION IF EXISTS public.ai_work_link_call_guard();

COMMIT;
