-- Down-migration for drizzle/0614_build001_link_resolve_by_hash.sql
-- (PROJEXA-BUILD-001 U-18 stage B). Convention: docs/ROLLBACK_RUNBOOK.md
-- section 3. Not auto-applied by any script or CI job; the PM runs it
-- deliberately, after the same always-aborted rehearsal as the forward file
-- (section 4a).
--
-- WHAT IT RESTORES: the pre-0614 schema exactly. platform.rpc_resolve_ai_link_scoped
--   is dropped; platform.rpc_resolve_ai_link_token (drizzle/0584), the table
--   and its rows are untouched.
--
-- DATA LOSS: none. No row is read, changed or deleted.
--
-- WHAT STOPS WORKING, read before running:
--   1. Every product = 'projexa' link stops resolving (they can be matched
--      only by hash, and only this function does that). Their rows stay.
--   2. *** ROLL BACK THE CODE FIRST. *** resolveAiLinkToken() in
--      src/lib/ai-links/user-links.ts calls this function for EVERY AI link,
--      VERIDIAN ones included. While code that calls it is deployed, dropping
--      it makes every AI-link call fail with an undefined-function error. Put
--      back the code that calls platform.rpc_resolve_ai_link_token first
--      (docs/ROLLBACK_RUNBOOK.md section 4, step 3), then run this file.
--
-- ORDER WITH 0613: run this file before drizzle/down/0613_build001_link_project_scope.down.sql.
--   That file drops columns this function reads; PL/pgSQL does not record
--   the dependency, so the reverse order would leave a function that fails
--   on its first call.
--
-- WHEN IT REFUSES: never; DROP FUNCTION IF EXISTS. Safe to run twice.

BEGIN;

SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS platform.rpc_resolve_ai_link_scoped(text);

COMMIT;
