-- Down-migration for drizzle/0631_build001_awl_mint_for.sql (PROJEXA-BUILD-002 WP-08). Convention: docs/ROLLBACK_RUNBOOK.md section 3.
-- Not auto-applied by any script or CI job; the PM runs it deliberately, after the same always-aborted rehearsal as the forward file.
--
-- WHAT IT RESTORES: the schema as it was before 0631. The five functions the forward file created are dropped, in the reverse of their
-- creation (a function before the functions it calls): ai_work_link_new_project_for, ai_work_link_mint_for, ai_work_link_revoke_for,
-- ai_work_link_warning_for, ai_work_link_list_for.
--
-- ORDER: run it before the down files of 0624 and 0626 (this file's functions call functions those files create). PL/pgSQL does not
-- record what a function body calls, so the wrong order leaves functions that fail on their first call.
--
-- DATA LOSS: none from this file. It does not touch a table. A shell project that new_project_for created stays (a normal project row of
-- its organisation, named "New project (AI setup)" until renamed), and so do the links that were minted: they are ordinary rows of
-- platform.user_ai_links that the functions of 0624 still resolve, list and revoke.
--
-- WHEN IT REFUSES: never; DROP FUNCTION IF EXISTS. Safe to run twice.

BEGIN;

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.ai_work_link_new_project_for(text, text, integer);
DROP FUNCTION IF EXISTS public.ai_work_link_mint_for(text, text, integer, text[], integer, boolean, text);
DROP FUNCTION IF EXISTS public.ai_work_link_revoke_for(text, text);
DROP FUNCTION IF EXISTS public.ai_work_link_warning_for(text, text, integer);
DROP FUNCTION IF EXISTS public.ai_work_link_list_for(text, text);

COMMIT;
