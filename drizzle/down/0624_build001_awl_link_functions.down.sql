-- Down-migration for drizzle/0624_build001_awl_link_functions.sql (PROJEXA-BUILD-001 U-46 step 1). Convention: docs/ROLLBACK_RUNBOOK.md
-- section 3. Not auto-applied by any script or CI job; the PM runs it deliberately, after the same always-aborted rehearsal as the
-- forward file.
--
-- WHAT IT RESTORES: the schema as it was before 0624. All 22 functions public.ai_work_link__* and public.ai_work_link_* that the forward file created are dropped (listed below, in the reverse of their creation, so a function is dropped before the helpers it calls).
--
-- ORDER: run it after the down files of 0625, 0626 and 0627 (those functions call the helpers dropped here) and before the down files of 0621 to 0623. PL/pgSQL does not record what a function body calls, so the wrong order leaves functions that fail on their first call.
--
-- DATA LOSS: none. Functions hold no rows; no table is touched.
--
-- WHEN IT REFUSES: never; DROP FUNCTION IF EXISTS. Safe to run twice.

BEGIN;

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.ai_work_link_warning(uuid, text, integer);
DROP FUNCTION IF EXISTS public.ai_work_link_revoke(uuid, text);
DROP FUNCTION IF EXISTS public.ai_work_link_revoke_service(text, text);
DROP FUNCTION IF EXISTS public.ai_work_link_list(uuid, text);
DROP FUNCTION IF EXISTS public.ai_work_link_create(uuid, text, integer, text[], integer, boolean, text);
DROP FUNCTION IF EXISTS public.ai_work_link__user_for_project(uuid, text);
DROP FUNCTION IF EXISTS public.ai_work_link_create_for(text, text, integer, text[], integer, boolean, text, text);
DROP FUNCTION IF EXISTS public.ai_work_link_context(text);
DROP FUNCTION IF EXISTS public.ai_work_link_log_call_result(text, integer, integer);
DROP FUNCTION IF EXISTS public.ai_work_link_log_call(text, text, text, text, text);
DROP FUNCTION IF EXISTS public.ai_work_link__require(text);
DROP FUNCTION IF EXISTS public.ai_work_link__resolve(text);
DROP FUNCTION IF EXISTS public.ai_work_link__eligibility(text, text);
DROP FUNCTION IF EXISTS public.ai_work_link__project_people(text, text);
DROP FUNCTION IF EXISTS public.ai_work_link__hidden_cols(text, text, text);
DROP FUNCTION IF EXISTS public.ai_work_link__cost_visible(text, text);
DROP FUNCTION IF EXISTS public.ai_work_link__mask_email(text);
DROP FUNCTION IF EXISTS public.ai_work_link__clean_path(text);
DROP FUNCTION IF EXISTS public.ai_work_link__ip_prefix(text);
DROP FUNCTION IF EXISTS public.ai_work_link__hash_token(text);
DROP FUNCTION IF EXISTS public.ai_work_link__can_read_project(text, text, text, text);
DROP FUNCTION IF EXISTS public.ai_work_link__role_rank(text);

COMMIT;
