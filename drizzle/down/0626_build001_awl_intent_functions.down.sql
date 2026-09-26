-- Down-migration for drizzle/0626_build001_awl_intent_functions.sql (PROJEXA-BUILD-001 U-46 step 1). Convention: docs/ROLLBACK_RUNBOOK.md
-- section 3. Not auto-applied by any script or CI job; the PM runs it deliberately, after the same always-aborted rehearsal as the
-- forward file.
--
-- WHAT IT RESTORES: the schema as it was before 0626. The four intent functions public.ai_work_link_record_intent, public.ai_work_link_intent_status, public.ai_work_link_history and public.ai_work_link_draft_confirm are dropped. platform.ai_work_link_intent and its rows are untouched (the down file of 0622 drops that table).
--
-- ORDER: run it after the down file of 0628 and before the down file of 0625.
--
-- DATA LOSS: none. Functions hold no rows; no table is touched.
--
-- WHEN IT REFUSES: never; DROP FUNCTION IF EXISTS. Safe to run twice.

BEGIN;

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.ai_work_link_draft_confirm(text, text, text);
DROP FUNCTION IF EXISTS public.ai_work_link_history(text, integer);
DROP FUNCTION IF EXISTS public.ai_work_link_intent_status(text, text);
DROP FUNCTION IF EXISTS public.ai_work_link_record_intent(text, text, text, jsonb, text);

COMMIT;
